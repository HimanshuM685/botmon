import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { generateText, Output } from "ai";
import { db } from "@/lib/db";
import { alive } from "@/lib/trash";
import { getActiveKey, loadChat } from "@/lib/data";
import { budgetFor } from "@/lib/ai/models";
import { getModel, providerError } from "@/lib/ai/provider";
import { charsFor, rateLimit } from "@/lib/ai/limits";
import { seedFor } from "@/lib/ai/stream";
import { buildChapterPrompt, buildEraPrompt, type RelationId } from "@/lib/ai/prompt";
import { analysisSchema, chapterSchema, eraSchema, type Analysis, type ChapterResult } from "@/lib/ai/schema";
import { eraRange, historyWork, type Range } from "@/lib/history";
import { claimHistoryRun, loadUnits, releaseHistoryRun, saveUnit } from "@/lib/history-store";
import { learnFromChat } from "@/lib/self/store";
import { factsFromAnalysis, newFacts } from "@/lib/facts";
import { loadGraph, saveMemories } from "@/lib/graph-store";
import { scheduleGraphJob } from "@/lib/graph/job";
import { toLocal } from "@/lib/stats";
import { prepareRead } from "./run";

/**
 * Long chats are read in the background: every chapter, then eras, then the read itself, one model call per step.
 * Each step runs in its own request to /api/jobs/read, which queues the next with `after()`, so nothing depends on
 * the user's tab and no request comes near the function time limit. Rate limits set `readNextAt`; the chain sleeps
 * until then. A broken chain (deploy, crash) is picked up again when the person's page asks for the status.
 */

/** One step holds the chat's history lock at most this long (a crashed step frees it after). */
const LOCK_MS = 280_000;
/** Function time limit of the jobs route (maxDuration); the chain sleeps only within it. */
export const STEP_MAX_MS = 300_000;
/** No step for this long while a job is set: its chain broke. */
const STALLED_MS = 90_000;
/** Below this many chars per call the chat can't be read usefully on this key. */
const MIN_BUDGET = 8_000;

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const day = (ts: number, tz: number) => toLocal(ts, tz).toISOString().slice(0, 10);
const inRange = (msgs: { ts: number }[], r: Range) => msgs.filter((m) => m.ts >= r.fromTs && m.ts <= r.toTs) as Parameters<typeof buildChapterPrompt>[0]["msgs"];

