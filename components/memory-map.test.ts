import { expect, it } from "vitest";
import { layout } from "./memory-map";

const f = (id: string, entities: string[]) => ({ id, kind: "FACT", text: id, entities });

it("makes hubs from shared tags and hangs each memory off one, noting cross-links", () => {
  const { hubs, nodes, loose } = layout([f("a", ["riya", "wedding"]), f("b", ["riya"]), f("c", ["wedding"]), f("d", ["job"]), f("e", [])]);
  expect(hubs.map((h) => `${h.name}:${h.n}`)).toEqual(["riya:2", "wedding:2", "job:1"]);
  expect(nodes).toHaveLength(4);
  expect(nodes.find((n) => n.fact.id === "a")).toMatchObject({ home: "riya", also: ["wedding"] });
  expect(loose).toBe(1);
  expect(new Set(nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`)).size).toBe(4); // no two memories on the same spot
});

it("typed edges sit on their topic's spoke, coloured by tone; findings flag the topics they rest on", async () => {
  const { edgeColor } = await import("./memory-map");
  const edge = (id: string, from: string, to: string, rel: string, tone: string | null = null, quoted = false) => ({ id, from, to, rel, label: null, tone, at: null, quoted });
  const edges = [edge("e1", "them", "cheese", "DISLIKES"), edge("e2", "them", "cheese", "DID_FOR", "warm", true), edge("e3", "me", "cheese", "LIKES"), edge("e4", "them", "ghost", "LIKES"), edge("e5", "cheese", "milk", "IS_A")];
  const { hubs, marks, flags } = layout([f("a", ["cheese"]), f("b", ["cheese", "milk"]), f("c", ["milk"])], edges, [{ kind: "cost", text: "Effort at a cost", edgeIds: ["e2", "e1", "gone"] }]);
  expect(marks.map((m) => `${m.edge.id}@${m.hub}`)).toEqual(["e1@cheese", "e2@cheese", "e3@cheese"]); // no hub for "ghost"; topic-to-topic edges are drawn as relations
  const cheese = hubs.find((h) => h.name === "cheese")!;
  const along = (m: { x: number; y: number }) => Math.hypot(m.x - 360, m.y - 230) / Math.hypot(cheese.x - 360, cheese.y - 230);
  expect(marks.map((m) => Math.round(along(m) * 100))).toEqual([42, 55, 68]); // strung out between the person and the topic
  expect([...flags.keys()]).toEqual(["cheese"]);
  expect(edgeColor(edges[1])).toBe("var(--mint)"); // warm tone wins over the link's own colour
  expect(edgeColor(edges[0])).toBe("var(--amber)");
  expect(edgeColor(edge("x", "them", "milk", "AVOIDS"))).toBe("var(--heart)");
  expect(edgeColor(edge("x", "them", "cheese", "DID_FOR", "sarcastic"))).toBe("var(--amber)");
  expect(layout([f("a", ["riya"])])).toMatchObject({ marks: [], flags: new Map() }); // older callers: nothing extra
});
