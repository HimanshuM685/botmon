import { MAX_TAGS, normalizeEntity } from "./facts";
import { MATCH_MIN, matchNode, spellScore } from "./graph/resolve";
import { collectTensions } from "./graph/tensions";

/**
 * The memory graph: people, places and things as nodes, typed directed edges between them, each edge backed
 * by the memory (PersonFact) it was learned from. Pure and in-memory: rows in, answers out, no database.
 * ponytail: traversal runs in memory per request (a person has hundreds of edges); move to recursive SQL past ~10k.
 */

/** What an edge can say. `label` on the edge carries the detail ("allergic", "sister", "offered to cook"). */
export const RELS = ["LIKES", "WANTS", "DISLIKES", "AVOIDS", "FEARS", "DID_FOR", "IS_A", "PART_OF", "RELATED_TO", "KNOWS", "MENTIONS"] as const;
export type Rel = (typeof RELS)[number];
/** What a model may write. MENTIONS is only made by code, from plain tags. */
export const TRIPLE_RELS = RELS.filter((r) => r !== "MENTIONS") as Exclude<Rel, "MENTIONS">[];

export type Triple = { from: string; rel: string; to: string; label?: string };
export type GNode = { id: string; key: string; label: string; kind: string; aliases: string[]; /** The embedding model its label was embedded with, if any. */ embedModel?: string | null };
export type GEdge = {
  id: string; fromId: string; toId: string; rel: string; label: string | null; factId: string | null;
  /** Evidence, once the chat was mined for it (lib/graph/evidence.ts): when it was said, how, and by whom. */
  at?: Date | null;
  tone?: string | null;
  polarity?: number | null;
  /** A chat line is stored for this edge; the coach reads it with the quote tool. Never the line itself. */
  quoted?: boolean;
  quoteSender?: string | null;
  confidence?: number;
};
export type GFact = { id: string; kind: string; text: string; happenedAt: Date | null; feeling?: string | null; valence?: number | null };

/** The two fixed nodes every person's graph has: the person, and the user. */
export const THEM = "them", ME = "me";
export const HUBS = new Set([THEM, ME]);
/** Belongs-under edges: "cheese IS_A milk product", "cheese PART_OF milk" (made from). */
export const UP = new Set<string>(["IS_A", "PART_OF"]);
const POSITIVE = new Set<string>(["LIKES", "WANTS"]);
const NEGATIVE = new Set<string>(["DISLIKES", "AVOIDS", "FEARS"]);
/** A category with more children than this ("food") is too broad for its children to count as related. */
export const NARROW = 6;

const isRel = (r: string): r is Rel => (RELS as readonly string[]).includes(r);

/** A triple endpoint as a node key: "them"/"me", the person's own name (= them), or a normalised entity. */
export function endpointKey(name: string, personName = "") {
  const k = normalizeEntity(name);
  if (HUBS.has(k)) return k;
  if (["i", "user", "the user", "myself"].includes(k)) return ME;
  const person = normalizeEntity(personName);
  if (k && person && (k === person || k === person.split(" ")[0])) return THEM;
  return k;
}

/**
 * What one memory adds to the graph: the nodes to create and the edges to add. Pure, so every caller that
 * plans from the same rows gets the same nodes and edges. A coach turn that just saved applies the store's
 * delta instead of planning the memory a second time.
 * - a triple becomes an edge backed by the memory; IS_A / PART_OF are knowledge, not backed by a memory, added once
 * - a plain tag no triple covers becomes `them MENTIONS tag`
 * - a name that is an existing node spelled differently (lib/graph/resolve.ts) is that node, and is returned in
 *   `aliases` for the caller to store. Categories (what other things belong under) only match exactly.
 * Returns `entities`: the non-hub node keys this memory touches (cached on the fact for the timeline and map).
 */
