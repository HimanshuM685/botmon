import { expect, it } from "vitest";
import { capText, CUT_MARK, MAX_TEXT, uploadParts } from "./upload";

it("a long chat with one huge message splits into parts under the limits, and nothing is lost", () => {
  const msgs = Array.from({ length: 177_234 }, (_, i) => ({ sender: i % 2 ? "Me" : "Anushna", text: `message ${i} with some words in it`, ts: 1_700_000_000_000 + i * 60_000 }));
  msgs[500].text = "x".repeat(50_000);
  const capped = msgs.map((m) => ({ ...m, text: capText(m.text) }));
  expect(capped[500].text.length).toBe(MAX_TEXT);
  expect(capped[500].text.endsWith(CUT_MARK)).toBe(true);
  const parts = uploadParts(capped);
  expect(parts.length).toBe(5);
  for (const p of parts) {
    expect(p.length).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify(p).length).toBeLessThan(10_000_000);
  }
  expect(parts.flat()).toEqual(capped);
});

it("splits by size too, and a short chat stays one part", () => {
  const big = Array.from({ length: 30 }, (_, i) => ({ sender: "A", text: "y".repeat(1_000), ts: i }));
  expect(uploadParts(big, 40_000, 5_000).every((p) => p.length <= 5)).toBe(true);
  expect(uploadParts(big.slice(0, 3))).toHaveLength(1);
  expect(capText("short")).toBe("short");
});
