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
