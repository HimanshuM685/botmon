import { expect, it } from "vitest";
import { applyPatch, changedSince, enoughMemory } from "./model";
import { computeScore } from "./stats";
import type { Analysis, ModelPatch } from "./ai/schema";

const lvl = (level: number) => ({ level, evidence: "x", tip: "" });
const signals = (n: number) => ({ reciprocity: lvl(n), warmth: lvl(n), selfDisclosure: lvl(n), curiosityAboutUser: lvl(n), futureTalk: lvl(n), effort: lvl(n), consistency: lvl(n) });
const read = {
  status: { label: "Warm", trend: "steady", confidence: "low", explanation: "old", score: 50 },
  signals: signals(2),
  mind: { investment: "even" },
  emotional: { currentMood: "calm", triggers: [], comforts: [] },
  personality: { summary: "kind", traits: [] },
  nextMoves: [{ action: "old move", why: "", when: "" }],
  messageSuggestions: ["old"],
} as unknown as Analysis;
const patch = (over: Partial<ModelPatch>): ModelPatch => ({
  whatChanged: "they fought", status: null, signals: null, mind: null, emotional: null,
  openThreads: [], thingsToCareAbout: [], nextMoves: [{ action: "apologise", why: "", when: "today" }], messageSuggestions: ["sorry"], conversationStarters: [], avoid: [],
  ...over,
});

it("replaces advice, keeps sections the update left null", () => {
  const out = applyPatch(read, patch({}), null);
  expect(out.nextMoves[0].action).toBe("apologise");
  expect(out.whatChanged).toBe("they fought");
  expect(out.status.label).toBe("Warm");
  expect(out.mind).toBe(read.mind);
  expect(out.personality).toBe(read.personality); // never part of a patch
  expect(out.status.score).toBe(computeScore(signals(2), null));
});

it("takes re-written sections and recomputes the score from the new signals", () => {
  const out = applyPatch(read, patch({ signals: signals(0), status: { label: "Tense", trend: "cooling", confidence: "low", explanation: "fight" } }), null);
  expect(out.status.label).toBe("Tense");
  expect(out.status.score).toBe(computeScore(signals(0), null));
  expect(out.status.score!).toBeLessThan(computeScore(signals(2), null));
});

it("finds memories added, edited or removed since the last update", () => {
  const t = (d: number) => new Date(Date.UTC(2026, 10, d));
  const facts = [
    { id: "old", updatedAt: t(1), deletedAt: null },
    { id: "new", updatedAt: t(10), deletedAt: null },
    { id: "gone", updatedAt: t(10), deletedAt: t(10) },
    { id: "gone-before", updatedAt: t(2), deletedAt: t(2) },
  ];
  const d = changedSince(facts, t(5));
  expect(d.added.map((f) => f.id)).toEqual(["new"]);
  expect(d.removed.map((f) => f.id)).toEqual(["gone"]);
  expect(changedSince(facts, null)).toEqual({ added: [], removed: [] });
});

it("needs three things told before building a read without a chat", () => {
  expect(enoughMemory(2, null)).toBe(false);
  expect(enoughMemory(2, "met at college")).toBe(true);
  expect(enoughMemory(3, null)).toBe(true);
});
