import type { Msg } from "./parsers/types";

const DAY = 86_400_000;
/** Overlap kept when trimming a re-export client-side, so boundary messages can be de-duplicated exactly. */
export const OVERLAP_MS = DAY;

const key = (m: Msg) => `${m.ts}\u0000${m.sender}\u0000${m.text}`;

/**
 * Union of a stored chat and a new export of the same chat.
 * Multiset de-dupe: identical messages (same minute, sender, text: "ok", "ok") are only
 * dropped as many times as they already exist, so genuine repeats survive.
 */
export function mergeChats(existing: Msg[], incoming: Msg[]): { messages: Msg[]; added: Msg[] } {
  const have = new Map<string, number>();
  for (const m of existing) have.set(key(m), (have.get(key(m)) ?? 0) + 1);
  const added: Msg[] = [];
  for (const m of incoming) {
    const n = have.get(key(m)) ?? 0;
    if (n > 0) have.set(key(m), n - 1);
    else added.push(m);
  }
  if (!added.length) return { messages: existing, added };
  return { messages: [...existing, ...added].sort((a, b) => a.ts - b.ts), added };
}

/** Client-side: only send what can be new. Already have Nov 1–10 and drop Nov 1–13? Send Nov 9–13. */
export function trimToNew(incoming: Msg[], storedLastAt: number): Msg[] {
  return incoming.filter((m) => m.ts >= storedLastAt - OVERLAP_MS);
}
