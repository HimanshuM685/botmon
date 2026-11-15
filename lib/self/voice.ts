import type { Voice } from "../voice";

/**
 * The user's voice across every chat: one profile from the per-chat ones (lib/voice.ts voiceProfile), weighted
 * by how many messages each was measured from. Pure; no model call. Used for drafts where a person has no chat.
 * ponytail: medianWords is a weighted mean of medians, not a true median of all messages; close enough for a style hint.
 */
const SHARES = ["shortShare", "lowerStart", "allLower", "endPeriod", "endBang", "questionMark", "ellipsis", "emojiShare", "greetShare"] as const;

/** Items ranked across lists: each list's rank is weighted by its voice's count, best first. */
function rankMerge(lists: { items: string[]; weight: number }[], n: number) {
  const score = new Map<string, number>();
  for (const { items, weight } of lists) items.forEach((x, i) => score.set(x, (score.get(x) ?? 0) + weight * (items.length - i)));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

/** `voices` newest chat first. Null when there is nothing to merge. */
export function mergeVoices(voices: (Voice | null | undefined)[]): Voice | null {
  const vs = voices.filter((v): v is Voice => !!v && v.count > 0);
  if (!vs.length) return null;
  if (vs.length === 1) return vs[0];
  const total = vs.reduce((n, v) => n + v.count, 0);
  const avg = (f: (v: Voice) => number) => vs.reduce((n, v) => n + f(v) * v.count, 0) / total;
  const shares = Object.fromEntries(SHARES.map((k) => [k, avg((v) => v[k])])) as Pick<Voice, (typeof SHARES)[number]>;
  // Samples: taken in turn from each chat, newest chat first, so every chat's way of typing is represented.
  const samples: string[] = [];
  for (let i = 0; samples.length < 40 && vs.some((v) => i < v.samples.length); i++)
    for (const v of vs) {
      const s = v.samples[v.samples.length - 1 - i]; // a chat's samples run oldest first
      if (s !== undefined && samples.length < 40 && !samples.includes(s)) samples.push(s);
    }
  return {
    count: total,
    medianWords: Math.round(avg((v) => v.medianWords)),
    ...shares,
    topEmoji: rankMerge(vs.map((v) => ({ items: v.topEmoji, weight: v.count })), 6),
    words: rankMerge(vs.map((v) => ({ items: v.words, weight: v.count })), 30),
    stretches: avg((v) => Number(v.stretches)) >= 0.5,
    burst: avg((v) => v.burst),
    openers: rankMerge(vs.map((v) => ({ items: v.openers, weight: v.count })), 5),
    samples: samples.reverse(),
  };
}
