import { expect, it } from "vitest";
import { acceptMerges, consolidationPrompt, consolidationSchema, MERGE_OVER, traitsHash, type CTrait } from "./consolidate";

const t = (i: number, text: string, extra: Partial<CTrait> = {}): CTrait => ({ id: `t${i}`, kind: "HOBBY", text, support: 1, people: 1, source: "ANALYSIS", edited: false, pinned: false, ...extra });

// 80 traits: 8 hobbies said 10 ways each.
const hobbies = ["plays football", "plays guitar", "cooks", "runs", "reads", "paints", "games", "hikes"];
const traits = hobbies.flatMap((h, g) => Array.from({ length: 10 }, (_, k) => t(g * 10 + k, k ? `${h} (${k})` : h)));
/** What the (mocked) cheap model answers: each group's first trait keeps the other nine. */
const answer = hobbies.map((_, g) => ({ keep: g * 10 + 1, drop: Array.from({ length: 9 }, (_, k) => g * 10 + k + 2) }));

it("80 near-duplicates merge into 8, and a second run over the result changes nothing", () => {
  expect(traits.length).toBeGreaterThan(MERGE_OVER);
  expect(consolidationPrompt(traits, true)).toContain("1. [hobby] plays football (seen 1x with 1 person)");
  const into = acceptMerges(traits, answer);
  expect(into.size).toBe(72);
  const left = traits.filter((x) => !into.has(x.id));
  expect(left.map((x) => x.text)).toEqual(hobbies);
  // Second run: the model finds nothing to merge, and the fingerprint says nothing changed.
  expect(acceptMerges(left, []).size).toBe(0);
  expect(traitsHash(left)).toBe(traitsHash([...left].reverse()));
  expect(traitsHash(left)).not.toBe(traitsHash(traits));
});

it("what the user wrote, edited or pinned is never merged away; kinds never mix; no chains", () => {
  const list = [t(1, "plays football"), t(2, "football on sundays", { edited: true }), t(3, "football", { pinned: true }), t(4, "football fan", { source: "USER" }), t(5, "likes football", { kind: "INTEREST" }), t(6, "footy")];
  const into = acceptMerges(list, [{ keep: 1, drop: [2, 3, 4, 5, 6] }, { keep: 6, drop: [1] }, { keep: 9, drop: [1] }]);
  expect([...into.entries()]).toEqual([["t6", "t1"]]);
  expect(consolidationPrompt(list, true)).toContain("[hobby, user] football on sundays");
  expect(consolidationPrompt(list.slice(0, 2), false)).toContain("merges: return an empty list");
  expect(consolidationSchema.parse({ merges: "nope", summary: 3 })).toEqual({ merges: [], summary: "" });
});
