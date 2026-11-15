import type { Tension } from "../graph";

/**
 * Stored findings: what the graph showed, kept so the coach can refer back to "the thing we noticed last week"
 * and the read can tell a new finding from an old one. Pure: what to write, given what is stored and what the
 * graph shows now. Only findings that don't depend on a conversation's focus are stored (so not `risk`).
 */

export type StoredFinding = { key: string; kind: string; text: string; edgeIds: string[]; confidence: number; firstSeenAt: Date; lastSeenAt: Date; retiredAt: Date | null };

export function diffFindings(stored: StoredFinding[], current: Tension[], now: Date) {
  const have = new Map(stored.map((f) => [f.key, f]));
  const shown = new Map(current.filter((t) => t.kind !== "risk").map((t) => [t.key, t]));
  const row = (t: Tension) => ({ key: t.key, kind: t.kind, text: t.text, edgeIds: t.edgeIds, confidence: t.confidence });
  return {
    create: [...shown.values()].filter((t) => !have.has(t.key)).map((t) => ({ ...row(t), firstSeenAt: now, lastSeenAt: now })),
    // Back after its evidence had gone: it counts as new again. Otherwise only real changes are written.
    update: [...shown.values()].flatMap((t) => {
      const old = have.get(t.key);
      if (!old) return [];
      if (old.retiredAt) return [{ ...row(t), firstSeenAt: now, lastSeenAt: now, retiredAt: null }];
      const same = old.text === t.text && old.confidence === t.confidence && old.edgeIds.join() === t.edgeIds.join();
      return same ? [] : [{ ...row(t), firstSeenAt: old.firstSeenAt, lastSeenAt: now, retiredAt: null }];
    }),
    /** Evidence gone (a memory trashed, a chat removed): kept as a row, no longer shown. */
    retire: stored.filter((f) => !f.retiredAt && !shown.has(f.key)).map((f) => f.key),
  };
}

/** Keys of the findings first seen after `since` (a conversation's last turn, a read's last update). */
export const newSince = (stored: { key: string; firstSeenAt: Date; retiredAt: Date | null }[], since: Date | null | undefined) =>
  new Set(since ? stored.filter((f) => !f.retiredAt && f.firstSeenAt > since).map((f) => f.key) : []);
