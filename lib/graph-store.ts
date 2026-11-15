import "server-only";
import { db } from "./db";
import { alive } from "./trash";
import { diffFindings } from "./graph/findings";
import { resolveByMeaning, storeEmbeddings } from "./graph/vectors";
import type { ProviderId } from "./ai/models";
import type { FactInput } from "./facts";
import { buildGraph, planMemory, ungrounded, type GEdge, type GFact, type GNode, type Triple } from "./graph";

type Person = { id: string; name: string };
/** The user's key, when the caller has it: lets new names be matched by meaning (lib/graph/vectors.ts). */
type EmbedKey = { provider: ProviderId; apiKey: string };
export type MemoryInput = FactInput & { triples?: Triple[] };
/** What a write actually added, so a caller can show the stored graph instead of planning it again. */
export type GraphDelta = { nodes: GNode[]; edges: GEdge[]; aliases: { nodeId: string; alias: string }[] };
const emptyDelta = (): GraphDelta => ({ nodes: [], edges: [], aliases: [] });

const nodeSelect = { id: true, key: true, label: true, kind: true, aliases: true, embedModel: true } as const;
const edgeSelect = { id: true, fromId: true, toId: true, rel: true, label: true, factId: true, at: true, tone: true, polarity: true, quoteSender: true, confidence: true, supersededById: true, quoteCipher: true } as const;

