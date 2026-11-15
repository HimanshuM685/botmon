import { expect, it } from "vitest";
import { buildGraph, planMemory, type GEdge, type GFact, type GNode, type Triple } from "../graph";
import { acceptEvidence, chunk, evidenceItem, evidencePrompt, renderItem } from "./evidence";
import { exportEdge } from "./export";

type Memory = { id: string; text: string; date?: string; triples?: Triple[] };
function make(memories: Memory[]) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  for (const m of memories) {
    const p = planMemory(nodes, edges, { factId: m.id, triples: m.triples }, { personName: "Riya", newId: () => `x${++n}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges);
  }
  const facts: GFact[] = memories.map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: m.date ? new Date(m.date) : null }));
  return { nodes, edges, graph: () => buildGraph(nodes, edges, facts, { them: "Riya" }) };
}

const say = (texts: [string, string][], day = 14) => texts.map(([sender, text], i) => ({ sender, text, ts: Date.UTC(2026, 10, day, 10, i) }));
const memories: Memory[] = [
  { id: "f1", text: "Allergic to milk", date: "2026-03-02", triples: [{ from: "them", rel: "AVOIDS", to: "milk", label: "allergic" }, { from: "milk", rel: "IS_A", to: "milk product" }] },
  { id: "f2", text: "Offered to make me a cheese dish though she doesn't like cheese", triples: [{ from: "them", rel: "DISLIKES", to: "cheese" }, { from: "them", rel: "DID_FOR", to: "cheese", label: "offered to cook" }, { from: "cheese", rel: "IS_A", to: "milk product" }] },
];

/** Mine one edge the way the job does, with the model's pick given by the test. */
function mine(g: ReturnType<typeof make>, msgs: ReturnType<typeof say>, rel: string, pick: { line: number; tone: string; polarity: number; confidence: number }) {
  const edge = g.edges.find((e) => e.rel === rel)!;
  const item = evidenceItem(edge, "claim", new Map(g.nodes.map((n) => [n.id, n])), msgs)!;
  const [found] = acceptEvidence([{ claim: 1, ...pick }], [item], msgs, "Me");
  if (found) Object.assign(edge, { at: new Date(found.ts), tone: found.tone, polarity: found.polarity, confidence: found.confidence, quoted: true, quoteSender: found.sender });
  return { item, found, edge };
}

it("the cheese offer gets its exact line, date and warm tone; the finding cites it and is surer", () => {
  const msgs = say([["Me", "i love cheese so much"], ["Riya", "ugh i don't like cheese"], ["Riya", "but i can make it for you even though i don't like it 🙂"], ["Me", "you're the best"]]);
  const g = make(memories);
  const { item, found, edge } = mine(g, msgs, "DID_FOR", { line: 1, tone: "Warm", polarity: 1, confidence: 0.9 });
  expect(msgs[item.hits[0]].text).toContain("cheese"); // candidates come from the node's name
  const block = renderItem(item, 1, msgs, 0);
  expect(block).toContain("  1>  [2026-11-14 10:0");
  expect(evidencePrompt([block], { me: "Me", them: "Riya" })).toContain("Claim 1: claim");
  expect(found).toMatchObject({ edgeId: edge.id, text: msgs[item.hits[0]].text, sender: msgs[item.hits[0]].sender === "Me" ? "me" : "them", tone: "warm" });
  const cost = g.graph().tensions().filter((t) => t.kind === "cost");
  expect(cost.length).toBeGreaterThan(0);
  expect(cost[0].text).toContain(`[2026-11-14 "Offered to make me a cheese dish though she doesn't like cheese", said warm] [q:${edge.id}]`);
  expect(cost[0]).toMatchObject({ confidence: 0.9 });
  expect(cost[0].edgeIds).toContain(edge.id);
});

it("a sarcastic offer is not an act of care: no cost finding; a reluctant one is, less surely", () => {
  const msgs = say([["Me", "make me cheese pasta"], ["Riya", "sure i'll make you cheese 🙄"]]);
  const g = make(memories);
  mine(g, msgs, "DID_FOR", { line: 1, tone: "sarcastic", polarity: -1, confidence: 0.8 });
  expect(g.graph().tensions().filter((t) => t.kind === "cost")).toEqual([]);
  const h = make(memories);
  mine(h, msgs, "DID_FOR", { line: 1, tone: "reluctant", polarity: 0, confidence: 0.6 });
  expect(h.graph().tensions().filter((t) => t.kind === "cost").map((t) => t.confidence)).toEqual([0.4, 0.4]);
});

it("picks are held to what was offered", () => {
  const msgs = say([["Riya", "i hate cheese"], ["Me", "ok"]]);
  const item = { edgeId: "e1", claim: "c", hits: [0] };
  expect(acceptEvidence([{ claim: 1, line: 2, tone: "warm", polarity: 0, confidence: 1 }], [item], msgs, "Me")).toEqual([]); // no such candidate
  expect(acceptEvidence([{ claim: 1, line: 0, tone: "warm", polarity: 0, confidence: 1 }], [item], msgs, "Me")).toEqual([]); // "none of them"
  expect(acceptEvidence([{ claim: 3, line: 1, tone: "warm", polarity: 0, confidence: 1 }], [item], msgs, "Me")).toEqual([]);
  expect(acceptEvidence([{ claim: 1, line: 1, tone: "furious", polarity: -9, confidence: 4 }], [item], msgs, "Me")).toEqual([{ edgeId: "e1", text: "i hate cheese", ts: msgs[0].ts, sender: "them", tone: null, polarity: -2, confidence: 1 }]);
  expect(chunk(["aaaa", "bb", "cccc", "d"], (s) => s.length, 6)).toEqual([["aaaa", "bb"], ["cccc", "d"]]);
});

it("a changed preference: the older edge is superseded, shown with its date, and kept as history", () => {
  const g = make([
    { id: "a", text: "Loves sushi", date: "2026-01-10", triples: [{ from: "them", rel: "LIKES", to: "sushi" }] },
    { id: "b", text: "Got food poisoning, can't stand sushi now", date: "2026-06-02", triples: [{ from: "them", rel: "DISLIKES", to: "sushi", label: "after food poisoning" }] },
  ]).graph();
  const sushi = g.resolve("sushi")!;
  expect(g.edges.map((e) => e.rel)).toEqual(["DISLIKES"]);
  expect(g.history(sushi.id).map((h) => `${h.was.rel} -> ${h.now.rel}`)).toEqual(["LIKES -> DISLIKES"]);
  const found = g.tensions();
  expect(found).toHaveLength(1);
  expect(found[0].text).toContain('Changed on 2026-06-02: Riya used to like sushi [2026-01-10 "Loves sushi"], now they dislike it (after food poisoning)');
  expect(found[0].text).not.toContain("Check the dates");
});

it("a later liking never overtakes an allergy; an undated newer memory still counts as newer", () => {
  const g = make([
    { id: "a", text: "Allergic to peanuts", date: "2026-01-10", triples: [{ from: "them", rel: "AVOIDS", to: "peanuts", label: "allergic" }] },
    { id: "b", text: "Said she loves peanut butter", date: "2026-06-02", triples: [{ from: "them", rel: "LIKES", to: "peanuts" }] },
  ]).graph();
  expect(g.edges.map((e) => e.rel).sort()).toEqual(["AVOIDS", "LIKES"]);
  expect(g.tensions().map((t) => t.kind)).toEqual(["mixed"]);
  const h = make([
    { id: "a", text: "Wants to visit Goa", date: "2026-01-10", triples: [{ from: "them", rel: "WANTS", to: "goa" }] },
    { id: "b", text: "Is scared of Goa after the accident", triples: [{ from: "them", rel: "FEARS", to: "goa" }] },
  ]).graph();
  expect(h.edges.map((e) => e.rel)).toEqual(["FEARS"]);
  expect(h.tensions()[0].text).toContain("Changed (date unknown)");
});

it("export: the quote is decrypted and no BigInt is left", () => {
  const out = exportEdge({ id: "e", rel: "LIKES", quoteCipher: "x9", quoteTs: BigInt(1763114640000) }, (b) => `plain:${b}`);
  expect(out).toEqual({ id: "e", rel: "LIKES", quoteTs: 1763114640000, quote: "plain:x9" });
  expect(JSON.stringify(exportEdge({ quoteCipher: null, quoteTs: null }, String))).toBe('{"quoteTs":null,"quote":null}');
});
