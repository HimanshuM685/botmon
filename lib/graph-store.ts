import "server-only";
import { db } from "./db";
import type { FactInput } from "./facts";
import { buildGraph, planMemory, type GEdge, type GFact, type GNode, type Triple } from "./graph";

type Person = { id: string; name: string };
export type MemoryInput = FactInput & { triples?: Triple[] };

const nodeSelect = { id: true, key: true, label: true, kind: true, aliases: true } as const;
const edgeSelect = { id: true, fromId: true, toId: true, rel: true, label: true, factId: true } as const;

/** A person's graph rows. Edges of trashed memories are dropped later by buildGraph (it only knows alive facts). */
export async function loadGraphRows(personId: string): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
  const [nodes, edges] = await Promise.all([
    db.memoryNode.findMany({ where: { personId }, select: nodeSelect }),
    db.memoryEdge.findMany({ where: { personId }, select: edgeSelect }),
  ]);
  return { nodes, edges };
}

export async function loadGraph(person: Person, facts: GFact[]) {
  const { nodes, edges } = await loadGraphRows(person.id);
  return buildGraph(nodes, edges, facts, { them: person.name });
}

/**
 * Tie memories that already exist into the graph: create the nodes they name and the edges they state.
 * Returns each memory's `entities` (the node keys it touches), for the cached list on the fact.
 * Two requests creating the same node at once: the unique (personId, key) keeps one, and the ids are re-read
 * before any edge is written, so edges always point at the row that exists.
 */
export async function linkMemories(person: Person, items: { factId: string; tags?: string[]; triples?: Triple[] }[]) {
  if (!items.length) return new Map<string, string[]>();
  const { nodes, edges } = await loadGraphRows(person.id);
  const plan = (ns: GNode[]) => {
    const addNodes: GNode[] = [], addEdges: GEdge[] = [], entities = new Map<string, string[]>();
    for (const item of items) {
      const p = planMemory([...ns, ...addNodes], [...edges, ...addEdges], item, { personName: person.name });
      addNodes.push(...p.nodes);
      addEdges.push(...p.edges);
      entities.set(item.factId, p.entities);
    }
    return { addNodes, addEdges, entities };
  };
  const first = plan(nodes);
  if (first.addNodes.length) {
    await db.memoryNode.createMany({ data: first.addNodes.map((n) => ({ ...n, personId: person.id })), skipDuplicates: true });
    // Plan again against what is really stored, so edge endpoints are the surviving rows.
    const stored = await db.memoryNode.findMany({ where: { personId: person.id }, select: nodeSelect });
    const again = plan(stored);
    if (again.addEdges.length) await db.memoryEdge.createMany({ data: again.addEdges.map((e) => ({ ...e, personId: person.id })) });
    return again.entities;
  }
  if (first.addEdges.length) await db.memoryEdge.createMany({ data: first.addEdges.map((e) => ({ ...e, personId: person.id })) });
  return first.entities;
}

/** Save new memories and tie them into the graph. Returns their ids, in order. */
export async function saveMemories(person: Person, facts: MemoryInput[], meta: { source: "ANALYSIS" | "COACH" | "USER"; analysisId?: string }) {
  if (!facts.length) return [];
  const rows = facts.map(({ triples, ...f }) => ({ id: crypto.randomUUID(), triples, tags: f.entities, fact: f }));
  await db.personFact.createMany({ data: rows.map((r) => ({ ...r.fact, id: r.id, personId: person.id, ...meta })) });
  const entities = await linkMemories(person, rows.map((r) => ({ factId: r.id, tags: r.tags, triples: r.triples })));
  // The cached tag list follows the graph: triples can name things the plain tags did not.
  const changed = rows.filter((r) => (entities.get(r.id) ?? []).join("|") !== r.fact.entities.join("|"));
  if (changed.length)
    await db.$transaction(changed.map((r) => db.personFact.update({ where: { id: r.id }, data: { entities: entities.get(r.id) ?? [] } })));
  return rows.map((r) => r.id);
}

/**
 * The user edited a memory's tags: its edges follow. Edges to things no longer tagged go; new tags get a MENTIONS edge.
 * Typed edges to tags that stay are kept.
 */
export async function retagMemory(person: Person, factId: string, tags: string[]) {
  const keep = await db.memoryNode.findMany({ where: { personId: person.id, key: { in: [...tags, "them", "me"] } }, select: { id: true } });
  const ids = keep.map((n) => n.id);
  await db.memoryEdge.deleteMany({ where: { personId: person.id, factId, OR: [{ fromId: { notIn: ids } }, { toId: { notIn: ids } }] } });
  await linkMemories(person, [{ factId, tags }]);
}
