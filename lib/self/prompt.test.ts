import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildGraph, planMemory, type GEdge, type GNode, type Triple } from "../graph";
import { buildCoachContext, coachTools } from "../ai/coach";
import { buildPersonaContext } from "../ai/persona";
import { buildMemoryReadPrompt } from "../ai/prompt";
import { CHAR_BUDGET } from "../ai/models";
import { commonGround, mentionsAny, SELF_SHARE, selfForPrompt, type PTrait } from "./prompt";

const tr = (kind: string, text: string, scope = "GLOBAL", relation: string | null = null, people = 2): PTrait => ({ kind, text, scope, relation, people, support: 3, confidence: 0.7, noEvidence: false });
const traits = [
  tr("HOBBY", "Plays football on Sundays"),
  tr("INTEREST", "Loves cheese"),
  tr("BLIND_SPOT", "Goes quiet instead of saying what's wrong"),
  tr("TEXTING", "Replies within minutes", "RELATION", "CRUSH", 1),
  tr("TEXTING", "Takes days to reply", "RELATION", "FRIEND", 1),
];

function graphOf(memories: { id: string; triples: Triple[] }[]) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  for (const m of memories) {
    const p = planMemory(nodes, edges, { factId: m.id, triples: m.triples }, { personName: "Riya", newId: () => `x${++n}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges);
  }
  return buildGraph(nodes, edges, memories.map((m) => ({ id: m.id, kind: "FACT", text: m.id, happenedAt: null })), { them: "Riya" });
}

it("the profile block: blind spots first, this relationship's traits only, inside the budget", () => {
  const block = selfForPrompt({ summary: "You are sporty and steady.", traits, relation: "CRUSH", budget: 1_000 });
  const lines = block.split("\n");
  expect(lines[0]).toBe("You are sporty and steady.");
  expect(lines[1]).toBe("- [blind spot, with 2 people] Goes quiet instead of saying what's wrong");
  expect(block).toContain("[texting, with this crush] Replies within minutes");
  expect(block).not.toContain("Takes days to reply"); // that one was seen with a friend
  expect(selfForPrompt({ summary: null, traits, relation: "CRUSH", budget: 80 }).length).toBeLessThanOrEqual(80);
  expect(Math.floor(CHAR_BUDGET.GROQ * SELF_SHARE)).toBe(1_600);
});

it("common ground: a shared interest leads; something the user loves that she avoids is a caution", () => {
  const g = graphOf([
    { id: "a", triples: [{ from: "them", rel: "LIKES", to: "football" }] },
    { id: "b", triples: [{ from: "them", rel: "AVOIDS", to: "milk", label: "allergic" }, { from: "cheese", rel: "IS_A", to: "milk product" }, { from: "milk", rel: "IS_A", to: "milk product" }] },
  ]);
  const out = commonGround(traits, g, "Riya").split("\n");
  expect(out[0]).toBe("+ You: Plays football on Sundays. Riya likes football.");
  expect(out[1]).toBe("! You: Loves cheese. But Riya avoids milk (allergic): don't build a plan on it.");
  expect(commonGround(traits, graphOf([{ id: "c", triples: [{ from: "them", rel: "LIKES", to: "opera" }] }]), "Riya")).toBe("");
});

it("the coach sees the profile and common ground, and is told whose it is", () => {
  const ctx = buildCoachContext({ personName: "Riya", relation: "CRUSH", gender: "FEMALE", notes: null, chat: null, read: null, facts: [], budget: 1000, self: selfForPrompt({ summary: null, traits, relation: "CRUSH", budget: 1000 }), common: "+ You: Plays football on Sundays. Riya likes football." });
  expect(ctx).toContain('<about_user note="the USER themself');
  expect(ctx).toContain("Goes quiet instead of saying what's wrong"); // a blind spot the coach can name
  expect(ctx).toContain("<common_ground");
  expect(buildMemoryReadPrompt({ personName: "Riya", relation: "CRUSH", gender: "FEMALE", notes: "x", tzOffsetMin: 0, self: "- [hobby] Plays football" })).toContain("a prior for yourSide");
});

it("rememberMe: saves through the store, old stored calls still parse, and it is off in debriefs", async () => {
  const saved: string[] = [];
  const tools = coachTools({ msgs: [], tz: 0, knownFacts: [], saveFact: async () => "x", rememberMe: async (k, t) => (saved.push(`${k}:${t}`), true) });
  const run = (i: object) => (tools.rememberMe.execute as unknown as (i: object, o: object) => Promise<unknown>)(i, {});
  expect(await run({ kind: "HOBBY", text: "Plays football on Sundays" })).toEqual({ saved: true, text: "Plays football on Sundays" });
  expect(await run({ kind: "HOBBY", text: " " })).toEqual({ saved: false });
  expect(saved).toEqual(["HOBBY:Plays football on Sundays"]);
  expect((tools.rememberMe.inputSchema as unknown as { safeParse: (i: object) => { success: boolean } }).safeParse({}).success).toBe(true);
  const coach = readFileSync(new URL("../../app/api/people/[id]/coach/route.ts", import.meta.url), "utf8");
  expect(coach).toContain("const tools = debriefId ? readOnly : { remember, correct, rememberMe, ...readOnly }");
});

it("the rehearsal persona never sees the user's profile", () => {
  const ctx = buildPersonaContext({ personName: "Riya", relation: "CRUSH", gender: "FEMALE", chat: null, read: null, graph: "", boundaries: [], said: "football on sunday?", budget: 40_000 });
  expect(ctx).not.toContain("about_user");
  expect(mentionsAny(ctx, traits)).toBe(false);
  const persona = readFileSync(new URL("../ai/persona.ts", import.meta.url), "utf8");
  const rehearse = readFileSync(new URL("../../app/api/people/[id]/rehearse/route.ts", import.meta.url), "utf8");
  for (const src of [persona, rehearse]) {
    expect(src).not.toMatch(/lib\/self|selfForPrompt|loadSelf|commonGround/);
  }
});