export function planMemory(
  nodes: GNode[],
  edges: GEdge[],
  item: { factId: string; tags?: string[]; triples?: Triple[] },
  opts: {
    personName?: string;
    newId?: () => string;
    /** Names that mean an existing node although they are spelled nothing alike (found by embedding): key -> node id. */
    same?: Map<string, string>;
  } = {},
) {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const byKey = new Map<string, GNode>();
  for (const n of nodes) {
    byKey.set(n.key, n);
    for (const a of n.aliases) if (!byKey.has(a)) byKey.set(a, n);
  }
  const addNodes: GNode[] = [], addEdges: GEdge[] = [];
  const aliases: { nodeId: string; alias: string }[] = [];
  /** New nodes that no spelling matched: the ones worth an embedding lookup before they are created. */
  const fresh: GNode[] = [];
  const categories = new Set(edges.filter((e) => UP.has(e.rel)).map((e) => e.toId));
  const node = (key: string, label: string, kind = "thing", exact = false) => {
    let n = byKey.get(key);
    if (!n && !exact && !HUBS.has(key)) {
      n = matchNode(key, [...nodes, ...addNodes].filter((c) => !HUBS.has(c.key) && !categories.has(c.id))) ?? nodes.find((c) => c.id === opts.same?.get(key) && !categories.has(c.id));
      if (n) {
        byKey.set(key, n);
        if (addNodes.includes(n)) n.aliases.push(key);
        else aliases.push({ nodeId: n.id, alias: key });
      }
    }
    if (!n) {
      n = { id: newId(), key, label: HUBS.has(key) ? key : label.trim().slice(0, 60) || key, kind: HUBS.has(key) ? key : kind, aliases: [] };
      byKey.set(key, n);
      addNodes.push(n);
      if (!exact && !HUBS.has(key)) fresh.push(n);
    }
    return n;
  };
  const has = (fromId: string, toId: string, rel: string, factId: string | null) =>
    [...edges, ...addEdges].some((e) => e.fromId === fromId && e.toId === toId && e.rel === rel && e.factId === factId);
  const touched = new Set<string>();
  const touch = (n: GNode) => !HUBS.has(n.key) && touched.add(n.key);

  for (const t of item.triples ?? []) {
    const [fk, tk] = [endpointKey(t.from, opts.personName), endpointKey(t.to, opts.personName)];
    if (fk.length < 2 || tk.length < 2 || fk === tk) continue;
    const rel = isRel(t.rel) && t.rel !== "MENTIONS" ? t.rel : "RELATED_TO";
    const up = UP.has(rel);
    if (up && (HUBS.has(fk) || HUBS.has(tk))) continue;
    const from = node(fk, t.from), to = node(tk, t.to, rel === "KNOWS" ? "person" : "thing", up);
    if (from.id === to.id) continue; // two spellings of one thing
    if (up) categories.add(to.id);
    touch(from);
    touch(to);
    const factId = up ? null : item.factId;
    if (!has(from.id, to.id, rel, factId)) addEdges.push({ id: newId(), fromId: from.id, toId: to.id, rel, label: t.label?.trim().slice(0, 80) || null, factId });
  }
  for (const tag of item.tags ?? []) {
    const k = normalizeEntity(tag);
    if (k.length < 2 || HUBS.has(k)) continue;
    const n = node(k, tag);
    if (touched.has(n.key)) continue; // a triple already ties this memory to it
    touch(n);
    const them = node(THEM, THEM);
    if (!has(them.id, n.id, "MENTIONS", item.factId)) addEdges.push({ id: newId(), fromId: them.id, toId: n.id, rel: "MENTIONS", label: null, factId: item.factId });
  }
  return { nodes: addNodes, edges: addEdges, aliases, fresh, entities: [...touched].slice(0, MAX_TAGS) };
}

/**
 * Nodes nothing stands behind any more: no memory-backed edge of their own, and no chain of knowledge edges
 * (IS_A / PART_OF) to a node that has one. "milk product" stays while a memory about cheese exists; the names a
 * removed chat brought in go once its memories are erased. The two hubs are never returned.
 */
export function ungrounded(nodes: GNode[], edges: GEdge[]): string[] {
  const grounded = new Set(edges.filter((e) => e.factId).flatMap((e) => [e.fromId, e.toId]));
  const knowledge = edges.filter((e) => !e.factId);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of knowledge)
      if (grounded.has(e.fromId) !== grounded.has(e.toId)) {
        grounded.add(e.fromId).add(e.toId);
        grew = true;
      }
  }
  return nodes.filter((n) => !HUBS.has(n.key) && !grounded.has(n.id)).map((n) => n.id);
}

/**
 * A finding. `key` is stable across requests (it names the nodes, not the wording), so findings can be stored and
 * recognised again; `edgeIds` is the evidence; `confidence` 0..1 follows how the evidence was said.
 */
export type Tension = { kind: "cost" | "mixed" | "risk" | "attention" | "drift" | "open_promise"; key: string; text: string; edgeIds: string[]; confidence: number };

