import { expect, it } from "vitest";
import { computeScore, computeStats, type Signals } from "./stats";

const H = 3600_000;
const now = Date.UTC(2026, 10, 14);
const long = Array.from({ length: 1000 }, (_, i) => ({ sender: i % 2 ? "Me" : "Riya", text: "hello there", ts: now - 40 * 24 * H + i * H }));
const short = long.slice(-40);
const all = (level: number): Signals =>
  Object.fromEntries(["reciprocity", "warmth", "curiosityAboutUser", "effort", "consistency", "selfDisclosure", "futureTalk"].map((k) => [k, { level }]));

it("is deterministic and rises with every signal", () => {
  const s = computeStats(long, "Me");
  expect(computeScore(all(2), s, now)).toBe(computeScore(all(2), s, now));
  for (const k of Object.keys(all(2))) expect(computeScore({ ...all(2), [k]: { level: 4 } }, s, now)).toBeGreaterThan(computeScore(all(2), s, now));
  expect(computeScore(all(4), s, now)).toBeGreaterThan(80);
  expect(computeScore(all(0), s, now)).toBeLessThan(30);
});

it("pulls thin chats toward 50", () => {
  const thick = computeScore(all(4), computeStats(long, "Me"), now);
  const thin = computeScore(all(4), computeStats(short, "Me"), now);
  expect(thin).toBeLessThan(thick);
  expect(thin).toBeGreaterThan(50);
});