/** A person's graph rows. Edges of trashed memories are dropped later by buildGraph (it only knows alive facts). */
export async function loadGraphRows(personId: string): Promise<{ nodes: GNode[]; edges: (GEdge & { storedSupersededById: string | null })[] }> {
  const [nodes, edges] = await Promise.all([
    db.memoryNode.findMany({ where: { personId }, select: nodeSelect }),
    db.memoryEdge.findMany({ where: { personId }, select: edgeSelect }),
  ]);
  // The quote itself stays encrypted in the database: the graph only knows that there is one (`quoted`).
  return { nodes, edges: edges.map(({ quoteCipher, supersededById, ...e }) => ({ ...e, quoted: !!quoteCipher, storedSupersededById: supersededById })) };
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
export async function linkMemories(person: Person, items: { factId: string; tags?: string[]; triples?: Triple[] }[], key?: EmbedKey) {
  if (!items.length) return { entities: new Map<string, string[]>(), delta: emptyDelta() };
  const { nodes, edges } = await loadGraphRows(person.id);
  const before = new Set(nodes.map((n) => n.id));
  let same: Map<string, string> | undefined;
  const plan = (ns: GNode[]) => {
    const addNodes: GNode[] = [], addEdges: GEdge[] = [], entities = new Map<string, string[]>(), fresh: GNode[] = [];
    const aliases = new Map<string, { nodeId: string; alias: string }>();
    for (const item of items) {
      const p = planMemory([...ns, ...addNodes], [...edges, ...addEdges], item, { personName: person.name, same });
      fresh.push(...p.fresh);
      addNodes.push(...p.nodes);
      addEdges.push(...p.edges);
      for (const a of p.aliases) aliases.set(`${a.nodeId}|${a.alias}`, a);
      entities.set(item.factId, p.entities);
    }
    return { addNodes, addEdges, entities, fresh, aliases: [...aliases.values()] };
  };
  // A new spelling of an existing node is remembered on it, so the next lookup is exact.
  const saveAliases = (list: { nodeId: string; alias: string }[]) =>
    Promise.all(list.map(({ nodeId, alias }) => db.$executeRaw`UPDATE "MemoryNode" SET "aliases" = array_append("aliases", ${alias}) WHERE "id" = ${nodeId} AND "personId" = ${person.id} AND NOT (${alias} = ANY("aliases"))`));
  let first = plan(nodes);
  // With a key that can embed: a new name that means an existing node ("curd" for "dahi") becomes its alias.
  const meaning = await resolveByMeaning(person.id, key, first.fresh);
  if (meaning.same.size) {
    same = meaning.same;
    first = plan(nodes);
  }
  if (first.addNodes.length) {
    await db.memoryNode.createMany({ data: first.addNodes.map((n) => ({ ...n, personId: person.id })), skipDuplicates: true });
    // The new nodes keep the vectors that were just computed for them.
    if (meaning.model) await storeEmbeddings(person.id, meaning.model, first.addNodes.flatMap((n) => (meaning.vectors.has(n.key) ? [{ id: n.id, vector: meaning.vectors.get(n.key)! }] : []))).catch(() => undefined);
    // Plan again against what is really stored, so edge endpoints are the surviving rows.
    const stored = await db.memoryNode.findMany({ where: { personId: person.id }, select: nodeSelect });
    const again = plan(stored);
    if (again.addEdges.length) await db.memoryEdge.createMany({ data: again.addEdges.map((e) => ({ ...e, personId: person.id })) });
    await saveAliases(again.aliases);
    await syncGraph(person);
    return { entities: again.entities, delta: { nodes: stored.filter((n) => !before.has(n.id)), edges: again.addEdges, aliases: again.aliases } };
  }
  await saveAliases(first.aliases);
  if (first.addEdges.length) await db.memoryEdge.createMany({ data: first.addEdges.map((e) => ({ ...e, personId: person.id })) });
  await syncGraph(person);
  return { entities: first.entities, delta: { nodes: [], edges: first.addEdges, aliases: first.aliases } };
}

/**
 * Bring what is derived from the graph in line with it, after anything that changed it (a write, a trashed or
 * restored memory, mined evidence, a removed chat): which edges a newer one has overtaken, and the stored findings.
 */
export async function syncGraph(person: { id: string }) {
  const [{ nodes, edges }, facts] = await Promise.all([
    loadGraphRows(person.id),
    db.personFact.findMany({ where: { personId: person.id, ...alive }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, feeling: true, valence: true } }),
  ]);
  const g = buildGraph(nodes, edges, facts);
  const next = new Map(edges.map((e) => [e.id, null as string | null]));
  for (const [wasId, by] of g.supersededBy) next.set(wasId, by.id);
  const changed = edges.filter((e) => e.storedSupersededById !== next.get(e.id));
  if (changed.length) await db.$transaction(changed.map((e) => db.memoryEdge.update({ where: { id: e.id }, data: { supersededById: next.get(e.id) ?? null } })));
  // Findings: new ones stored, changed ones updated, ones whose evidence is gone retired.
  const at = new Date();
  const stored = await db.memoryFinding.findMany({ where: { personId: person.id } });
  const d = diffFindings(stored, g.tensions([], 50, false, at.getTime()), at);
  if (d.create.length) await db.memoryFinding.createMany({ data: d.create.map((f) => ({ ...f, personId: person.id })), skipDuplicates: true });
  if (d.update.length || d.retire.length)
    await db.$transaction([
      ...d.update.map(({ key, ...f }) => db.memoryFinding.update({ where: { personId_key: { personId: person.id, key } }, data: f })),
      db.memoryFinding.updateMany({ where: { personId: person.id, key: { in: d.retire } }, data: { retiredAt: at } }),
    ]);
  return g;
}

/** After memories were erased (a wrong chat removed, a purge): drop the nodes nothing stands behind any more, with their edges. */
export async function pruneGraph(personId: string) {
  const { nodes, edges } = await loadGraphRows(personId);
  const gone = ungrounded(nodes, edges);
  if (gone.length) await db.memoryNode.deleteMany({ where: { personId, id: { in: gone } } });
  // Findings that rested on the erased memories retire; they return if the memories do (a chat moved back).
  await syncGraph({ id: personId });
  return gone.length;
}

