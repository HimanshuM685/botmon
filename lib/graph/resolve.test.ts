import { expect, it } from "vitest";
import { buildGraph, planMemory, type GEdge, type GNode, type Triple } from "../graph";
import { matchNode, nameScore, similarity, spellScore } from "./resolve";

const n = (key: string, aliases: string[] = []): GNode => ({ id: key, key, label: key, kind: "thing", aliases });

it("scores spellings: trigram, a name inside another, Hinglish transliterations", () => {
  expect(similarity("paneer", "paneer cubes")).toBeCloseTo(7 / 13); // under 0.6 on trigrams alone
  expect(nameScore("paneer", "paneer cubes")).toBe(1);
  expect(nameScore("sister", "little sister")).toBe(1);
  expect(nameScore("samosa", "samosas")).toBeGreaterThanOrEqual(0.6);
  // A trailing s is not identity. Trigrams still join a longer word ("samosa" / "samosas").
  for (const [a, b] of [["dog", "dogs"], ["day", "days"], ["new", "news"]]) expect(nameScore(a, b), `${a}/${b}`).toBeLessThan(0.6);
  for (const [a, b] of [["paneer", "panner"], ["paneer", "panir"], ["doodh", "dudh"], ["chai", "chaai"]]) expect(spellScore(a, b), `${a}/${b}`).toBeGreaterThanOrEqual(0.6);
  for (const [a, b] of [["milk", "malik"], ["cat", "cut"], ["coat", "cat"], ["job", "jab"], ["goa", "gym"], ["cheese", "chess"]]) expect(nameScore(a, b), `${a}/${b}`).toBeLessThan(0.6);
  expect(nameScore("me", "meera")).toBeLessThan(0.6); // too short to count as "inside"
});

it("matchNode: best candidate over the bar, aliases count, nothing when nothing is close", () => {
  const nodes = [n("cheese"), n("paneer", ["cottage cheese"]), n("sushi")];
  expect(matchNode("panner", nodes)?.key).toBe("paneer");
  expect(matchNode("cottage cheese cubes", nodes)?.key).toBe("paneer"); // through the alias
  expect(matchNode("cricket", nodes)).toBeUndefined();
});