/**
 * Edges a newer edge has overtaken: same two nodes, one side a liking (LIKES, WANTS), the other an aversion
 * (DISLIKES, AVOIDS, FEARS), from different memories. Returns older edge id -> the edge that replaced it.
 * A newer liking never overtakes AVOIDS or FEARS: enjoying a milkshake once does not cancel an allergy.
 * `order` gives each edge's place in time (its own date, else its memory's), larger is newer.
 */
export function superseded(edges: GEdge[], order: (e: GEdge) => number): Map<string, GEdge> {
  const out = new Map<string, GEdge>();
  const attitude = edges.filter((e) => POSITIVE.has(e.rel) || NEGATIVE.has(e.rel));
  for (const a of attitude)
    for (const b of attitude) {
      if (a.fromId !== b.fromId || a.toId !== b.toId || a.factId === b.factId || POSITIVE.has(a.rel) === POSITIVE.has(b.rel)) continue;
      if (order(b) <= order(a) || (POSITIVE.has(b.rel) && a.rel !== "DISLIKES")) continue;
      const by = out.get(a.id);
      if (!by || order(b) > order(by)) out.set(a.id, b); // the newest opposite wins
    }
  return out;
}

export type Graph = ReturnType<typeof buildGraph>;

/**
 * Index the rows for querying. Edges whose memory is gone (trashed, so not in `facts`) are left out.
 * `names`: how the two hubs read in prompts, e.g. { them: "Riya", me: "the user" }.
 */
