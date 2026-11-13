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
  expect((await run({ kind: "PREFERENCE", text: "loves coffee!", happenedAt: "", about: [] })).saved).toBe(false);
  expect((await run({ kind: "EVENT", text: "Had a fight about plans", happenedAt: "2026-11-10", about: ["Our Fight"] })).saved).toBe(true);
  expect((await run({ kind: "EVENT", text: "had a fight about plans", happenedAt: "", about: [] })).saved).toBe(false);
  expect(saved).toEqual(["Had a fight about plans"]);
});

it("trash keeps items 30 days", () => {
  const now = Date.UTC(2026, 10, 30);
  const deleted = new Date(Date.UTC(2026, 10, 1));
  expect(purgeDate(deleted).toISOString().slice(0, 10)).toBe("2026-12-01");
  expect(daysLeft(deleted, now)).toBe(1);
  expect(purgeCutoff(now).toISOString().slice(0, 10)).toBe("2026-10-31");
});

it("correct retires the matching memory and saves the new truth", async () => {
  const saved: string[] = [], retired: string[] = [], links: string[] = [];
  const fact = (id: string, text: string, entities: string[]) => ({ id, text, entities, kind: "FACT", happenedAt: null });
  const tools = coachTools({
    msgs: [], tz: 0, knownFacts: ["Has a boyfriend", "Loves sushi"],
    facts: [fact("f1", "Has a boyfriend", ["boyfriend"]), fact("f2", "Loves sushi", ["food"]), fact("f3", "Her boyfriend lives in Pune", ["boyfriend", "pune"])],
    saveFact: async (f) => {
      saved.push(`${f.text} {${f.entities.join(",")}}`);
      return "new1";
    },
    retireFact: async (id) => void retired.push(id),
    linkFacts: async (from, to, kind) => void links.push(`${from} ${kind} ${to}`),
  });
  const recall = (about: string) => (tools.recall.execute as unknown as (i: object, o: object) => Promise<string>)({ about }, {});
  expect(await recall("Boyfriend")).toContain("lives in Pune");
  expect(await recall("cricket")).toBe("Nothing in memory about that.");
  const run = (input: object) => (tools.correct.execute as unknown as (i: object, o: object) => Promise<{ updated: boolean; saved?: string }>)(input, {});
  expect(await run({ old: "has a boyfriend.", replacement: "Broke up with her boyfriend in November", kind: "EVENT", happenedAt: "" })).toMatchObject({ updated: true, saved: "Broke up with her boyfriend in November" });
  expect(await run({ old: "Has a boyfriend", replacement: "", kind: "FACT", happenedAt: "" })).toMatchObject({ updated: false }); // already retired
  expect(await run({ old: "loves sushi", replacement: "", kind: "PREFERENCE", happenedAt: "" })).toMatchObject({ updated: true });
  expect(retired).toEqual(["f1", "f2"]);
  expect(saved).toEqual(["Broke up with her boyfriend in November {boyfriend}"]); // inherits the old memory's connections
  expect(links).toEqual(["new1 updates f1"]);
});

it("matchMemory: exact first, single close match, never guesses or matches empty", async () => {
  const { matchMemory } = await import("./coach");
  const mem = ["Loves sushi", "Loves sushi with her dad", "😊", "Has a boyfriend named Arjun"];
  expect(matchMemory(mem, "loves sushi!")).toBe(0);
  expect(matchMemory(mem, "Has a boyfriend named Arjun.")).toBe(3);
  expect(matchMemory(mem, "has a boyfriend named arjun now")).toBe(3); // close length, single match
  expect(matchMemory(mem, "loves sushi rolls")).toBe("none"); // overlaps "Loves sushi" but differs too much to be sure
  expect(matchMemory(mem, "sushi")).toBe("none"); // too short relative to every candidate
  expect(matchMemory(["Trip to Goa in May", "Trip to Goa in Mar"], "trip to goa in m")).toBe("ambiguous");
  expect(matchMemory(mem, "🙂")).toBe("none"); // empty after normalizing
});

it("recall and correct see memories saved earlier in the same turn", async () => {
  const { coachTools } = await import("./coach");
  let n = 0;
  const retired: string[] = [];
  const tools = coachTools({
    msgs: [], tz: 0, knownFacts: [], facts: [],
    saveFact: async () => `f${++n}`,
    retireFact: async (id) => void retired.push(id),
    linkFacts: async () => undefined,
  });
  const run = (t: unknown, i: object) => (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(i, {});
  await run(tools.remember, { kind: "EVENT", text: "Trip to Goa on the 14th", happenedAt: "2026-12-14", about: ["goa trip"] });
  expect(String(await run(tools.recall, { about: "goa trip" }))).toContain("Trip to Goa on the 14th");
  expect(await run(tools.correct, { old: "Trip to Goa on the 14th", replacement: "Trip to Goa moved to the 21st", kind: "EVENT", happenedAt: "2026-12-21" })).toMatchObject({ updated: true });
  expect(retired).toEqual(["f1"]);
});
