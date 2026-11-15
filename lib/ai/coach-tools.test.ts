import { expect, it } from "vitest";
import { anyWordQuery, buildCoachContext, capFor, COACH_HISTORY, coachTools, snippet } from "./coach";
import { KEEP_RECENT, needsCompaction, renderForSummary, splitForSummary, summaryPrompt } from "./compact";
import { CHAR_BUDGET } from "./models";
import { planMemory, type GEdge, type GNode, type Triple } from "../graph";
import { voiceProfile } from "../voice";

const run = (t: unknown, i: object) => (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(i, {});
const parse = (t: unknown, i: object) => (t as { inputSchema: { safeParse: (i: object) => { success: boolean } } }).inputSchema.safeParse(i).success;

type Memory = { id: string; text: string; date?: string; triples: Triple[] };
function rows(memories: Memory[]) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  for (const m of memories) {
    const p = planMemory(nodes, edges, { factId: m.id, triples: m.triples }, { personName: "Riya", newId: () => `x${++n}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges);
  }
  return { graph: { nodes, edges }, facts: memories.map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: m.date ? new Date(m.date) : null, entities: [] })) };
}
const base = { tz: 0, knownFacts: [], saveFact: async () => "new", personName: "Riya" };

it("check_draft catches the seafood plan through the category, and holds the draft to the user's typing", async () => {
  const mem = rows([
    { id: "a", text: "Allergic to shellfish", triples: [{ from: "them", rel: "AVOIDS", to: "shellfish", label: "allergic" }] },
    { id: "b", text: "Prawns are shellfish", triples: [{ from: "prawns", rel: "IS_A", to: "shellfish" }] },
  ]);
  const mine = Array.from({ length: 30 }, (_, i) => ({ sender: "Me", text: `kya plan h ${i}`, ts: Date.UTC(2026, 10, 1, 10, i) }));
  const tools = coachTools({ ...base, msgs: mine, ...mem, voice: voiceProfile(mine, "Me") });
  const bad = (await run(tools.check_draft, { text: "Hey! Prawns at the new seafood place on Saturday?" })) as { ok: boolean; problems: string[]; text: string };
  expect(bad.ok).toBe(false);
  expect(bad.problems[0]).toContain("Careful with prawns: Riya avoid shellfish (allergic)");
  expect(bad.problems[1]).toContain("Typing");
  expect(bad.text).toBe("prawns at the new seafood place on saturday?"); // no greeting, lowercase, like the user
  expect(await run(tools.check_draft, { text: "movie on saturday?" })).toEqual({ ok: true, problems: [], text: "movie on saturday?" });
});

it("quote returns the stored line with the lines around it; recall marks edges that have one", async () => {
  const msgs = ["i love cheese", "ugh i don't like cheese", "but i can make it for you even though i don't like it", "you're the best", "anyway"].map((text, i) => ({ sender: i % 3 ? "Riya" : "Me", text, ts: Date.UTC(2026, 10, 14, 10, i) }));
  const mem = rows([{ id: "f", text: "Offered to cook cheese", triples: [{ from: "them", rel: "DID_FOR", to: "cheese", label: "offered to cook" }] }]);
  const edge = mem.graph.edges.find((e) => e.rel === "DID_FOR")!;
  Object.assign(edge, { quoted: true, tone: "warm", at: new Date(msgs[2].ts) });
  const asked: string[] = [];
  const tools = coachTools({ ...base, msgs, ...mem, quote: async (id) => (asked.push(id), id === edge.id ? { text: msgs[2].text, ts: msgs[2].ts, sender: "them" } : null) });
  expect(String(await run(tools.recall, { about: "cheese" }))).toContain(`said warm] [q:${edge.id}]`);
  const out = String(await run(tools.quote, { edgeId: `[q:${edge.id}]` })); // the marker pasted whole still works
  expect(asked).toEqual([edge.id]);
  expect(out.split("\n")).toEqual([
    "  [2026-11-14 10:00] Me: i love cheese",
    "  [2026-11-14 10:01] Riya: ugh i don't like cheese",
    "> [2026-11-14 10:02] Riya: but i can make it for you even though i don't like it",
    "  [2026-11-14 10:03] Me: you're the best",
    "  [2026-11-14 10:04] Riya: anyway",
  ]);
  expect(await run(tools.quote, { edgeId: "nope" })).toBe("No quote stored for that id.");
  // The chat was replaced since: the stored line still comes back, alone.
  const alone = coachTools({ ...base, msgs: [], ...mem, quote: async () => ({ text: "kept line", ts: msgs[2].ts, sender: "them" }) });
  expect(await run(alone.quote, { edgeId: edge.id })).toBe("> [2026-11-14 10:02] Riya: kept line");
});

it("findings lists stored ones with their evidence; history says what used to be true", async () => {
  const mem = rows([
    { id: "a", text: "Loves sushi", date: "2026-01-10", triples: [{ from: "them", rel: "LIKES", to: "sushi" }] },
    { id: "b", text: "Can't stand sushi since the food poisoning", date: "2026-06-02", triples: [{ from: "them", rel: "DISLIKES", to: "sushi" }] },
    { id: "c", text: "Offered to cook cheese though she dislikes it", triples: [{ from: "them", rel: "DISLIKES", to: "cheese" }, { from: "them", rel: "DID_FOR", to: "cheese", label: "offered" }] },
  ]);
  const offer = mem.graph.edges.find((e) => e.rel === "DID_FOR")!;
  const stored = [{ key: "cost|old", kind: "cost", text: "Effort at a cost: stored wording", edgeIds: [offer.id], firstSeenAt: new Date("2026-11-08"), retiredAt: null }, { key: "gone", kind: "drift", text: "retired one", edgeIds: [], firstSeenAt: new Date("2026-10-01"), retiredAt: new Date("2026-10-20") }];
  const tools = coachTools({ ...base, msgs: [], ...mem, findings: stored });
  const all = String(await run(tools.findings, {}));
  expect(all).toContain("! [cost, first noticed 2026-11-08] Effort at a cost: stored wording\n  - Riya —DID_FOR (offered)→ cheese");
  expect(all).toContain("[mixed, new this turn] Changed on 2026-06-02");
  expect(all).not.toContain("retired one");
  expect(String(await run(tools.findings, { kind: "mixed" }))).not.toContain("stored wording");
  expect(await run(tools.findings, { kind: "drift" })).toBe("No findings yet.");
  expect(String(await run(tools.history, { about: "Sushi" }))).toBe('- before: Riya —LIKES→ sushi [2026-01-10 "Loves sushi"]\n  now: Riya —DISLIKES→ sushi [2026-06-02 "Can\'t stand sushi since the food poisoning"]');
  expect(await run(tools.history, { about: "cheese" })).toBe("Nothing about cheese has changed in memory.");
});

it("search_history merges earlier conversations and the chat, labelled; results are capped; old stored calls still parse", async () => {
  const msgs = [{ sender: "Riya", text: "the goa trip is in december", ts: Date.UTC(2026, 10, 1) }];
  const tools = coachTools({ ...base, msgs, searchHistory: async (q) => [{ source: 'coach conversation "Trip", 2026-11-02, coach', text: `we agreed you would ask about ${q}` }], cap: 1_500 });
  const out = String(await run(tools.search_history, { query: "goa", limit: 5 }));
  expect(out).toContain('[coach conversation "Trip", 2026-11-02, coach] we agreed you would ask about goa');
  expect(out).toContain("[chat]\n> [2026-11-01 00:00] Riya: the goa trip is in december");
  expect(await run(coachTools({ ...base, msgs: [] }).search_history, { query: "x1", limit: 5 })).toBe("Nothing found.");

  const long = Array.from({ length: 400 }, (_, i) => ({ sender: "Riya", text: `hello number ${i} with some padding so it is long`, ts: Date.UTC(2026, 0, 1) + i * 60_000 }));
  const cut = String(await run(coachTools({ ...base, msgs: long, cap: capFor(CHAR_BUDGET.GROQ) }).searchChat, { query: "hello", limit: 40 }));
  expect(cut.length).toBeLessThan(capFor(CHAR_BUDGET.GROQ) + 60);
  expect(cut).toContain("(cut: ask for something narrower)");
  expect(capFor(CHAR_BUDGET.GEMINI)).toBe(6_000);

  // Calls stored before these tools and fields existed: a failure here would drop a whole thread's history.
  expect(parse(tools.recall, { about: "cheese" })).toBe(true);
  expect(parse(tools.connect, { a: "cheese", b: "milk" })).toBe(true);
  expect(parse(tools.remember, { kind: "FACT", text: "Likes filter coffee", happenedAt: "", about: [] })).toBe(true);
  expect(parse(tools.correct, { old: "Likes tea", replacement: "", kind: "FACT", happenedAt: "" })).toBe(true);
  expect(parse(tools.searchChat, { query: "cheese" })).toBe(true);
  expect(parse(tools.findings, {})).toBe(true);
  expect(parse(tools.search_history, { query: "goa" })).toBe(true);

  expect(anyWordQuery("Goa trip, & 'drop table'!")).toBe("goa | trip | drop | table");
  expect(anyWordQuery("!! ?")).toBeNull();
  expect(snippet([{ type: "text", text: `${"x ".repeat(100)}we decided on goa in december` }, { type: "tool-recall", output: "goa" }], "goa")).toMatch(/^….*we decided on goa in december$/);
});

it("a 200-message thread: the older part is summarised from text that still holds turn 5's decision, the rest stays word for word", () => {
  const thread = Array.from({ length: 200 }, (_, i) => {
    const turn = Math.floor(i / 2) + 1, user = i % 2 === 0;
    const text = turn === 5 ? (user ? "ok i've decided: i won't text her until friday" : "Good. Not texting until Friday it is.") : `${user ? "question" : "answer"} ${turn}`;
    return { id: `m${i}`, role: user ? "user" : "assistant", parts: user ? [{ type: "text", text }] : [{ type: "step-start" }, { type: "tool-remember", state: "output-available", output: { saved: turn === 6, text: "Plans to wait until Friday" } }, { type: "text", text }] };
  });
  expect(needsCompaction(thread, CHAR_BUDGET.GEMINI)).toBe(true);
  expect(needsCompaction(thread.slice(0, COACH_HISTORY), CHAR_BUDGET.GEMINI)).toBe(false);
  expect(needsCompaction(thread.slice(0, 40), 2_000)).toBe(true); // few messages, but over 40% of a small budget
  expect(needsCompaction(thread.slice(0, KEEP_RECENT), 100)).toBe(false); // never below what is kept anyway
  const { older, recent } = splitForSummary(thread);
  expect(older).toHaveLength(180);
  expect(recent).toHaveLength(KEEP_RECENT);
  expect(recent[0].role).toBe("user");
  expect(splitForSummary(thread.slice(0, 199)).recent[0].role).toBe("user"); // an odd cut moves to the next user message
  const text = renderForSummary(older);
  expect(text).toContain("User: ok i've decided: i won't text her until friday");
  expect(text).toContain("Coach: answer 6 [saved to memory: Plans to wait until Friday]");
  expect(text).not.toContain("step-start");
  const prompt = summaryPrompt("- Decisions: none yet", text, "Riya");
  expect(prompt).toContain("Summary so far");
  expect(prompt).toContain("won't text her until friday");
  // What the next turn is sent: the summary, then only the recent messages.
  const ctx = buildCoachContext({ personName: "Riya", relation: "FRIEND", gender: "FEMALE", notes: null, chat: null, read: null, facts: [], budget: 1000, summary: "- Decisions: won't text her until Friday (turn 5)" });
  expect(ctx).toContain("<conversation_so_far");
  expect(ctx).toContain("won't text her until Friday (turn 5)");
});

it("remember applies an alias the store wrote, so recall of that spelling shows the existing node", async () => {
  const mem = rows([{ id: "a", text: "Likes dahi", triples: [{ from: "them", rel: "LIKES", to: "dahi" }] }]);
  const dahi = mem.graph.nodes.find((n) => n.key === "dahi")!;
  const tools = coachTools({
    ...base,
    msgs: [],
    ...mem,
    saveFact: async () => ({ id: "b", nodes: [], edges: [], aliases: [{ nodeId: dahi.id, alias: "curd" }] }),
  });
  await run(tools.remember, { kind: "FACT", text: "She calls it curd too", happenedAt: "", about: ["curd"], feeling: "", valence: 0, triples: [] });
  expect(String(await run(tools.recall, { about: "curd" }))).toContain("dahi (also: curd)");
});