/** Save new memories and tie them into the graph. Returns their ids, in order. */
export async function saveMemories(person: Person, facts: MemoryInput[], meta: { source: "ANALYSIS" | "COACH" | "USER"; analysisId?: string }, key?: EmbedKey) {
  if (!facts.length) return { ids: [] as string[], delta: emptyDelta() };
  const rows = facts.map(({ triples, ...f }) => ({ id: crypto.randomUUID(), triples, tags: f.entities, fact: f }));
  await db.personFact.createMany({ data: rows.map((r) => ({ ...r.fact, id: r.id, personId: person.id, ...meta })) });
  const { entities, delta } = await linkMemories(person, rows.map((r) => ({ factId: r.id, tags: r.tags, triples: r.triples })), key);
  // The cached tag list follows the graph: triples can name things the plain tags did not.
  const changed = rows.filter((r) => (entities.get(r.id) ?? []).join("|") !== r.fact.entities.join("|"));
  if (changed.length)
    await db.$transaction(changed.map((r) => db.personFact.update({ where: { id: r.id }, data: { entities: entities.get(r.id) ?? [] } })));
  return { ids: rows.map((r) => r.id), delta };
}

/**
 * `sameAs` from the category step: the asked node is the known one spelled another way. Its key becomes an alias,
 * its edges move onto the known node, and memories tagged with the old key follow. Then the asked node is deleted.
 */
export async function mergeNodes(personId: string, merges: { fromId: string; toId: string }[]) {
  let merged = false;
  for (const m of merges) {
    if (m.fromId === m.toId) continue;
    const [from, to] = await Promise.all([
      db.memoryNode.findFirst({ where: { id: m.fromId, personId }, select: { id: true, key: true, aliases: true } }),
      db.memoryNode.findFirst({ where: { id: m.toId, personId }, select: { id: true, key: true } }),
    ]);
    if (!from || !to || from.id === to.id) continue;
    const edges = await db.memoryEdge.findMany({ where: { personId, OR: [{ fromId: from.id }, { toId: from.id }] } });
    const aliases = [...new Set([from.key, ...from.aliases])].filter((a) => a !== to.key);
    await db.$transaction(async (tx) => {
      for (const alias of aliases)
        await tx.$executeRaw`UPDATE "MemoryNode" SET "aliases" = array_append("aliases", ${alias}) WHERE "id" = ${to.id} AND "personId" = ${personId} AND NOT (${alias} = ANY("aliases"))`;
      for (const e of edges) {
        const fromId = e.fromId === from.id ? to.id : e.fromId;
        const toId = e.toId === from.id ? to.id : e.toId;
        if (fromId === toId) {
          await tx.memoryEdge.delete({ where: { id: e.id } });
          continue;
        }
        const clash = await tx.memoryEdge.findFirst({ where: { personId, fromId, toId, rel: e.rel, factId: e.factId, label: e.label, NOT: { id: e.id } }, select: { id: true } });
        if (clash) await tx.memoryEdge.delete({ where: { id: e.id } });
        else await tx.memoryEdge.update({ where: { id: e.id }, data: { fromId, toId } });
      }
      const facts = await tx.personFact.findMany({ where: { personId, entities: { has: from.key } }, select: { id: true, entities: true, updatedAt: true } });
      for (const f of facts) {
        const entities = [...new Set(f.entities.map((tag) => (tag === from.key ? to.key : tag)))];
        if (entities.join("|") !== f.entities.join("|")) await tx.personFact.update({ where: { id: f.id }, data: { entities, updatedAt: f.updatedAt } });
      }
      await tx.memoryNode.delete({ where: { id: from.id } });
    });
    merged = true;
  }
  if (merged) await syncGraph({ id: personId });
}

/**
 * The user edited a memory's tags: its edges follow. Edges to things no longer tagged go; new tags get a MENTIONS edge.
 * Typed edges to tags that stay are kept.
 */
export async function retagMemory(person: Person, factId: string, tags: string[]) {
  // A tag may be another spelling of a node (its alias): edges to that node stay too.
  const keep = await db.memoryNode.findMany({ where: { personId: person.id, OR: [{ key: { in: [...tags, "them", "me"] } }, { aliases: { hasSome: tags } }] }, select: { id: true } });
  const ids = keep.map((n) => n.id);
  await db.memoryEdge.deleteMany({ where: { personId: person.id, factId, OR: [{ fromId: { notIn: ids } }, { toId: { notIn: ids } }] } });
  await linkMemories(person, [{ factId, tags }]);
}
