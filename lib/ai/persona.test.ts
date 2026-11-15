import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildPersonaContext, DEBRIEF_SYSTEM, exchangePairs, NO_REPLY, personaSystem, personaTurns, REHEARSAL_BANNER, rehearsalTranscript } from "./persona";
import { computeStats } from "../stats";
import { applyVoice, voiceForPrompt, voiceProfile } from "../voice";

const M = 60_000, H = 60 * M;
let t = Date.UTC(2026, 10, 1);
const say = (sender: string, text: string, gap = M) => ({ sender, text, ts: (t += gap) });
// She answers in a few lowercase words, without punctuation, often hours later.
const chat = [
  say("Me", "Good morning! How did the interview go?"), say("Riya", "fine", 5 * H),
  say("Me", "Do you want to get cheese pizza tonight?"), say("Riya", "u know i cant have cheese"), say("Riya", "u get it tho"),
  say("Me", "Are you upset with me?", 26 * H), say("Riya", "no", 9 * H),
  ...Array.from({ length: 36 }, (_, i) => (i % 2 ? say("Riya", `hmm ok ${i}`, 2 * H) : say("Me", `What about plan number ${i}?`))),
];

it("real exchanges: the ones most like what was just said, with her delays; oldest first", () => {
  const pairs = exchangePairs(chat, "Me", "should we get pizza with cheese", 3);
  expect(pairs).toHaveLength(3);
  expect(pairs[0]).toMatchObject({ mine: "Do you want to get cheese pizza tonight?", theirs: "u know i cant have cheese\nu get it tho" });
  expect(pairs.map((p) => p.at)).toEqual([...pairs.map((p) => p.at)].sort((a, b) => a - b));
  expect(exchangePairs(chat, "Me", "zzz qqq", 2).map((p) => p.theirs)).toEqual(["hmm ok 33", "hmm ok 35"]); // nothing alike: the latest
  expect(exchangePairs(chat, "Me", "interview", 1)[0].gapMin).toBe(300);
});

it("persona context is grounded: her voice, boundaries, the read, real exchanges, the recent chat", () => {
  const her = voiceProfile(chat, "Riya")!;
  const ctx = buildPersonaContext({
    personName: "Riya", relation: "GIRLFRIEND", gender: "FEMALE",
    chat: { myName: "Me", theirName: "Riya", tzOffset: 0, stats: computeStats(chat, "Me", 0), msgs: chat },
    read: { status: { label: "Cooling" }, mind: { investment: "low" }, emotional: { currentMood: "tired" }, communicationStyle: "short", likes: ["never sent"] },
    graph: "! Effort at a cost: …",
    boundaries: ["Riya —AVOIDS (allergic)→ milk"],
    voice: voiceForPrompt(her, "them"),
    said: "cheese pizza tonight? and how was the interview",
    budget: 40_000,
    now: t,
  });
  expect(ctx).toContain("You are Riya");
  expect(ctx).toContain('"label":"Cooling"');
  expect(ctx).not.toContain("never sent"); // only how she is, not the whole read
  expect(ctx).toContain("<boundaries");
  expect(ctx).toContain("- Riya —AVOIDS (allergic)→ milk");
  expect(ctx).toContain("<their_voice>");
  expect(ctx).toContain("User: Do you want to get cheese pizza tonight?\nThem: u know i cant have cheese\nu get it tho");
  expect(ctx).toContain("Them (replied after 5h): fine");
  expect(ctx).toContain("<recent_chat");
  // No chat: says the style is a guess instead of inventing one.
  const bare = buildPersonaContext({ personName: "Riya", relation: "FRIEND", gender: "FEMALE", chat: null, read: null, said: "hi", budget: 40_000 });
  expect(bare).toContain("how they type is not known");
  expect(bare).not.toContain("<real_exchanges");
});

it("replies are held to her measured habits, and the prompt carries the limits", () => {
  const her = voiceProfile(chat, "Riya")!;
  expect(her.count).toBeGreaterThanOrEqual(20);
  expect(her.medianWords).toBeLessThanOrEqual(3);
  expect(applyVoice("Hey! I told you, I can't have cheese. You get it though!", her)).toBe("i told you, i can't have cheese. you get it though");
  const sys = personaSystem("Riya");
  expect(sys).toContain(NO_REPLY);
  expect(sys).toMatch(/No warmer/);
  expect(sys).toMatch(/decline it for themselves/);
  expect(sys).toMatch(/Never invent big facts/);
  expect(sys).toMatch(/No sexual or erotic roleplay/);
  expect(sys).toMatch(/guilt-tripping[\s\S]*ignoring a "no"[\s\S]*setting a boundary/);
  expect(REHEARSAL_BANNER("Riya")).toBe("Simulation, not Riya. Nothing is sent to anyone.");
});

it("debrief: the transcript marks every simulated line, and the coach is told it is not evidence", () => {
  const rows = [
    { role: "user", parts: [{ type: "text", text: "cheese pizza tonight?" }] },
    { role: "assistant", parts: [{ type: "text", text: "u know i cant have cheese" }] },
    { role: "assistant", parts: [{ type: "step-start" }] },
  ];
  expect(rehearsalTranscript(rows, "Riya")).toBe("User: cheese pizza tonight?\nRiya (simulated): u know i cant have cheese");
  expect(personaTurns(rows)).toEqual([{ role: "user", content: "cheese pizza tonight?" }, { role: "assistant", content: "u know i cant have cheese" }]);
  expect(DEBRIEF_SYSTEM("Riya")).toMatch(/SIMULATION of Riya/);
  expect(DEBRIEF_SYSTEM("Riya")).toMatch(/cannot save or correct memories/);
});

it("simulated words can't reach memory: the rehearse route has no tools and writes no facts, edges or findings", () => {
  const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const rehearse = src("app/api/people/[id]/rehearse/route.ts");
  for (const banned of ["saveMemories", "linkMemories", "coachTools", "scheduleGraphJob", "syncGraph", "personFact.create", "personFact.update", "memoryEdge.", "memoryFinding.", "tools:"]) expect(rehearse, banned).not.toContain(banned);
  expect(rehearse).toContain('beginTurn(req, (await params).id, {');
  expect(rehearse).toContain('mode: "rehearsal"');
  const coach = src("app/api/people/[id]/coach/route.ts");
  expect(coach).toContain(`t."mode" = 'coach'`); // search_history never reads rehearsal threads
  expect(coach).toContain('beginTurn(req, (await params).id, { mode: "coach" })');
  expect(coach).toContain("const tools = debriefId ? readOnly"); // a debrief cannot write memory
  expect(src("lib/ai/turn.ts")).toContain("deletedAt: null, mode: opts.mode"); // a thread continues only in its own mode
  expect(src("app/(app)/people/[id]/coach/page.tsx")).toContain('mode: "coach"');
  // The banner sits outside the scrolling message list, so it is always on screen.
  const ui = src("components/coach-chat.tsx");
  expect(ui.indexOf("REHEARSAL_BANNER(personName)")).toBeLessThan(ui.indexOf("ref={scroller}"));
  expect(ui.indexOf("REHEARSAL_BANNER(personName)")).toBeGreaterThan(0);
});
