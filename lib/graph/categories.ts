import { z } from "zod";
import { normalizeEntity } from "../facts";
import { HUBS, NARROW, UP, type GEdge, type GNode, type Triple } from "../graph";
import { matchNode } from "./resolve";

/**
 * Category enrichment: a new thing nobody linked to anything ("paneer") is asked, once, what it belongs under,
 * so it lands next to what the person avoids or likes ("milk product") without anyone having said so.
 * Pure: which nodes to ask about, the prompt, and which answers to accept. The model call is the caller's.
 */

/** Parents too broad to relate anything: everything under "food" is not alike. */
export const BROAD = new Set(
  "food foods thing things stuff item items object objects place places person people activity activities drink drinks animal animals concept topic topics product products other misc event events dish dishes meal meals item entity category noun".split(" "),
);

export const categoryAnswerSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe("The name exactly as given"),
      parents: z.array(z.string()).describe("0-2 narrow categories it is a kind of or made from, most specific first. Empty when none is narrow and useful."),
      sameAs: z.string().describe("A known name that means exactly the same thing (another language or spelling, e.g. doodh = milk), else empty string"),
    }),
  ),
});
export type CategoryAnswer = z.infer<typeof categoryAnswerSchema>["items"][number];

/** Things to ask about: plain things with nothing above them that are not themselves a category, not yet asked. */
export function needsCategory(nodes: GNode[], edges: GEdge[], asked: Set<string> = new Set()) {
  const up = edges.filter((e) => UP.has(e.rel));
  const child = new Set(up.map((e) => e.fromId)), parent = new Set(up.map((e) => e.toId));
  return nodes.filter((n) => n.kind === "thing" && !HUBS.has(n.key) && !asked.has(n.id) && !child.has(n.id) && !parent.has(n.id));
}

export function categoryPrompt(names: string[], known: string[]) {
  return `For each name below, from one person's life as it came up in their chats, say what narrow category it belongs under, so related things connect: cheese and paneer are both "milk product"; prawns are "shellfish"; a peanut chikki is "peanuts".
Rules:
- Only narrow categories whose members really are alike in what someone might avoid, fear, love or be allergic to. Never broad ones such as food, drink, thing, place, activity.
- Reuse a known name when it fits, spelled exactly as given.
- People, places, events and abstract topics (job, our fight, goa trip) usually have none: return an empty list.
- If a name means exactly the same as a known name (another language or spelling), give that in sameAs.

Known names: ${known.join(", ") || "none"}

Names:
${names.map((n) => `- ${n}`).join("\n")}`;
}

export type CategoryPlan = { triples: Triple[]; merges: { fromKey: string; toKey: string }[] };

/**
 * The knowledge edges to add from the model's answers, and the nodes that are an existing one under another name.
 * Dropped: broad parents, more than 2, a parent that is already full (more than NARROW children relate nothing,
 * see family() in lib/graph.ts), loops.
 * `sameAs` is a merge, not an edge: the asked node becomes an alias of the known one (applyMerges / mergeNodes).
 */
export function acceptCategories(answers: CategoryAnswer[], asked: GNode[], nodes: GNode[], edges: GEdge[]): CategoryPlan {
  const up = edges.filter((e) => UP.has(e.rel));
  const kids = new Map<string, number>();
  for (const e of up) kids.set(e.toId, (kids.get(e.toId) ?? 0) + 1);
  const find = (k: string) => nodes.find((n) => n.key === k) ?? nodes.find((n) => n.aliases.includes(k));
  const categories = nodes.filter((n) => kids.has(n.id));
  const below = (id: string, seen = new Set<string>()): Set<string> => {
    for (const e of up) if (e.toId === id && !seen.has(e.fromId)) below(e.fromId, seen.add(e.fromId));
    return seen;
  };
  const triples: Triple[] = [], merges: CategoryPlan["merges"] = [];
  for (const a of answers) {
    const node = asked.find((n) => n.key === normalizeEntity(a.name));
    if (!node) continue;
    const same = find(normalizeEntity(a.sameAs ?? ""));
    if (same && same.id !== node.id && !HUBS.has(same.key) && !below(node.id).has(same.id)) {
      merges.push({ fromKey: node.key, toKey: same.key });
      continue; // what the known one belongs under now covers this one too
    }
    let taken = 0;
    for (const p of a.parents ?? []) {
      const k = normalizeEntity(p);
      if (taken >= 2 || k.length < 2 || BROAD.has(k) || HUBS.has(k) || k === node.key) continue;
      const existing = find(k) ?? matchNode(k, categories); // "milk products" is the "milk product" already there
      if (existing && (existing.id === node.id || (kids.get(existing.id) ?? 0) >= NARROW || below(node.id).has(existing.id))) continue;
      triples.push({ from: node.key, rel: "IS_A", to: existing?.key ?? p.trim(), label: "" });
      if (existing) kids.set(existing.id, (kids.get(existing.id) ?? 0) + 1);
      taken++;
    }
  }
  return { triples, merges };
}

/**
 * Fold each merged node into the one it names: its key becomes an alias, its edges move, a self-edge or a
 * duplicate is dropped, and the node itself goes. Mutates `nodes` and `edges` in place (the arrays callers hold).
 */
export function applyMerges(nodes: GNode[], edges: GEdge[], merges: CategoryPlan["merges"]) {
  for (const m of merges) {
    const from = nodes.find((n) => n.key === m.fromKey);
    const to = nodes.find((n) => n.key === m.toKey);
    if (!from || !to || from.id === to.id || HUBS.has(from.key) || HUBS.has(to.key)) continue;
    for (const alias of [from.key, ...from.aliases]) if (alias !== to.key && !to.aliases.includes(alias)) to.aliases.push(alias);
    for (const e of edges) {
      if (e.fromId === from.id) e.fromId = to.id;
      if (e.toId === from.id) e.toId = to.id;
    }
    const seen = new Set<string>();
    const kept: GEdge[] = [];
    for (const e of edges) {
      if (e.fromId === e.toId) continue;
      const k = `${e.fromId}|${e.toId}|${e.rel}|${e.factId ?? ""}|${e.label ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(e);
    }
    edges.splice(0, edges.length, ...kept);
    const i = nodes.findIndex((n) => n.id === from.id);
    if (i >= 0) nodes.splice(i, 1);
  }
}
