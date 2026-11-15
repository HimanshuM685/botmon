import { expect, it } from "vitest";
import { buildGraph, planMemory, type GEdge, type GFact, type GNode, type Triple } from "./graph";

/** Build a graph the way the app does: memories with triples, planned in order. */
function make(memories: { id: string; text: string; date?: string; feeling?: string; valence?: number; tags?: string[]; triples?: Triple[] }[], alive = memories.map((m) => m.id)) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  for (const m of memories) {
    const plan = planMemory(nodes, edges, { factId: m.id, tags: m.tags, triples: m.triples }, { personName: "Riya Sharma", newId: () => `x${++n}` });
    nodes.push(...plan.nodes);
    edges.push(...plan.edges);
  }
  const facts: GFact[] = memories.filter((m) => alive.includes(m.id)).map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: m.date ? new Date(m.date) : null, feeling: m.feeling, valence: m.valence }));
  return { g: buildGraph(nodes, edges, facts, { them: "Riya" }), nodes, edges };
}

const allergy = { id: "f1", text: "Allergic to milk", date: "2026-03-02", triples: [{ from: "them", rel: "AVOIDS", to: "Milk", label: "allergic" }, { from: "milk", rel: "IS_A", to: "milk product" }] };
const offer = {
  id: "f2", text: "Said she'd make me a cheese dish even though she doesn't like cheese", date: "2026-11-14", feeling: "caring", valence: 1,
  triples: [
    { from: "Riya", rel: "DISLIKES", to: "cheese" },
    { from: "them", rel: "DID_FOR", to: "cheese", label: "offered to cook it for me" },
    { from: "me", rel: "LIKES", to: "cheese" },
    { from: "cheese", rel: "IS_A", to: "milk product" },
  ],
};

it("the cheese scenario: an offer that costs her is found from the links, with both memories as evidence", () => {
  const { g } = make([allergy, offer]);
  const cheese = g.resolve("Cheese")!, milk = g.resolve("milk")!;
  expect(g.path(cheese.id, milk.id)!.map((e) => g.renderEdge(e))).toEqual(["cheese —IS_A→ milk product", "Milk —IS_A→ milk product"]);
  const cost = g.tensions().filter((t) => t.kind === "cost").map((t) => t.text).join("\n");
  expect(cost).toContain("Effort at a cost: Riya did or offered something with cheese (offered to cook it for me)");
  expect(cost).toContain('although they avoid Milk (allergic) [2026-03-02 "Allergic to milk"]');
  expect(cost).toContain("cheese and Milk are both under milk product");
  expect(cost).toContain("although they dislike cheese"); // the direct cost too
  expect(cost).toContain("felt caring +1");
  // The user's liking cheese is not hers: no "mixed" finding from it.
  expect(g.tensions().some((t) => t.kind === "mixed")).toBe(false);
});

it("a plan that touches what they avoid is flagged, through the category", () => {
  const { g } = make([allergy, { id: "f3", text: "Pizza place opened nearby", triples: [{ from: "pizza", rel: "PART_OF", to: "milk" }], tags: ["pizza"] }]);
  const pizza = g.mentioned("should I take her for Pizza on friday?");
  expect(pizza.map((n) => n.key)).toEqual(["pizza"]);
  const risk = g.tensions(pizza.map((n) => n.id));
  expect(risk).toHaveLength(1);
  expect(risk[0]).toMatchObject({ kind: "risk" });
  expect(risk[0].text).toContain("Careful with pizza: Riya avoid Milk (allergic)");
  expect(g.brief(pizza.map((n) => n.id))).toContain("! Careful with pizza");
  expect(g.brief()).toBe(""); // nothing to report without a focus: an allergy alone is not a tension
});

it("a trashed memory takes its edges out; knowledge edges stay", () => {
  const { g } = make([allergy, offer], ["f2"]);
  expect(g.tensions().map((t) => t.text).join("\n")).not.toContain("Allergic to milk");
  expect(g.edges.some((e) => e.rel === "IS_A" && g.name(e.fromId) === "Milk")).toBe(true);
});

it("planMemory: one node per name, the person's name is `them`, tags become MENTIONS unless a triple covers them", () => {
  const { nodes, edges, g } = make([offer, { id: "f4", text: "Her sister Riya K loves cheese", tags: ["Sister", "cheese"], triples: [{ from: "them", rel: "KNOWS", to: "sister", label: "sister" }] }]);
  expect(nodes.map((n) => n.key).sort()).toEqual(["cheese", "me", "milk product", "sister", "them"]);
  expect(nodes.find((n) => n.key === "sister")!.kind).toBe("person");
  const f4 = edges.filter((e) => e.factId === "f4").map((e) => g.renderEdge(e));
  expect(f4).toEqual(['Riya —KNOWS (sister)→ sister ["Her sister Riya K loves cheese"]', 'Riya —MENTIONS→ cheese ["Her sister Riya K loves cheese"]']);
  expect(edges.filter((e) => e.rel === "IS_A")).toHaveLength(1); // knowledge is added once, with no memory behind it
  expect(edges.find((e) => e.rel === "IS_A")!.factId).toBeNull();
  // Things in one memory are neighbours: from sister, cheese is one step away.
  expect(g.neighbours([g.resolve("sister")!.id], 1).map((e) => g.name(e.toId))).toContain("cheese");
});

it("broad categories don't relate everything; walks never pass through the person", () => {
  const foods = ["sushi", "pasta", "rice", "bread", "soup", "salad", "peanuts"].map((f, i) => ({ id: `k${i}`, text: `${f} is food`, triples: [{ from: f, rel: "IS_A", to: "food" }] }));
  const { g } = make([...foods, { id: "a", text: "Allergic to peanuts", triples: [{ from: "them", rel: "AVOIDS", to: "peanuts" }] }, { id: "b", text: "Cooked sushi for me", triples: [{ from: "them", rel: "DID_FOR", to: "sushi" }] }]);
  expect(g.tensions()).toEqual([]); // seven foods under "food": too broad to mean anything
  expect(g.path(g.resolve("sushi")!.id, g.resolve("peanuts")!.id)!.length).toBe(2); // via food, not via her
});

it("ungrounded: names a removed chat left behind go; a category linked to a live memory stays", async () => {
  const { ungrounded } = await import("./graph");
  const n = (id: string, key = id) => ({ id, key, label: key, kind: "thing", aliases: [] });
  const e = (fromId: string, toId: string, rel: string, factId: string | null) => ({ id: `${fromId}-${toId}`, fromId, toId, rel, label: null, factId });
  const nodes = [n("t", "them"), n("cheese"), n("milk product"), n("dairy"), n("stranger"), n("stranger kind")];
  const edges = [
    e("t", "cheese", "LIKES", "f1"), // a live memory
    e("cheese", "milk product", "IS_A", null),
    e("milk product", "dairy", "IS_A", null),
    e("stranger", "stranger kind", "IS_A", null), // left by erased memories
  ];
  expect(ungrounded(nodes, edges).sort()).toEqual(["stranger", "stranger kind"]);
  expect(ungrounded(nodes, []).sort()).toEqual(["cheese", "dairy", "milk product", "stranger", "stranger kind"].sort());
});
