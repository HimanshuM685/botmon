import { expect, it } from "vitest";
import { buildGraph, planMemory, type GEdge, type GFact, type GNode, type Triple } from "../graph";
import { acceptCategories, applyMerges, categoryPrompt, needsCategory } from "./categories";
import { acceptTriples, needsTriples } from "./backfill";

function make(memories: { id: string; text: string; tags?: string[]; triples?: Triple[] }[]) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  const add = (item: { factId: string; tags?: string[]; triples?: Triple[] }) => {
    const p = planMemory(nodes, edges, item, { personName: "Riya", newId: () => `x${++n}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges);
  };
  for (const m of memories) add({ factId: m.id, tags: m.tags, triples: m.triples });
  const facts: GFact[] = memories.map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: null }));
  return { nodes, edges, add, graph: () => buildGraph(nodes, edges, facts, { them: "Riya" }) };
}

const allergy = { id: "f1", text: "Allergic to milk", triples: [{ from: "them", rel: "AVOIDS", to: "milk", label: "allergic" }, { from: "milk", rel: "IS_A", to: "milk product" }] };

it("a thing nobody categorised lands under what she avoids: paneer tikka becomes a risk against the milk allergy", () => {
  const g = make([allergy, { id: "f2", text: "She ordered paneer tikka", tags: ["paneer"] }]);
  const todo = needsCategory(g.nodes, g.edges);
  expect(todo.map((n) => n.key)).toEqual(["paneer"]); // milk has a parent, milk product is a category
  expect(categoryPrompt(todo.map((n) => n.label), ["milk product"])).toContain("Known names: milk product");
  // The (mocked) cheap model: a slightly different spelling of the known category, plus a broad one.
  const plan = acceptCategories([{ name: "paneer", parents: ["Milk products", "Food"], sameAs: "" }], todo, g.nodes, g.edges);
  expect(plan.triples).toEqual([{ from: "paneer", rel: "IS_A", to: "milk product", label: "" }]);
  expect(plan.merges).toEqual([]);
  g.add({ factId: "", triples: plan.triples });
  expect(g.nodes.filter((n) => n.key.startsWith("milk product"))).toHaveLength(1);
  expect(g.edges.at(-1)).toMatchObject({ rel: "IS_A", factId: null });
  const graph = g.graph();
  const risk = graph.tensions(graph.mentioned("paneer tikka for dinner with her?").map((n) => n.id));
  expect(risk.map((t) => t.kind)).toEqual(["risk"]);
  expect(risk[0].text).toContain("Careful with paneer: Riya avoid milk (allergic)");
  expect(needsCategory(g.nodes, g.edges)).toEqual([]); // nothing left to ask
});

it("answers are held to the rules: at most two parents, no broad or full categories, no loops, asked nodes only", () => {
  const kids = ["cheese", "butter", "ghee", "curd", "cream", "kheer"].map((k, i) => ({ id: `k${i}`, text: k, triples: [{ from: k, rel: "IS_A", to: "milk product" }] }));
  const g = make([...kids, { id: "t", text: "", tags: ["paneer", "sister", "doodh"] }, allergy]);
  const todo = needsCategory(g.nodes, g.edges, new Set([g.nodes.find((n) => n.key === "sister")!.id]));
  expect(todo.map((n) => n.key)).toEqual(["paneer", "doodh"]); // sister was already asked
  const out = acceptCategories(
    [
      { name: "paneer", parents: ["milk product", "thing", "curd cheese", "protein", "dairy"], sameAs: "" }, // milk product is full (7 with milk)
      { name: "doodh", parents: ["drink"], sameAs: "Milk" },
      { name: "cricket", parents: ["sport"], sameAs: "" }, // never asked
      { name: "cheese", parents: ["paneer"], sameAs: "" }, // not asked either
    ],
    todo, g.nodes, g.edges,
  );
  expect(out).toEqual({
    triples: [
      { from: "paneer", rel: "IS_A", to: "curd cheese", label: "" },
      { from: "paneer", rel: "IS_A", to: "protein", label: "" },
    ],
    merges: [{ fromKey: "doodh", toKey: "milk" }], // another language: one node, not an IS_A edge
  });
  applyMerges(g.nodes, g.edges, out.merges);
  g.add({ factId: "", triples: out.triples });
  const graph = g.graph();
  expect(graph.resolve("doodh")?.key).toBe("milk");
  expect(graph.tensions([graph.resolve("doodh")!.id]).map((t) => t.kind)).toEqual(["risk"]); // doodh is milk, and she is allergic
});

it("triple backfill: only never-edited memories without a typed edge; answers map back by number", () => {
  const t0 = new Date("2026-11-01T10:00:00Z");
  const fact = (id: string, text: string, edited = false) => ({ id, text, entities: ["cheese"], createdAt: t0, updatedAt: edited ? new Date(t0.getTime() + 60_000) : t0 });
  const facts = [fact("a", "Offered to make me a cheese dish"), fact("b", "Hates blue cheese", true), fact("c", "Allergic to milk")];
  const e = (factId: string, rel: string): GEdge => ({ id: `${factId}${rel}`, fromId: "them", toId: "x", rel, label: null, factId });
  const todo = needsTriples(facts, [e("a", "MENTIONS"), e("b", "MENTIONS"), e("c", "MENTIONS"), e("c", "AVOIDS")]);
  expect(todo.map((f) => f.id)).toEqual(["a"]); // b was edited by the user, c already has a typed edge
  const triple = { from: "them", rel: "DID_FOR", to: "cheese", label: "offered to cook" };
  expect(acceptTriples([{ n: 1, triples: [triple] }, { n: 1, triples: [triple] }, { n: 2, triples: [triple] }, { n: 3, triples: [] }], todo)).toEqual([{ factId: "a", tags: ["cheese"], triples: [triple] }]);
});
