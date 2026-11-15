import { expect, it } from "vitest";
import { buildScenario, loadScenarios } from "./scenarios";

const scenarios = loadScenarios();

it("there is a fixture for every case the brain must handle", () => {
  expect(scenarios.map((s) => s.name)).toEqual(["changed-preference", "cheese-cost", "cooling", "hinglish-paneer-doodh", "memory-only", "open-promise", "remembered-detail", "sarcastic-fake-cost", "seafood-date", "sibling"]);
});

it.each(scenarios.map((s) => [s.name, s] as const))("%s: expected edges and findings", (_, s) => {
  const { graph, findings, nodes, plain } = buildScenario(s);
  const have = graph.edges.map(plain);
  for (const e of s.expect.edges) expect(have, s.about).toContain(e);
  for (const e of s.notEdges ?? []) expect(have).not.toContain(e);
  const kinds = [...new Set(findings.map((f) => f.kind))].sort();
  expect(kinds, s.about).toEqual([...s.expect.findings].sort());
  for (const k of s.not ?? []) expect(kinds).not.toContain(k);
  if (s.expect.text) expect(findings.map((f) => f.text).join("\n")).toContain(s.expect.text);
  // A finding that rests on a quoted line points at it, so the coach can read and cite the exact words.
  if (s.expect.quote && s.expect.findings.length) expect(findings.some((f) => /\[q:x\d+\]/.test(f.text)), "quote marker").toBe(true);
  for (const [key, aliases] of Object.entries(s.expect.aliases ?? {})) expect(nodes.find((n) => n.key === key)?.aliases).toEqual(aliases);
  for (const [key, kind] of Object.entries(s.expect.kinds ?? {})) expect(nodes.find((n) => n.key === key)?.kind).toBe(kind);
  for (const name of s.expect.history ?? []) expect(graph.history(graph.resolve(name)!.id)).toHaveLength(1);
  for (const [key, near] of Object.entries(s.expect.neighbours ?? {})) expect(graph.neighbours([graph.resolve(key)!.id], 1).flatMap((e) => [graph.name(e.fromId), graph.name(e.toId)])).toEqual(expect.arrayContaining(near));
});
