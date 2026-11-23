import { createHmac } from "node:crypto";
import type { Msg } from "../parsers/types";

/**
 * Total recall, the pure part. A chat is cut into sittings ("episodes"): messages with no gap over EPISODE_GAP_MS,
 * capped in size so one fits a detail call with room to spare. Every message lands in exactly one sitting, so a
 * detail said once in five lakh messages is always somewhere a search can reach.
 */

export const EPISODE_GAP_MS = 30 * 60_000;
export const EPISODE_MAX_MSGS = 40;
export const EPISODE_MAX_CHARS = 4_000;

export type EpisodeRange = { fromTs: number; toTs: number; msgCount: number; chars: number; start: number };

const size = (m: Msg) => m.text.length + m.sender.length + 22;

/**
 * Sittings, oldest first, greedy from `from` (an index into msgs). Greedy and stateless, so adding newer messages
 * only ever changes the last sitting: everything before it keeps its shape (saveEpisodes rebuilds from there).
 */
export function splitEpisodes(msgs: Msg[], from = 0): EpisodeRange[] {
  const out: EpisodeRange[] = [];
  let cur: EpisodeRange | null = null;
  for (let i = from; i < msgs.length; i++) {
    const m = msgs[i], s = size(m);
    if (cur && (m.ts - cur.toTs > EPISODE_GAP_MS || cur.msgCount >= EPISODE_MAX_MSGS || cur.chars + s > EPISODE_MAX_CHARS)) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { fromTs: m.ts, toTs: m.ts, msgCount: 0, chars: 0, start: i };
    cur.toTs = m.ts;
    cur.msgCount++;
    cur.chars += s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Words of a text as they are indexed: lowercase letters and digits, accents dropped, 2+ characters. */
export function wordsOf(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
}

/** A word and, for longer ones, its 5-letter stem: "wontons" and "wonton" both hold "wonto", so either finds the other. */
const forms = (w: string) => (w.length >= 6 ? [w, `${w.slice(0, 5)}*`] : [w]);

/**
 * A blind keyword index: each word form as a 31-bit keyed hash. The database can say which sittings hold a word
 * someone asks for, but can't read what was said. Keyed with the app's encryption key, so a stolen table alone
 * can't be matched against a dictionary.
 */
export function termHash(form: string, secret = process.env.ENCRYPTION_KEY ?? "") {
  return createHmac("sha256", secret).update(`term:${form}`).digest().readUInt32BE(0) & 0x7fffffff;
}

export const termsOf = (text: string, secret?: string) => [...new Set([...new Set(wordsOf(text))].flatMap(forms).map((f) => termHash(f, secret)))];

/** Too common to narrow a search down: dropped from questions (they are still indexed). */
const COMMON = new Set(
  "the and for you are was but not all can had her him his how its our out she who why yes yeah haan nahi hai hain kya toh bhi aur mein main tum tu ho tha thi kar karo the that this with have from what when where should would could about there their them they then than your will just like want been into some more also very really maybe think know going tell does did were here which because while after before again still even much many okay ok".split(" "),
);

/** The words a question searches for: common words dropped unless nothing else is left. */
export function askedWords(query: string): string[] {
  const words = [...new Set(wordsOf(query))];
  const meaningful = words.filter((w) => !COMMON.has(w));
  return meaningful.length ? meaningful : words;
}

/** Each asked word as alternatives (the word itself, or its stem), so "wontons" finds "wonton". */
export function queryTerms(query: string, secret?: string): number[][] {
  return askedWords(query).map((w) => [...new Set([w, ...(w.length >= 6 ? [`${w.slice(0, 5)}*`] : w.length === 5 ? [`${w}*`] : [])])].map((f) => termHash(f, secret)));
}

/**
 * Reciprocal rank fusion: several ranked lists (by meaning, by words, from memory) into one, without comparing
 * their scores. An item ranked high in two lists beats one ranked first in only one. k = 60 is the usual constant.
 */
export function fuse<T extends string>(lists: T[][], k = 60): { id: T; score: number }[] {
  const score = new Map<T, number>();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
}
