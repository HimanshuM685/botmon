import { signalsSchema } from "./ai/schema";

/**
 * Score goals and growth: the user picks a read score to work on ("Improve this"), and later reads show how it
 * moved. Pure: keys, labels, which goals a new read reached, growth against a baseline, the prompt lines.
 */

export const SIGNAL_KEYS = Object.keys(signalsSchema.shape) as (keyof typeof signalsSchema.shape)[];
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export const isSignal = (k: unknown): k is SignalKey => typeof k === "string" && (SIGNAL_KEYS as string[]).includes(k);

/** How each score reads on the page (components/analysis-view.tsx shows them in this order). */
export const SIGNAL_LABEL: Record<SignalKey, string> = {
  reciprocity: "Matches your effort", warmth: "Warmth", curiosityAboutUser: "Curious about you", effort: "Effort in replies",
  consistency: "Consistency", selfDisclosure: "Opens up", futureTalk: "Talks about plans",
};

/** The anchors a score is rated by (0..4), as the read's model sees them. */
export const signalAnchors = (k: SignalKey) => signalsSchema.shape[k].shape.level.description ?? "";

type Signals = Partial<Record<string, { level?: number } | undefined>> | undefined | null;
const levelOf = (s: Signals, k: string) => (typeof s?.[k]?.level === "number" ? s[k]!.level! : undefined);

export type Goal = { id: string; signal: string; fromLevel: number; fromAt: Date; toLevel: number | null; achievedAt: Date | null };

/** A goal is reached once a read rates its score at least one level above where it started. */
export const GOAL_STEP = 1;

/** Goals still open that this read's scores reach: they become achieved, at the level reached. */
export function checkGoals(goals: Goal[], signals: Signals) {
  return goals.flatMap((g) => {
    const now = levelOf(signals, g.signal);
    return !g.achievedAt && now !== undefined && now >= g.fromLevel + GOAL_STEP ? [{ id: g.id, toLevel: now }] : [];
  });
}

/** A read worth comparing against: when it was made and its scores. */
export type Baseline = { at: Date; signals: Signals };
/** Growth is measured against a read at least this old, so "since" means about a month. */
export const GROWTH_DAYS = 28;

/**
 * The read to compare with: the latest one at least GROWTH_DAYS old, else the oldest one there is.
 * `reads`: earlier reads, any order. Undefined when there is nothing older than the current read.
 */
export function pickBaseline<T extends Baseline>(reads: T[], current: Date): T | undefined {
  const older = reads.filter((r) => r.at < current).sort((a, b) => a.at.getTime() - b.at.getTime());
  const month = older.filter((r) => current.getTime() - r.at.getTime() >= GROWTH_DAYS * 86_400_000);
  return month.at(-1) ?? older[0];
}

export type Growth = { from: number; to: number; since: string; goal: boolean };

/**
 * How each score moved: against the score's goal when there is one (its level and date when set), else against
 * the baseline read. Unchanged scores are left out. `since` is a YYYY-MM-DD.
 */
export function signalGrowth(current: Signals, baseline: Baseline | undefined, goals: Goal[] = []) {
  const out: Partial<Record<SignalKey, Growth>> = {};
  for (const k of SIGNAL_KEYS) {
    const to = levelOf(current, k);
    if (to === undefined) continue;
    const goal = goals.filter((g) => g.signal === k).sort((a, b) => b.fromAt.getTime() - a.fromAt.getTime())[0];
    const from = goal ? goal.fromLevel : levelOf(baseline?.signals, k);
    const since = goal ? goal.fromAt : baseline?.at;
    if (from === undefined || !since || from === to) continue;
    out[k] = { from, to, since: since.toISOString().slice(0, 10), goal: !!goal };
  }
  return out;
}

/** For read prompts: the scores the user is working on, so tips and next moves aim at them. "" when none. */
export function goalsForPrompt(goals: Goal[]) {
  const open = goals.filter((g) => !g.achievedAt && isSignal(g.signal));
  if (!open.length) return "";
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `Scores the user is working on (help them raise these; aim each one's tip and at least one next move at it):\n${open
    .map((g) => `- ${g.signal} (${SIGNAL_LABEL[g.signal as SignalKey]}): ${g.fromLevel}/4 when they started on ${day(g.fromAt)}`)
    .join("\n")}`;
}

/**
 * Added to the coach's instructions in a thread opened from "Improve this". The score describes the other person,
 * so the coach helps the user invite more of it, and never treats the goal as a memory about them.
 */
export function improveSystem(name: string, k: SignalKey, now: { level?: number; evidence?: string; tip?: string } | undefined, goal: { fromLevel: number; fromAt: Date; achievedAt: Date | null }) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `This conversation is about one score on the read: "${SIGNAL_LABEL[k]}" (${k}). It rates ${name}, on this scale: ${signalAnchors(k)}
Now: ${typeof now?.level === "number" ? `${now.level}/4` : "not rated yet"}${now?.evidence ? `, because: ${now.evidence}` : ""}.${now?.tip ? ` The read's tip: ${now.tip}.` : ""}
The user started working on it on ${day(goal.fromAt)} at ${goal.fromLevel}/4${goal.achievedAt ? ` and a later read already showed it improved on ${day(goal.achievedAt)}` : ""}.
How to help:
- First look: what in the chat, the memory and the graph made this score what it is, and what moments were the exceptions. Use the tools.
- Then give 2-3 concrete moves the user can make in the next week, each tied to a real topic, plan or moment with ${name} (name it), and say why it would invite more of this from them. Nothing generic ("talk more", "be open"): if it could be said about anyone, replace it.
- Draft the messages to send for those moves, in the user's typing, and run each through check_draft.
- Be honest: you can't make ${name} do anything. If the evidence says ${name} doesn't want more of this right now, say so kindly instead of pushing.
- The score goes up when a later read sees the change: tell the user to upload a newer export in a week or two so their progress shows on the read.
- The goal is the user's, not a fact about ${name}: never save it with remember.`;
}
