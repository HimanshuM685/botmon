import { expect, it } from "vitest";
import { mergeChats, trimToNew } from "./merge";

const day = (d: number, text: string, sender = "Riya") => ({ sender, text, ts: Date.UTC(2026, 10, d, 12) });

it("re-export of Nov 1–13 on top of Nov 1–10 adds only Nov 11–13", () => {
  const first = Array.from({ length: 10 }, (_, i) => day(i + 1, `m${i + 1}`));
  const second = Array.from({ length: 13 }, (_, i) => day(i + 1, `m${i + 1}`));
  const { messages, added } = mergeChats(first, trimToNew(second, first.at(-1)!.ts));
  expect(added.map((m) => m.text)).toEqual(["m11", "m12", "m13"]);
  expect(messages).toHaveLength(13);
  expect(trimToNew(second, first.at(-1)!.ts).length).toBeLessThan(second.length);
});

it("keeps genuine repeats but drops already-stored copies", () => {
  const ok = { sender: "Me", text: "ok", ts: 1000 };
  const { added } = mergeChats([ok, ok], [ok, ok, ok]);
  expect(added).toHaveLength(1);
});

it("same export again adds nothing", () => {
  const a = [day(1, "a"), day(2, "b")];
  expect(mergeChats(a, [...a]).added).toHaveLength(0);
});

it("trim keeps one day of overlap before the stored end", () => {
  const last = day(10, "x").ts;
  expect(trimToNew([day(8, "w"), day(9, "y"), day(10, "x"), day(11, "z")], last).map((m) => m.text)).toEqual(["y", "x", "z"]);
});

it("namesMatch: shared word matches, different person doesn't, phone numbers pass", async () => {
  const { namesMatch } = await import("./merge");
  expect(namesMatch("Mansi", "mansi office 🌸")).toBe(true);
  expect(namesMatch("Mansi Sharma", "Sharma ji")).toBe(true);
  expect(namesMatch("Mansi", "Riya")).toBe(false);
  expect(namesMatch("Mansi", "Man")).toBe(false);
  expect(namesMatch("Mansi", "+91 98765 43210")).toBe(true);
});
