import { expect, it } from "vitest";
import { analysisSchema, modelPatchSchema, signalsSchema } from "./ai/schema";
import { checkGoals, goalsForPrompt, isSignal, pickBaseline, signalAnchors, signalGrowth, SIGNAL_KEYS, SIGNAL_LABEL, type Goal } from "./goals";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const lv = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, level]) => [k, { level, evidence: "" }]));
const goal = (signal: string, fromLevel: number, fromAt: string, achieved?: string): Goal => ({ id: `g-${signal}`, signal, fromLevel, fromAt: d(fromAt), toLevel: null, achievedAt: achieved ? d(achieved) : null });

it("the seven score keys, labels and anchors come from the read's schema", () => {
  expect(SIGNAL_KEYS).toHaveLength(7);
  expect(Object.keys(SIGNAL_LABEL).sort()).toEqual([...SIGNAL_KEYS].sort());
  expect(signalAnchors("warmth")).toContain("4 openly affectionate");
  expect(isSignal("warmth")).toBe(true);
  for (const bad of ["Warmth", "score", "__proto__", "", undefined, 3]) expect(isSignal(bad)).toBe(false);
});

it("a read saved before tips existed still parses; a model that skips a tip does not fail the read", () => {
  const old = { level: 2, evidence: "shares her schedule" };
  expect(signalsSchema.shape.warmth.parse(old)).toEqual({ ...old, tip: "" });
  expect(signalsSchema.shape.warmth.parse({ ...old, tip: "ask how the braces came off" }).tip).toBe("ask how the braces came off");
  expect(modelPatchSchema.shape.signals.parse(null)).toBeNull();
  expect(analysisSchema.shape.signals.description).toContain("Rate each strictly");
});

it("growth: against a read about a month old, else the oldest; unchanged scores left out", () => {
  const now = d("2026-11-15");
  const reads = [{ at: d("2026-09-01"), signals: lv({ warmth: 1 }) }, { at: d("2026-10-10"), signals: lv({ warmth: 2, effort: 3 }) }, { at: d("2026-11-01"), signals: lv({ warmth: 4 }) }];
  const base = pickBaseline(reads, now)!;
  expect(base.at).toEqual(d("2026-10-10")); // latest one at least 28 days old
  expect(signalGrowth(lv({ warmth: 3, effort: 3, consistency: 2 }), base)).toEqual({ warmth: { from: 2, to: 3, since: "2026-10-10", goal: false } });
  expect(pickBaseline(reads.slice(2), now)!.at).toEqual(d("2026-11-01")); // nothing that old: the oldest there is
  expect(pickBaseline([], now)).toBeUndefined();
  expect(pickBaseline([{ at: now, signals: {} }], now)).toBeUndefined(); // the current read itself is not a baseline
  expect(signalGrowth(lv({ warmth: 1 }), base).warmth).toMatchObject({ from: 2, to: 1 }); // down shows too
  expect(signalGrowth(lv({ warmth: 3 }), undefined)).toEqual({});
});

it("a goal is measured from where it started, and is reached one level up", () => {
  const goals = [goal("warmth", 2, "2026-11-03"), goal("effort", 1, "2026-11-03", "2026-11-10"), goal("futureTalk", 3, "2026-11-01")];
  const base = { at: d("2026-10-01"), signals: lv({ warmth: 1, futureTalk: 3 }) };
  expect(signalGrowth(lv({ warmth: 3, futureTalk: 3 }), base, goals)).toEqual({ warmth: { from: 2, to: 3, since: "2026-11-03", goal: true } });
  expect(checkGoals(goals, lv({ warmth: 3, effort: 4, futureTalk: 3 }))).toEqual([{ id: "g-warmth", toLevel: 3 }]); // effort already reached, futureTalk not yet
  expect(checkGoals(goals, lv({ warmth: 2 }))).toEqual([]);
  expect(checkGoals(goals, {})).toEqual([]);
});

it("open goals go into the read prompt; reached ones and unknown keys don't", () => {
  const text = goalsForPrompt([goal("warmth", 2, "2026-11-03"), goal("effort", 1, "2026-11-03", "2026-11-10"), goal("bogus", 1, "2026-11-03")]);
  expect(text).toContain("- warmth (Warmth): 2/4 when they started on 2026-11-03");
  expect(text).not.toContain("effort");
  expect(text).not.toContain("bogus");
  expect(goalsForPrompt([])).toBe("");
});

it("an improve thread tells the coach the score, its scale, where it stands and how to help; reads get the open goals", async () => {
  const { improveSystem } = await import("./goals");
  const { buildMemoryReadPrompt, SYSTEM } = await import("./ai/prompt");
  const sys = improveSystem("Riya", "curiosityAboutUser", { level: 1, evidence: "asks only about the pickup", tip: "tell her about your new job and leave room for questions" }, { fromLevel: 1, fromAt: d("2026-11-03"), achievedAt: null });
  expect(sys).toContain('"Curious about you" (curiosityAboutUser)');
  expect(sys).toContain("4 actively asks follow-ups");
  expect(sys).toContain("Now: 1/4, because: asks only about the pickup.");
  expect(sys).toContain("The read's tip: tell her about your new job");
  expect(sys).toContain("started working on it on 2026-11-03 at 1/4");
  expect(sys).toMatch(/Nothing generic/);
  expect(sys).toMatch(/check_draft/);
  expect(sys).toMatch(/never save it with remember/);
  expect(improveSystem("Riya", "warmth", undefined, { fromLevel: 0, fromAt: d("2026-11-03"), achievedAt: d("2026-11-10") })).toContain("Now: not rated yet.");
  // Read prompts carry the goals (and only when there are some); the read's rules say tips aim at them.
  const base = { personName: "Riya", relation: "FRIEND" as const, gender: "FEMALE", notes: "met at work", tzOffsetMin: 0 };
  expect(buildMemoryReadPrompt({ ...base, goals: goalsForPrompt([goal("warmth", 2, "2026-11-03")]) })).toContain("Scores the user is working on");
  expect(buildMemoryReadPrompt(base)).not.toContain("Scores the user is working on");
  expect(SYSTEM).toMatch(/signal's tip[\s\S]*real topic, plan or moment/);
});
