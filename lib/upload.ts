import type { Msg } from "./parsers/types";

/** Longest message text stored. Longer ones (a pasted essay, a forwarded document) are cut, never rejected. */
export const MAX_TEXT = 20_000;
export const CUT_MARK = " … [cut: message too long]";
/** Messages per upload request. The server accepts this many per request (lib/data.ts). */
export const PART_MESSAGES = 40_000;
/** Raw JSON characters per part before compression: about 2–3 MB once gzipped, under the request body cap. */
export const PART_CHARS = 10_000_000;

export const capText = (text: string) => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - CUT_MARK.length) + CUT_MARK : text);

/**
 * Split a chat into upload parts, oldest first, each under both limits. The first part creates (or replaces) the
 * chat; the rest merge into it, so a long export goes up in several ordinary requests.
 */
export function uploadParts(msgs: Msg[], maxMessages = PART_MESSAGES, maxChars = PART_CHARS): Msg[][] {
  const parts: Msg[][] = [];
  let part: Msg[] = [], chars = 0;
  for (const m of msgs) {
    const size = m.text.length + m.sender.length + 40; // JSON keys, quotes and the timestamp
    if (part.length && (part.length >= maxMessages || chars + size > maxChars)) {
      parts.push(part);
      part = [];
      chars = 0;
    }
    part.push(m);
    chars += size;
  }
  if (part.length) parts.push(part);
  return parts;
}
