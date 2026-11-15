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

it("recall walks the graph: by feeling, then one tag away; context carries the emotion map", async () => {
  const fact = (id: string, text: string, entities: string[], feeling: string | null = null, valence: number | null = null) => ({ id, text, entities, feeling, valence, kind: "EVENT", happenedAt: null });
  const saved: { feeling: string | null; valence: number | null }[] = [];
  const tools = coachTools({
    msgs: [], tz: 0, knownFacts: [],
    facts: [fact("a", "Fight about the trip", ["goa trip"], "hurt", -2), fact("b", "Booked flights", ["goa trip", "money"]), fact("c", "Saving for a bike", ["money"]), fact("d", "Loves sushi", ["food"])],
    saveFact: async (f) => void saved.push({ feeling: f.feeling, valence: f.valence }),
    retireFact: async () => undefined,
  });
  const run = (t: unknown, i: object) => (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(i, {});
  const out = String(await run(tools.recall, { about: "hurt" }));
  expect(out).toContain("Fight about the trip {about: goa trip; felt: hurt -2}");
  expect(out).toContain('—MENTIONS→ goa trip ["Booked flights"]'); // one step out, through the graph
  expect(out).not.toContain("bike"); // two steps away
  expect(out).not.toContain("sushi");
  await run(tools.remember, { kind: "EVENT", text: "Cried after the call", happenedAt: "", about: [], feeling: "Sad", valence: -5 });
  await run(tools.remember, { kind: "FACT", text: "Has a cat", happenedAt: "", about: [], feeling: "", valence: 2 });
  expect(saved).toEqual([{ feeling: "sad", valence: -2 }, { feeling: null, valence: null }]);
  // A correction's feeling is about the new truth: the old memory's feeling is not carried over.
  await run(tools.correct, { old: "Fight about the trip", replacement: "Made up after the trip fight", kind: "EVENT", happenedAt: "", feeling: "", valence: 0 });
  expect(saved).toHaveLength(3);
  expect(saved.at(-1)).toEqual({ feeling: null, valence: null });
  const ctx = buildCoachContext({ personName: "Riya", relation: "FRIEND", gender: "FEMALE", notes: null, chat: null, read: null, facts: [], emotion: "- job: leans bad", budget: 1000 });
  expect(ctx).toContain("<emotion_map>\n- job: leans bad\n</emotion_map>");
});

it("recall over the cap keeps the newest; old stored tool calls without feeling still parse", async () => {
  const { coachTools } = await import("./coach");
  const facts = Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, kind: "EVENT", text: `Job event number ${i}`, happenedAt: null, entities: ["job"] }));
  const tools = coachTools({ msgs: [], tz: 0, knownFacts: [], facts, saveFact: async () => "new" });
  const run = (t: unknown, i: object) => (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(i, {});
  await run(tools.remember, { kind: "EVENT", text: "She quit her job today", happenedAt: "", about: ["job"], feeling: "", valence: 0 });
  const out = String(await run(tools.recall, { about: "job" }));
  expect(out).toContain("She quit her job today");
  expect(out).not.toContain("Job event number 0");
  const schema = tools.remember.inputSchema as unknown as { safeParse: (i: object) => { success: boolean } };
  expect(schema.safeParse({ kind: "FACT", text: "Likes filter coffee", happenedAt: "", about: [] }).success).toBe(true);
});

it("searchChat ranks by words matched and shows the lines around a hit", () => {
  const chat = ["i can't have milk, allergic", "ok noted", "do you like cheese", "not really", "but i'll make you a cheese pasta", "you're the best", "anyway how was work"].map((text, i) => ({ sender: i % 2 ? "Me" : "Riya", text, ts: Date.UTC(2026, 10, 14, 10, i) }));
  const [top, second] = searchMessages(chat, "cheese pasta milk", 2, 0);
  expect(top).toContain("> [2026-11-14 10:04] Riya: but i'll make you a cheese pasta"); // two words beat one
  expect(top).toContain("  [2026-11-14 10:03] Me: not really"); // tone: the lines around it
  expect(second).toContain("> [2026-11-14 10:00] Riya: i can't have milk, allergic"); // "do you like cheese" is already inside the first hit
});

it("the coach finds the cheese link: remember writes triples, recall and connect read the graph", async () => {
  const saved: { text: string; triples?: unknown[] }[] = [];
  let n = 0;
  const tools = coachTools({ msgs: [], tz: 0, knownFacts: [], facts: [], personName: "Riya", saveFact: async (f) => (saved.push({ text: f.text, triples: f.triples }), `m${++n}`) });
  const run = (t: unknown, i: object) => (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(i, {});
  await run(tools.remember, { kind: "FACT", text: "Allergic to milk", happenedAt: "2026-03-02", about: ["milk"], triples: [{ from: "them", rel: "AVOIDS", to: "milk", label: "allergic" }, { from: "milk", rel: "IS_A", to: "milk product", label: "" }] });
  await run(tools.remember, { kind: "EVENT", text: "Offered to make me a cheese dish though she doesn't like cheese", happenedAt: "2026-11-14", about: ["cheese"], feeling: "caring", valence: 1, triples: [{ from: "them", rel: "DID_FOR", to: "cheese", label: "offered to cook" }, { from: "cheese", rel: "IS_A", to: "milk product", label: "" }] });
  expect(saved[1].triples).toHaveLength(2);
  const recall = String(await run(tools.recall, { about: "cheese" }));
  expect(recall).toContain("Riya —DID_FOR (offered to cook)→ cheese");
  expect(recall).toContain("! Effort at a cost");
  expect(recall).toContain("Allergic to milk");
  const link = String(await run(tools.connect, { a: "cheese", b: "milk" }));
  expect(link).toContain("cheese —IS_A→ milk product");
  expect(String(await run(tools.connect, { a: "cheese", b: "cricket" }))).toBe("Not in memory: cricket.");
});

it("recall on the person's own name lists what hangs off them", async () => {
  const { coachTools } = await import("./coach");
  const facts = [{ id: "a", kind: "PREFERENCE", text: "Loves filter coffee", happenedAt: null, entities: ["filter coffee"] }];
  const tools = coachTools({ msgs: [], tz: 0, knownFacts: [], facts, saveFact: async () => "new", personName: "Riya Sharma" });
  const run = (t: unknown, i: object) => (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(i, {});
  const out = String(await run(tools.recall, { about: "Riya" }));
  expect(out).toContain("filter coffee");
  expect(out).not.toContain("No links yet");
});