/** Plan memories in order, the way the store does, applying the aliases it returns. */
function plan(items: { tags?: string[]; triples?: Triple[] }[]) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let id = 0;
  items.forEach((item, i) => {
    const p = planMemory(nodes, edges, { factId: `f${i}`, ...item }, { personName: "Riya", newId: () => `x${++id}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges);
    for (const a of p.aliases) nodes.find((x) => x.id === a.nodeId)!.aliases.push(a.alias);
  });
  return { nodes, edges };
}

it("Paneer and 'paneer cubes' are one node with an alias; the memory is tagged with the node's key", () => {
  const { nodes, edges } = plan([{ triples: [{ from: "them", rel: "LIKES", to: "Paneer" }] }, { tags: ["paneer cubes"] }, { tags: ["panner"] }]);
  const things = nodes.filter((x) => x.kind === "thing");
  expect(things).toHaveLength(1);
  expect(things[0]).toMatchObject({ key: "paneer", label: "Paneer", aliases: ["paneer cubes", "panner"] });
  expect(edges.filter((e) => e.toId === things[0].id).map((e) => e.rel)).toEqual(["LIKES", "MENTIONS", "MENTIONS"]);
  const again = planMemory(nodes, edges, { factId: "f9", tags: ["paneer cubes"] });
  expect(again).toMatchObject({ nodes: [], aliases: [], entities: ["paneer"] }); // now an exact alias hit
});

it("categories only match exactly: milk is never folded into milk product, in either order", () => {
  const a = plan([{ triples: [{ from: "them", rel: "AVOIDS", to: "milk" }] }, { triples: [{ from: "cheese", rel: "IS_A", to: "milk product" }] }]);
  expect(a.nodes.map((x) => x.key).sort()).toEqual(["cheese", "milk", "milk product", "them"]);
  const b = plan([{ triples: [{ from: "cheese", rel: "IS_A", to: "milk product" }] }, { triples: [{ from: "them", rel: "AVOIDS", to: "milk" }] }]);
  expect(b.nodes.map((x) => x.key).sort()).toEqual(["cheese", "milk", "milk product", "them"]);
  expect([...a.nodes, ...b.nodes].flatMap((x) => x.aliases)).toEqual([]);
  // Two spellings of one thing in one triple make no edge from a node to itself.
  expect(plan([{ tags: ["paneer"] }, { triples: [{ from: "paneer cubes", rel: "RELATED_TO", to: "paneer" }] }]).edges).toHaveLength(1);
});

it("lookups forgive spelling: resolve and mentioned find the node from a different spelling", () => {
  const { nodes, edges } = plan([{ triples: [{ from: "them", rel: "LIKES", to: "paneer" }] }, { tags: ["her sister"] }]);
  const g = buildGraph(nodes, edges, [{ id: "f0", kind: "FACT", text: "", happenedAt: null }, { id: "f1", kind: "FACT", text: "", happenedAt: null }]);
  expect(g.resolve("Panir")?.key).toBe("paneer");
  expect(g.mentioned("should i order panner tikka for her?").map((x) => x.key)).toEqual(["paneer"]); // "her" alone is not "her sister"
  expect(g.mentioned("what about pioneer square")).toEqual([]);
  // Words under 4 letters are not spelled against nodes, so "day" never becomes "days".
  const short = plan([{ tags: ["days"] }, { tags: ["news"] }, { tags: ["dogs"] }]);
  const words = buildGraph(short.nodes, short.edges, []);
  expect(words.mentioned("a new day for the dog")).toEqual([]);
  expect(words.mentioned("news and dogs").map((x) => x.key).sort()).toEqual(["dogs", "news"]);
});

it("by meaning: a name an embedding says is an existing node becomes its alias; without vectors nothing changes", async () => {
  const { contentWords, cosine, nearest } = await import("./resolve");
  const { embedModelFor } = await import("../ai/models");
  // Fixture vectors: dahi and curd point the same way, cricket elsewhere.
  const vec: Record<string, number[]> = { dahi: [0.9, 0.1, 0.05], curd: [0.88, 0.14, 0.02], cricket: [0.05, 0.1, 0.95] };
  expect(cosine(vec.dahi, vec.curd)).toBeGreaterThan(0.85);
  expect(cosine(vec.dahi, vec.cricket)).toBeLessThan(0.85);
  const stored = [{ id: "n1", vector: vec.dahi }, { id: "n2", vector: vec.cricket }];
  expect(nearest(vec.curd, stored)?.id).toBe("n1");
  expect(nearest([0, 1, 0], stored)).toBeUndefined();

  const { nodes, edges } = plan([{ triples: [{ from: "them", rel: "LIKES", to: "dahi" }] }]);
  const dahi = nodes.find((x) => x.key === "dahi")!;
  // Groq / Grok / OpenRouter: no vectors, so "curd" is a new node and is reported as fresh (worth a lookup).
  const without = planMemory(nodes, edges, { factId: "f9", tags: ["curd"] });
  expect(without.nodes.map((x) => x.key)).toEqual(["curd"]);
  expect(without.fresh.map((x) => x.key)).toEqual(["curd"]);
  // Gemini / OpenAI / NIM: the lookup said curd is dahi.
  const withVectors = planMemory(nodes, edges, { factId: "f9", tags: ["curd"] }, { same: new Map([["curd", dahi.id]]) });
  expect(withVectors).toMatchObject({ nodes: [], fresh: [], aliases: [{ nodeId: dahi.id, alias: "curd" }], entities: ["dahi"] });
  expect(embedModelFor("GEMINI")).toBe("gemini-embedding-001");
  expect([embedModelFor("GROQ"), embedModelFor("GROK"), embedModelFor("OPENROUTER")]).toEqual([null, null, null]);
  // A category is never the target of a fuzzy or meaning match, and is not looked up either.
  const cat = planMemory(nodes, edges, { factId: "f9", triples: [{ from: "dahi", rel: "IS_A", to: "milk product" }] });
  expect(cat.fresh).toEqual([]);

  expect(contentWords("should I take her for some curd rice near the station at 8?", ["station"])).toEqual(["take", "curd", "rice", "near"]);
});