export function buildGraph(nodes: GNode[], allEdges: GEdge[], facts: GFact[], names: { them?: string; me?: string } = {}) {
  const fact = new Map(facts.map((f) => [f.id, f]));
  // `facts` runs oldest first (then undated, then what was saved this turn): its position is an edge's age.
  const age = new Map(facts.map((f, i) => [f.id, i]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = allEdges.filter((e) => byId.has(e.fromId) && byId.has(e.toId) && (!e.factId || fact.has(e.factId)));
  // When an edge is from: the quoted line's time, else its memory's date. Without either, the memory's place in the list.
  const when = (e: GEdge) => e.at?.getTime() ?? (e.factId ? fact.get(e.factId)?.happenedAt?.getTime() : undefined);
  const order = (e: GEdge) => when(e) ?? 8.64e15 + (e.factId ? age.get(e.factId) ?? 0 : 0); // undated memories come last in `facts`
  // What a newer memory has overtaken ("used to like sushi") leaves the working graph; history() still has it.
  const replaced = superseded(live, order);
  const edges = live.filter((e) => !replaced.has(e.id));
  const out = new Map<string, GEdge[]>(), into = new Map<string, GEdge[]>(), aboutFact = new Map<string, Set<string>>();
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => void (m.get(k)?.push(v) ?? m.set(k, [v]));
  const hub = (id: string) => HUBS.has(byId.get(id)!.key);
  for (const e of edges) {
    push(out, e.fromId, e);
    push(into, e.toId, e);
    if (e.factId) for (const id of [e.fromId, e.toId]) if (!hub(id)) (aboutFact.get(e.factId) ?? aboutFact.set(e.factId, new Set()).get(e.factId)!).add(id);
  }
  const touching = (id: string) => [...(out.get(id) ?? []), ...(into.get(id) ?? [])];
  const them = nodes.find((n) => n.key === THEM);
  const name = (id: string) => {
    const n = byId.get(id)!;
    return n.key === THEM ? names.them ?? "they" : n.key === ME ? names.me ?? "the user" : n.label;
  };

  /** Find a node by what someone typed: exact key or alias first, then a whole-word overlap (the best-connected wins). */
  function resolve(text: string): GNode | undefined {
    const k = endpointKey(text, names.them);
    if (!k) return undefined;
    const exact = nodes.find((n) => n.key === k) ?? nodes.find((n) => n.aliases.includes(k));
    if (exact) return exact;
    const q = ` ${k} `;
    const things = nodes.filter((n) => !HUBS.has(n.key));
    return (
      things.filter((n) => q.includes(` ${n.key} `) || ` ${n.key} `.includes(q)).sort((a, b) => touching(b.id).length - touching(a.id).length)[0] ??
      matchNode(k, things) // a different spelling
    );
  }

  /**
   * Every non-hub node named in a piece of text (a user message): by key or alias as whole words, or a one-word
   * name spelled differently ("panner" for paneer).
   */
  function mentioned(text: string): GNode[] {
    // Not normalizeEntity: that cuts to key length, and this is a whole message.
    const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
    const words = [...new Set(t.trim().split(" "))].filter((w) => w.length >= 4);
    return nodes.filter((n) => !HUBS.has(n.key) && [n.key, ...n.aliases].some((k) => k.length > 1 && (t.includes(` ${k} `) || (k.length >= 4 && !k.includes(" ") && words.some((w) => spellScore(w, k) >= MATCH_MIN)))));
  }

  /** What a node belongs under, nearest first: up IS_A / PART_OF, at most 3 levels. */
  function ancestors(id: string): string[] {
    const seen: string[] = [];
    let level = [id];
    for (let d = 0; d < 3 && level.length; d++) {
      level = level.flatMap((x) => (out.get(x) ?? []).filter((e) => UP.has(e.rel)).map((e) => e.toId)).filter((x) => x !== id && !seen.includes(x));
      seen.push(...new Set(level));
    }
    return [...new Set(seen)];
  }
  const children = (id: string) => (into.get(id) ?? []).filter((e) => UP.has(e.rel)).map((e) => e.fromId);

  /**
   * The node, what it belongs under, what belongs under it, and its siblings under a narrow shared category
   * (cheese and milk under "milk product"): the things an attitude towards one of them says something about.
   * ponytail: siblings only under categories with at most NARROW children, so "food" doesn't relate everything.
   */
  function family(id: string): Map<string, "itself" | "kind" | "related"> {
    const fam = new Map<string, "itself" | "kind" | "related">([[id, "itself"]]);
    const up = ancestors(id);
    for (const a of up) fam.set(a, "kind");
    for (const c of children(id)) if (!fam.has(c)) fam.set(c, "kind");
    for (const a of up) {
      const kids = children(a);
      if (kids.length <= NARROW) for (const s of kids) if (!fam.has(s)) fam.set(s, "related");
    }
    return fam;
  }

  /** Edges reachable from the start nodes, nearest first. Never walks through the hubs (everything touches them). */
  function neighbours(startIds: string[], depth = 2, max = 40): GEdge[] {
    const seenNodes = new Set(startIds), found = new Map<string, GEdge>();
    let level = startIds;
    for (let d = 0; d < depth && level.length && found.size < max; d++) {
      const next: string[] = [];
      for (const id of level) {
        if (hub(id)) continue;
        const linked = [...touching(id)];
        // Things in the same memory are neighbours too, even without an edge between them.
        for (const e of touching(id)) if (e.factId) for (const other of aboutFact.get(e.factId) ?? []) if (other !== id) linked.push(...touching(other).filter((x) => x.factId === e.factId));
        for (const e of linked) {
          if (found.size >= max) break;
          if (!found.has(e.id)) found.set(e.id, e);
          for (const n of [e.fromId, e.toId]) {
            if (seenNodes.has(n)) continue;
            seenNodes.add(n);
            next.push(n);
          }
        }
      }
      level = next;
    }
    return [...found.values()];
  }

  /** Shortest chain of edges between two nodes (at most 4), not through the hubs unless one is an endpoint. */
  function path(aId: string, bId: string): GEdge[] | null {
    if (aId === bId) return [];
    const prev = new Map<string, { from: string; edge: GEdge }>();
    let level = [aId];
    const seen = new Set(level);
    for (let d = 0; d < 4 && level.length; d++) {
      const next: string[] = [];
      for (const id of level) {
        if (hub(id) && id !== aId) continue;
        for (const e of touching(id)) {
          const other = e.fromId === id ? e.toId : e.fromId;
          if (seen.has(other)) continue;
          seen.add(other);
          prev.set(other, { from: id, edge: e });
          if (other === bId) {
            const chain: GEdge[] = [];
            for (let at = bId; at !== aId; at = prev.get(at)!.from) chain.unshift(prev.get(at)!.edge);
            return chain;
          }
          next.push(other);
        }
      }
      level = next;
    }
    return null;
  }

  /** The `n` edges to keep when there are too many: knowledge edges, then the newest memories. Order is kept. */
  function newest(list: GEdge[], n: number) {
    if (list.length <= n) return list;
    const rank = (e: GEdge) => (e.factId ? age.get(e.factId) ?? 0 : Infinity);
    const keep = new Set([...list].sort((a, b) => rank(b) - rank(a)).slice(0, n));
    return list.filter((e) => keep.has(e));
  }

  const day = (d: Date) => d.toISOString().slice(0, 10);
  /** The memory behind an edge, with how it was said when the chat line is known. `[q:id]`: the quote tool has the line. */
  const evidence = (e: GEdge) => {
    const f = e.factId ? fact.get(e.factId) : undefined;
    if (!f) return "";
    const felt = f.feeling ? `, felt ${f.feeling}${f.valence ? ` ${f.valence > 0 ? "+" : ""}${f.valence}` : ""}` : "";
    const date = e.at ?? f.happenedAt;
    return ` [${date ? `${day(date)} ` : ""}"${f.text.slice(0, 140)}"${felt}${e.tone ? `, said ${e.tone}` : ""}]${e.quoted ? ` [q:${e.id}]` : ""}`;
  };

  /** What they used to feel about a node, each with the edge that replaced it, oldest first. */
  function history(nodeId: string) {
    return [...replaced.entries()]
      .map(([id, by]) => ({ was: live.find((e) => e.id === id)!, now: by }))
      .filter((h) => h.was.fromId === nodeId || h.was.toId === nodeId)
      .sort((a, b) => order(a.was) - order(b.was));
  }
  const renderEdge = (e: GEdge) => `${name(e.fromId)} —${e.rel}${e.label ? ` (${e.label})` : ""}→ ${name(e.toId)}${evidence(e)}`;

  /** How two family members hang together, in words: "cheese and milk are both kinds of milk product". */
  function link(x: string, y: string, how: "itself" | "kind" | "related") {
    if (how === "itself") return "";
    if (how === "kind") return ` (${name(x)} and ${name(y)} are linked: ${(path(x, y) ?? []).map((e) => `${name(e.fromId)} ${e.rel} ${name(e.toId)}`).join(", ")})`;
    const shared = ancestors(x).find((a) => children(a).includes(y));
    return ` (${name(x)} and ${name(y)} are both under ${shared ? name(shared) : "the same thing"})`;
  }

  /** Findings from the shape of the graph (lib/graph/tensions.ts). Only `risk` depends on `focus`. */
  function tensions(focus: string[] = [], max = 8, local = false, now = Date.now()): Tension[] {
    return collectTensions({
      themId: them?.id, meId: nodes.find((n) => n.key === ME)?.id, nodes, edges, live, replaced, clock: now, name, family, touching, evidence, link, when, order, hub,
    }, focus, local, max);
  }

  /** The part of the graph around some nodes, as a prompt block: their edges out to `hops`, then the tensions. */
  /** A finding as a prompt line. Ones in `fresh` (first seen since the conversation's last turn) say so and come first. */
  const lines = (list: Tension[], fresh?: Set<string>) =>
    [...list].sort((a, b) => Number(!!fresh?.has(b.key)) - Number(!!fresh?.has(a.key))).map((x) => `! ${fresh?.has(x.key) ? "New since we last spoke: " : ""}${x.text}`);

  function renderSubgraph(focusIds: string[], hops = 2, max = 40, fresh?: Set<string>) {
    const lines_ = newest(neighbours(focusIds, hops, 400), max).map((e) => `- ${renderEdge(e)}`);
    const t = lines(tensions(focusIds, 8, true), fresh);
    return [lines_.length ? `Linked to what is being discussed (${focusIds.map(name).join(", ")}):\n${lines_.join("\n")}` : "", t.length ? `What the links show:\n${t.join("\n")}` : ""].filter(Boolean).join("\n");
  }

  /** For prompts: the subgraph around `focusIds` when there are any, then whatever else the links show overall. */
  function brief(focusIds: string[] = [], fresh?: Set<string>) {
    const local = focusIds.length ? renderSubgraph(focusIds, 2, 40, fresh) : "";
    const rest = lines(tensions([], 6), fresh).filter((line) => !local.includes(line));
    return [local, rest.length ? `${local ? "Elsewhere in the graph" : "What the links between memories show"}:\n${rest.join("\n")}` : ""].filter(Boolean).join("\n");
  }

  /** Node labels, best-connected first: shown to models so they reuse names instead of inventing new ones. */
  const known = (max = 150) =>
    nodes.filter((n) => !HUBS.has(n.key)).sort((a, b) => touching(b.id).length - touching(a.id).length).slice(0, max).map((n) => n.label);

  return { nodes, edges, resolve, mentioned, ancestors, family, neighbours, path, tensions, history, renderEdge, renderSubgraph, brief, known, name, newest, supersededBy: replaced };
}
