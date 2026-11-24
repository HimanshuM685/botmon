import { expect, it } from "vitest";
import { buildMemoryReadPrompt, buildModelPatchPrompt, buildPrompt, INCREMENTAL_CONTEXT, SYSTEM } from "./prompt";
import { computeStats } from "../stats";
import type { Analysis } from "./schema";

const H = 3600_000;
const msgs = Array.from({ length: 2000 }, (_, i) => ({ sender: i % 2 ? "Me" : "Riya", text: `message number ${i} with some words`, ts: Date.UTC(2026, 10, 1) + i * H }));
const base = { personName: "Riya", relation: "CRUSH" as const, gender: "FEMALE", notes: null, myName: "Me", theirName: "Riya", tzOffsetMin: 0, msgs, budget: 1e9, stats: computeStats(msgs, "Me") };
const prevResult = { status: { label: "Warm", score: 70, explanation: "x" } } as unknown as Analysis;

it("incremental prompt sends only new messages plus a short context", () => {
  const throughAt = msgs[1989].ts; // 10 new messages
  const full = buildPrompt(base);
  const inc = buildPrompt({ ...base, previous: { result: prevResult, throughAt } });
  const section = (tag: string) => inc.split(`<${tag}>`)[1].split(`</${tag}>`)[0].trim().split("\n");
  expect(section("new_messages")).toHaveLength(10);
  expect(section("context_before")).toHaveLength(INCREMENTAL_CONTEXT);
  expect(inc).toContain('"label":"Warm"');
  expect(inc.length).toBeLessThan(full.length / 10);
});

it("full re-read carries the prior read as an anchor and flags thin chats", () => {
  const short = msgs.slice(-50);
  const p = buildPrompt({ ...base, msgs: short, stats: computeStats(short, "Me"), anchor: prevResult });
  expect(p).toContain("<prior_read>");
  expect(p).toContain("Limited evidence");
  expect(buildPrompt(base)).not.toContain("<prior_read>");
  expect(buildPrompt(base)).not.toContain("Limited evidence");
});

it("model update carries what changed, the current read, and only the tail of the chat", () => {
  const read = { status: { label: "Warm", explanation: "x" }, nextMoves: [{ action: "old move", why: "", when: "" }], messageSuggestions: ["old text"] } as unknown as Analysis;
  const p = buildModelPatchPrompt({
    ...base,
    notes: "we had a fight yesterday",
    facts: [{ kind: "EVENT", text: "She got a new job", happenedAt: null }],
    added: [{ kind: "EVENT", text: "She got a new job", happenedAt: null }],
    removed: [{ kind: "FACT", text: "Has a boyfriend", happenedAt: null }],
    now: Date.UTC(2027, 0, 5),
    read,
  });
  expect(p).toContain("we had a fight yesterday");
  expect(p).toContain("Today is 2027-01-05");
  const part = (tag: string) => p.split(`<${tag}>`)[1].split(`</${tag}>`)[0];
  expect(part("read")).toContain('"label":"Warm"');
  expect(part("read")).not.toContain("old move"); // advice is shown separately
  // Moves and messages are written fresh, never copied forward; last time's messages are listed apart.
  expect(part("previous_advice")).not.toContain("old move");
  expect(part("previous_advice")).not.toContain("old text");
  expect(p).toMatch(/Messages you suggested last time\. Not sent: "old text"/);
  expect(part("where_it_stands")).toContain("Last message");
  expect(part("new_information")).toContain("She got a new job");
  expect(part("new_information")).toMatch(/No longer true[\s\S]*Has a boyfriend/);
  expect(part("recent_chat").trim().split("\n")).toHaveLength(INCREMENTAL_CONTEXT);
});

it("works without a chat: no stats, no chat section, memory as the evidence", () => {
  const noChat = { personName: "Riya", relation: "CRUSH" as const, gender: "FEMALE", notes: "met at college", tzOffsetMin: 0, facts: [{ kind: "EVENT", text: "We had coffee", happenedAt: null }] };
  const create = buildMemoryReadPrompt(noChat);
  expect(create).toContain("no chat export");
  expect(create).toContain("We had coffee");
  expect(create).not.toContain("Computed stats");
  const patch = buildModelPatchPrompt({ ...noChat, read: prevResult, msgs: [], added: [], removed: [] });
  expect(patch).not.toContain("<recent_chat>");
  expect(patch).toContain("No single memory is marked as new");
});

it("carries the user's typing voice into reads and model updates, and only when there is one", () => {
  const voice = "How the user types, measured from 21 of their own messages.";
  expect(buildPrompt({ ...base, voice })).toContain(voice);
  expect(buildModelPatchPrompt({ ...base, voice, read: prevResult, added: [], removed: [] })).toContain(voice);
  expect(buildPrompt(base)).not.toContain("How the user types, measured");
  expect(buildMemoryReadPrompt({ personName: "Riya", relation: "CRUSH", gender: "FEMALE", notes: null, tzOffsetMin: 0, voice })).not.toContain(voice); // no chat, nothing measured
});

it("tells the model which of last time's messages the user has since sent", () => {
  const read = { messageSuggestions: ["whats ur favourite food", "sleep early"] } as unknown as Analysis;
  const chat = [...msgs.slice(0, 10), { sender: "Me", text: "whats your favourite food?", ts: msgs[10].ts }];
  const p = buildModelPatchPrompt({ ...base, msgs: chat, stats: computeStats(chat, "Me"), read, added: [], removed: [], readThrough: msgs[9].ts });
  expect(p).toContain('The user has since sent: "whats ur favourite food". Never suggest those again');
  expect(p).toContain('Not sent: "sleep early"');
  expect(p).toMatch(/"whats your favourite food\?" \(no reply to it yet\)/);
  const inc = buildPrompt({ ...base, msgs: chat, stats: computeStats(chat, "Me"), previous: { result: read, throughAt: msgs[9].ts } });
  expect(inc).toContain('The user has since sent: "whats ur favourite food"');
  expect(inc.split("<previous_read>")[1].split("</previous_read>")[0]).not.toContain("sleep early");
});

it("reads tone against their own baseline, with gender only as a weak prior", () => {
  expect(buildPrompt({ ...base, theirBaseline: "How they usually type: about 3 words" })).toContain("How they usually type: about 3 words");
  expect(SYSTEM).toContain("A change from their usual is the signal");
  expect(SYSTEM).toContain("weak prior");
  expect(SYSTEM).not.toContain("brutally");
});
