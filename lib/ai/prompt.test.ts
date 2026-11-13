import { expect, it } from "vitest";
import { buildAdvicePrompt, buildPrompt, INCREMENTAL_CONTEXT } from "./prompt";
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

it("advice refresh carries current notes, memory and date, the settled read, and only the tail of the chat", () => {
  const read = { status: { label: "Warm", explanation: "x" }, nextMoves: [{ action: "old move", why: "", when: "" }], messageSuggestions: ["old text"] } as unknown as Analysis;
  const p = buildAdvicePrompt({
    ...base,
    notes: "we had a fight yesterday",
    facts: [{ kind: "EVENT", text: "She got a new job", happenedAt: null }],
    now: Date.UTC(2027, 0, 5),
    read,
  });
  expect(p).toContain("we had a fight yesterday");
  expect(p).toContain("She got a new job");
  expect(p).toContain("Today is 2027-01-05");
  const part = (tag: string) => p.split(`<${tag}>`)[1].split(`</${tag}>`)[0];
  expect(part("read")).toContain('"label":"Warm"');
  expect(part("read")).not.toContain("old move"); // advice is not part of the settled read
  expect(part("previous_advice")).toContain("old move");
  expect(part("recent_chat").trim().split("\n")).toHaveLength(INCREMENTAL_CONTEXT);
});
