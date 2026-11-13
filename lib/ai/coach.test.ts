import { expect, it } from "vitest";
import { buildCoachContext, coachTools, searchMessages } from "./coach";
import { computeStats } from "../stats";
import { daysLeft, purgeCutoff, purgeDate } from "../trash";

const H = 3600_000;
const msgs = Array.from({ length: 3000 }, (_, i) => ({ sender: i % 2 ? "Me" : "Riya", text: i === 10 ? "my brother Kabir is visiting" : `msg ${i} hello`, ts: Date.UTC(2026, 0, 1) + i * H }));

it("coach context fits the budget and includes read + memory", () => {
  const ctx = buildCoachContext({
    personName: "Riya", relation: "GIRLFRIEND", gender: "FEMALE", notes: "met at college",
    chat: { myName: "Me", theirName: "Riya", tzOffset: -330, stats: computeStats(msgs, "Me", -330), msgs },
    read: { status: { label: "Warm" } },
    facts: [{ kind: "EVENT", text: "Got the internship", happenedAt: new Date("2026-03-01") }],
    budget: 5_000,
    now: msgs.at(-1)!.ts,
  });
  expect(ctx).toContain('"label":"Warm"');
  expect(ctx).toContain("[event 2026-03-01] Got the internship");
  expect(ctx).toContain("use searchChat for older ones");
  expect(ctx.length).toBeLessThan(8_000);
});

it("searchChat finds old details newest-first; remember de-dupes", async () => {
  expect(searchMessages(msgs, "Brother kabir", 5, 0)[0]).toContain("my brother Kabir");
  const saved: string[] = [];
  const tools = coachTools({ msgs, tz: 0, knownFacts: ["Loves coffee"], saveFact: async (f) => void saved.push(f.text) });
  const run = (input: object) => (tools.remember.execute as unknown as (i: object, o: object) => Promise<{ saved: boolean }>)(input, {});
  expect((await run({ kind: "PREFERENCE", text: "loves coffee!", happenedAt: "" })).saved).toBe(false);
  expect((await run({ kind: "EVENT", text: "Had a fight about plans", happenedAt: "2026-11-10" })).saved).toBe(true);
  expect((await run({ kind: "EVENT", text: "had a fight about plans", happenedAt: "" })).saved).toBe(false);
  expect(saved).toEqual(["Had a fight about plans"]);
});

it("trash keeps items 30 days", () => {
  const now = Date.UTC(2026, 10, 30);
  const deleted = new Date(Date.UTC(2026, 10, 1));
  expect(purgeDate(deleted).toISOString().slice(0, 10)).toBe("2026-12-01");
  expect(daysLeft(deleted, now)).toBe(1);
  expect(purgeCutoff(now).toISOString().slice(0, 10)).toBe("2026-10-31");
});
