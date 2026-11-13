import { createHash } from "node:crypto";

/** Advice older than this is refreshed even if nothing else changed ("this weekend" goes stale). */
export const ADVICE_MAX_AGE_DAYS = 3;

/**
 * Fingerprint of everything outside the chat that advice depends on: the person's details and the alive timeline.
 * A hash, not timestamps: a read saves its own facts right after finishing, which would look like a change.
 */
export function contextHash(
  person: { notes: string | null; relation: string; gender: string },
  facts: { id: string; updatedAt: Date }[],
) {
  const h = createHash("sha256").update(JSON.stringify([person.notes ?? "", person.relation, person.gender]));
  for (const f of [...facts].sort((a, b) => (a.id < b.id ? -1 : 1))) h.update(`|${f.id}:${f.updatedAt.getTime()}`);
  return h.digest("hex").slice(0, 32);
}

export function adviceStale(read: { contextHash: string | null; adviceAt: Date | null }, hash: string, now = Date.now()) {
  return read.contextHash !== hash || !read.adviceAt || now - read.adviceAt.getTime() > ADVICE_MAX_AGE_DAYS * 86_400_000;
}
