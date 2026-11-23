import { expect, it } from "vitest";
import { EPISODE_GAP_MS, EPISODE_MAX_CHARS, EPISODE_MAX_MSGS, fuse, queryTerms, splitEpisodes, termsOf, wordsOf } from "./split";

const T0 = Date.UTC(2025, 0, 1);
const msg = (i: number, gapMin = 1, text = `message ${i}`) => ({ sender: i % 2 ? "Me" : "Anushna", text, ts: T0 + i * gapMin * 60_000 });

it("covers every message once, in order, within the caps", () => {
  const msgs = Array.from({ length: 5_000 }, (_, i) => msg(i, i % 97 === 0 ? 45 : 1));
  const eps = splitEpisodes(msgs);
  let next = 0;
  for (const e of eps) {
    expect(e.start).toBe(next);
    expect(e.msgCount).toBeLessThanOrEqual(EPISODE_MAX_MSGS);
    expect(e.chars).toBeLessThanOrEqual(EPISODE_MAX_CHARS);
    expect(msgs[e.start].ts).toBe(e.fromTs);
    expect(msgs[e.start + e.msgCount - 1].ts).toBe(e.toTs);
    next += e.msgCount;
  }
  expect(next).toBe(msgs.length);
});

it("breaks at a long gap", () => {
  const msgs = [msg(0), msg(1), { ...msg(2), ts: msg(1).ts + EPISODE_GAP_MS + 1 }, { ...msg(3), ts: msg(1).ts + EPISODE_GAP_MS + 60_000 }];
  expect(splitEpisodes(msgs).map((e) => e.msgCount)).toEqual([2, 2]);
});

it("newer messages only change the last sitting", () => {
  const all = Array.from({ length: 3_000 }, (_, i) => msg(i, i % 50 === 0 ? 40 : 2));
  const before = splitEpisodes(all.slice(0, 2_000));
  const after = splitEpisodes(all);
  expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
  // Rebuilding from the last old sitting gives the same as splitting everything.
  const last = before.at(-1)!;
  expect([...before.slice(0, -1), ...splitEpisodes(all, last.start)]).toEqual(after);
});

it("indexes words blind, finds them by word or stem, Hinglish too", () => {
  const secret = "test-secret";
  const terms = new Set(termsOf("Mujhe Japanese WONTON bahut pasand hai! Café?", secret));
  expect(wordsOf("Café, déjà-vu")).toEqual(["cafe", "deja", "vu"]);
  const has = (q: string) => queryTerms(q, secret).every((alts) => alts.some((t) => terms.has(t)));
  expect(has("wonton")).toBe(true);
  expect(has("wontons")).toBe(true);
  expect(has("japanese food")).toBe(false); // "food" was never said
  expect(has("pasand")).toBe(true);
  expect(has("cafe")).toBe(true);
  // Another key, other hashes: the index can't be matched without the app's key.
  expect(termsOf("wonton", "other")).not.toEqual(termsOf("wonton", secret));
});

it("fuses rankings: high in two lists beats first in one", () => {
  const out = fuse([["a", "b", "c"], ["b", "d"], ["e"]]).map((x) => x.id);
  expect(out[0]).toBe("b");
  expect(new Set(out)).toEqual(new Set(["a", "b", "c", "d", "e"]));
});