/** Proof that a jobs request was queued by this app: no session there, and no extra secret to configure. */
export const jobToken = (chatId: string) => createHmac("sha256", process.env.ENCRYPTION_KEY ?? "").update(`read-job:${chatId}`).digest("hex");
export function validToken(chatId: string, token: string | null) {
  const want = Buffer.from(jobToken(chatId)), got = Buffer.from(token ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Queue the next step once this response is sent: wait `delayMs` (only as long as this request may still run;
 * the next request waits the rest), then call the jobs route without waiting for it to finish.
 */
export function kick(origin: string, chatId: string, delayMs = 0, startedAt = Date.now()) {
  after(async () => {
    await sleep(Math.max(0, Math.min(delayMs, STEP_MAX_MS - 20_000 - (Date.now() - startedAt))));
    const sent = fetch(`${origin}/api/jobs/read`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jobToken(chatId)}` },
      body: JSON.stringify({ chatId }),
    }).catch((e) => console.error("read job: chain broke", (e as Error)?.message));
    await Promise.race([sent, sleep(3_000)]); // long enough to send it; the step runs in its own request
  });
}

export async function startRead(origin: string, chatId: string, mode: "auto" | "full") {
  await db.chatUpload.update({ where: { id: chatId }, data: { readMode: mode, readNextAt: new Date(), readError: null } });
  kick(origin, chatId);
}

export const cancelRead = (chatId: string) => db.chatUpload.update({ where: { id: chatId }, data: { readMode: null, readNextAt: null } });

/** A job is set but no step ran or is due: the chain broke. Start it again. */
export function resumeIfStalled(origin: string, chat: { id: string; readMode: string | null; readNextAt: Date | null; historyLockUntil: Date | null }, now = Date.now()) {
  const locked = chat.historyLockUntil && chat.historyLockUntil.getTime() > now;
  if (chat.readMode && !locked && (chat.readNextAt?.getTime() ?? 0) < now - STALLED_MS) kick(origin, chat.id);
}

const fail = (chatId: string, error: string) => db.chatUpload.update({ where: { id: chatId }, data: { readMode: null, readNextAt: null, readError: error } });
const due = (chatId: string, at: Date) => db.chatUpload.update({ where: { id: chatId }, data: { readNextAt: at } });

/** Run one step of the chat's background read. `again`: ms until the next step; undefined when the chain stops here. */
export async function step(chatId: string): Promise<{ again?: number }> {
  const chat = await db.chatUpload.findFirst({ where: { id: chatId, ...alive } });
  if (!chat?.readMode) return {};
  const wait = (chat.readNextAt?.getTime() ?? 0) - Date.now();
  if (wait > 0) return { again: wait };
  if (!(await claimHistoryRun(chat.id, LOCK_MS))) return {}; // another step is running; it carries the chain

  const person = await db.person.findFirst({ where: { id: chat.personId, ...alive, user: alive } });
  const key = person && (await getActiveKey(person.userId));
  try {
    if (!person) return (await cancelRead(chat.id), {});
    if (!key) return (await fail(chat.id, "Add an AI key in Settings first"), {});
    const model = getModel(key.provider, key.apiKey, key.model);
    const msgs = await loadChat(chat.cipher);
    const budget = budgetFor(key);
    const stored = await loadUnits(chat.id);
    const work = historyWork(msgs, stored, budget, chat.tzOffset);
    const who = { personName: person.name, relation: person.relation as RelationId, gender: person.gender, myName: chat.myName, theirName: chat.theirName };
    // Rows from an older shape of this chat (a gap filled mid-chat, a smaller budget): read again.
    if (work.stale.length) await db.chatChapter.deleteMany({ where: { chatId: chat.id, id: { in: work.stale.map((u) => u.id) } } });
    const stillHere = async () => !!(await db.chatUpload.findFirst({ where: { id: chat.id, personId: person.id, deletedAt: null }, select: { id: true } }));

    const r = work.todo[0];
    if (r) {
      // One chapter: oldest unread first.
      const prev = stored.filter((u) => u.level === 0 && u.toTs < r.fromTs).at(-1)?.result as ChapterResult | undefined;
      const facts = await db.personFact.findMany({ where: { personId: person.id, deletedAt: null }, select: { id: true, kind: true, text: true, happenedAt: true } });
      const graph = await loadGraph(person, facts);
      const { output } = await generateText({
        model,
        prompt: buildChapterPrompt({ ...who, tzOffsetMin: chat.tzOffset, msgs: inRange(msgs, r), part: work.plan.indexOf(r) + 1, parts: work.plan.length, before: prev, known: graph.known() }),
        output: Output.object({ schema: chapterSchema }),
        temperature: 0,
        seed: seedFor(`${chat.id}:${r.fromTs}`),
        maxRetries: 1,
      });
      // Removed or moved while this was being read: its memories must not land on this person.
      if (!(await stillHere())) return {};
      const unit = await saveUnit(chat.id, { ...r, level: 0, result: output }, key.model);
      // What this period showed about the user, proven by their own lines in it.
      await learnFromChat(person.userId, person, chat, inRange(msgs, r), output.aboutUser, "CHAPTER", { chapterId: unit.id });
      // What this period taught goes to the timeline like any read's memories, marked with its chat.
      const known = (await db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, select: { text: true } })).map((f) => f.text);
      await saveMemories(person, newFacts(known, factsFromAnalysis(output as unknown as Partial<Analysis>)), { source: "ANALYSIS", chatId: chat.id });
    } else if (work.eraTodo[0]) {
      // Every chapter read: condense the oldest ones into an era so the history fits a prompt.
      const g = work.eraTodo[0];
      const parts = g.map((x) => stored.find((u) => u.level === 0 && u.fromTs === x.fromTs)!.result as ChapterResult);
      const { output } = await generateText({
        model,
        prompt: buildEraPrompt({ ...who, chapters: g.map((x: Range, j) => ({ from: day(x.fromTs, chat.tzOffset), to: day(x.toTs, chat.tzOffset), phase: parts[j].phase, summary: parts[j].summary, conflicts: parts[j].conflicts.map((c) => `${c.when}: ${c.about}`) })) }),
        output: Output.object({ schema: eraSchema }),
        temperature: 0,
        seed: seedFor(`${chat.id}:era:${g[0].fromTs}`),
        maxRetries: 1,
      });
      await saveUnit(chat.id, { ...eraRange(g), level: 1, result: output }, key.model);
    } else {
      // History all read: the read itself.
      const read = await prepareRead(person.userId, person, chat, key, chat.readMode === "full");
      if ("refused" in read) {
        const { code, error } = read.refused!;
        if (code === "up_to_date") return (await cancelRead(chat.id), {});
        if (code === "hourly") return (await due(chat.id, new Date(Date.now() + 600_000)), { again: 600_000 });
        return (await fail(chat.id, error), {});
      }
      try {
        const { output } = await generateText({ model, ...read.call, output: Output.object({ schema: analysisSchema }), maxRetries: 1 });
        await read.finish(output);
      } catch (e) {
        // A failed attempt must not use up the hourly limit while the job retries.
        await db.analysis.delete({ where: { id: read.runId } }).catch(() => undefined);
        throw e;
      }
      await db.chatUpload.update({ where: { id: chat.id }, data: { readMode: null, readNextAt: null } });
      scheduleGraphJob(person.userId, person);
      return {};
    }
    await due(chat.id, new Date());
    return { again: 0 };
  } catch (e) {
    const limit = rateLimit(e);
    if (limit?.tooBigFor && key) {
      // One call is bigger than the key may send per minute: learn the smaller size and re-plan the parts.
      const smaller = Math.min(charsFor(limit.tooBigFor), Math.floor(budgetFor(key) * 0.7));
      if (smaller < MIN_BUDGET) return (await fail(chat.id, `Your key allows only ${limit.tooBigFor.toLocaleString("en")} tokens per minute, too little to read this chat. Pick a model or provider with a higher limit in Settings.`), {});
      await db.apiKey.update({ where: { id: key.id }, data: { charBudget: smaller } });
      await due(chat.id, new Date(Date.now() + limit.waitMs));
      return { again: limit.waitMs };
    }
    if (limit) {
      console.info("read job: rate limited", key?.provider, Math.round(limit.waitMs / 1000), "s");
      await due(chat.id, new Date(Date.now() + limit.waitMs));
      return { again: limit.waitMs };
    }
    console.error("read job: step failed", key?.provider, (e as Error)?.message);
    await fail(chat.id, providerError(e));
    return {};
  } finally {
    await releaseHistoryRun(chat.id);
  }
}

/** Where a chat's background read stands, for the page. */
export async function readStatus(chat: { id: string; cipher: string; tzOffset: number; readMode: string | null; readNextAt: Date | null; readError: string | null }, key: { provider: Parameters<typeof budgetFor>[0]["provider"]; budget?: number }) {
  const msgs = await loadChat(chat.cipher);
  const work = historyWork(msgs, await loadUnits(chat.id), budgetFor(key), chat.tzOffset);
  const left = work.todo.reduce((n, r) => n + inRange(msgs, r).reduce((c, m) => c + m.text.length + 30, 0), 0);
  return {
    total: work.plan.length + work.groups.length,
    todo: work.todo.length + work.eraTodo.length,
    chars: left,
    provider: key.provider,
    job: chat.readMode ? { mode: chat.readMode, nextAt: chat.readNextAt?.toISOString() ?? null } : null,
    failed: chat.readError,
  };
}
