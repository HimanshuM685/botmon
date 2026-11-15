import { expect, it } from "vitest";
import { afterHistory, historyForPrompt, historyWork, planChapters, type Unit } from "./history";

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 10, 8);
// ~600 days of chat, 40 messages a day, ~60 chars each.
const chat = (days: number, perDay = 40) =>
  Array.from({ length: days * perDay }, (_, i) => ({ sender: i % 2 ? "Me" : "Anushna", text: `message number ${i} about the day and things`, ts: T0 + Math.floor(i / perDay) * DAY + (i % perDay) * 60_000 }));
const size = (m: { text: string; sender: string }) => m.text.length + m.sender.length + 22;

it("chapters cover every message once, in order, whole days, each under the size", () => {
  const msgs = chat(400);
  const max = 60_000;
  const ch = planChapters(msgs, max);
  expect(ch.length).toBeGreaterThan(10);
  let i = 0;
  for (const c of ch) {
    const part = msgs.slice(i, i + c.msgCount);
    expect(part[0].ts).toBe(c.fromTs);
    expect(part.at(-1)!.ts).toBe(c.toTs);
    expect(part.reduce((n, m) => n + size(m), 0)).toBeLessThanOrEqual(max);
    // never splits a day: the next message is on a later day
    if (msgs[i + c.msgCount]) expect(new Date(msgs[i + c.msgCount].ts).getUTCDate()).not.toBe(new Date(c.toTs).getUTCDate());
    i += c.msgCount;
  }
  // The rest (what the read sends in full) is smaller than one chapter.
  const rest = afterHistory(msgs, ch);
  expect(rest.length).toBe(msgs.length - i);
  expect(rest.reduce((n, m) => n + size(m), 0)).toBeLessThanOrEqual(max);
});

it("newer messages never move earlier chapters", () => {
  const before = planChapters(chat(300), 60_000);
  const after = planChapters(chat(420), 60_000);
  expect(after.slice(0, before.length)).toEqual(before);
});

it("a day bigger than a chapter is cut by messages", () => {
  const msgs = chat(3, 3_000); // ~200k chars a day
  const ch = planChapters(msgs, 60_000);
  expect(ch.length).toBeGreaterThan(3);
  expect(ch.reduce((n, c) => n + c.msgCount, 0)).toBeLessThanOrEqual(msgs.length);
});

const unit = (fromTs: number, toTs: number, msgCount: number, level = 0): Unit => ({
  fromTs, toTs, msgCount, level,
  result: { phase: `phase ${fromTs}`, summary: "s".repeat(800), mood: "ok", moments: [{ when: "2026-01-01 10:00", quote: "q", reading: "r" }], keyFacts: [], importantDates: [], conflicts: [], openAtEnd: [], turningPoints: [] } as unknown as Unit["result"],
});

it("a short chat needs no history; a long one is ready only when every chapter and era is stored", () => {
  expect(historyWork(chat(5), [], 600_000).plan).toEqual([]);
  const msgs = chat(400);
  const empty = historyWork(msgs, [], 100_000);
  expect(empty.ready).toBe(false);
  const stored = empty.plan.map((r) => unit(r.fromTs, r.toTs, r.msgCount));
  const withChapters = historyWork(msgs, stored, 100_000);
  expect(withChapters.todo).toEqual([]);
  // Too many chapters for the history share as summaries: eras are needed, then it is ready.
  expect(withChapters.eraTodo.length).toBeGreaterThan(0);
  const eras = withChapters.eraTodo.map((g) => unit(g[0].fromTs, g.at(-1)!.toTs, g.reduce((n, c) => n + c.msgCount, 0), 1));
  const done = historyWork(msgs, [...stored, ...eras], 100_000);
  expect(done.ready).toBe(true);
  // Shown units cover the planned range once each, in order.
  expect(done.units[0].fromTs).toBe(done.plan[0].fromTs);
  expect(done.units.at(-1)!.toTs).toBe(done.plan.at(-1)!.toTs);
  expect(done.units.reduce((n, u) => n + u.msgCount, 0)).toBe(done.plan.reduce((n, r) => n + r.msgCount, 0));
  expect(historyForPrompt(done.units, 20_000).length).toBeLessThanOrEqual(20_000 + 100);
});

it("history shows the newest periods in full and older ones as summaries when space is short", () => {
  const units = [unit(1, 2, 10), unit(3, 4, 10), unit(5, 6, 10)];
  const roomy = historyForPrompt(units, 100_000);
  expect(roomy.match(/Moments:/g)).toHaveLength(3);
  // Room for all three summaries plus one full period's extras: only the newest is shown in full.
  const tight = historyForPrompt(units, roomy.length - 60);
  expect(tight.match(/Moments:/g)?.length ?? 0).toBe(2);
  expect(tight.indexOf("Moments:")).toBeGreaterThan(tight.indexOf("phase 3"));
  expect(tight).toContain("phase 1");
});
