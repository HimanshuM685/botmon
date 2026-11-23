import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { headers } from "next/headers";
import { generateText, Output } from "ai";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { alive } from "@/lib/trash";
import { chatMessages, getActiveKey, loadChat } from "@/lib/data";
import { budgetFor } from "@/lib/ai/models";
import { getModel, providerError } from "@/lib/ai/provider";
import { afterFailure, charsFor, retryable, type Tries } from "@/lib/ai/limits";
import { seedFor } from "@/lib/ai/stream";
import { buildChapterPrompt, buildEraPrompt, type RelationId } from "@/lib/ai/prompt";
import { analysisSchema, chapterSchema, eraSchema, type Analysis, type ChapterResult } from "@/lib/ai/schema";
import { eraRange, historyWork, type Range } from "@/lib/history";
import { claimHistoryRun, loadUnits, releaseHistoryRun, saveUnit } from "@/lib/history-store";
import { learnFromChat, selfChanged } from "@/lib/self/store";
import { factsFromAnalysis, newFacts } from "@/lib/facts";
import { loadGraph, pruneGraph, saveMemories } from "@/lib/graph-store";
import { rssMb, scheduleGraphJob } from "@/lib/graph/job";
import { toLocal } from "@/lib/stats";
import { prepareRead } from "./run";
import { embedEpisodes, memoryWork, readDetails, syncEpisodes } from "@/lib/memory/episodes";

/** Progress units of the detail pass: about one detail call's worth of sittings each. */
const SITTINGS_PER_PART = 6;
const memoryParts = (sittings: number) => Math.ceil(sittings / SITTINGS_PER_PART);
/**
 * readMode after the read itself is saved: the detail pass still running over the chat's sittings. Quiet: the page
 * shows the read as done, and a failure here only ends the pass (the next read picks it up again).
 */
export const MEMORY_MODE = "memory";
/** A read the page should show as running (not the quiet detail pass after it). */
export const reading = (mode: string | null) => !!mode && mode !== MEMORY_MODE;

/** The stored sittings still cover exactly the chat's messages (checked without loading the chat). */
async function episodesMatch(chat: { id: string; msgCount: number; firstAt: Date; lastAt: Date }) {
  const agg = await db.chatEpisode.aggregate({ where: { chatId: chat.id }, _sum: { msgCount: true }, _min: { fromTs: true }, _max: { toTs: true } });
  return agg._sum.msgCount === chat.msgCount && agg._min.fromTs?.getTime() === chat.firstAt.getTime() && agg._max.toTs?.getTime() === chat.lastAt.getTime();
}

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
 * Call the jobs route for the chat's next step after `delayMs` (only as long as this request may still run; the next
 * request waits the rest). The jobs route answers at once and runs the step after answering, so this waits for the
 * answer: the request has arrived, and the chain can't be lost to this function ending first.
 */
export async function chain(origin: string, chatId: string, delayMs = 0, startedAt = Date.now()) {
  await sleep(Math.max(0, Math.min(delayMs, STEP_MAX_MS - 30_000 - (Date.now() - startedAt))));
  const res = await fetch(`${appOrigin(origin)}/api/jobs/read`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jobToken(chatId)}` },
    body: JSON.stringify({ chatId }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: Error) => e);
  if (res instanceof Error || !res.ok) console.error("read job: chain broke", res instanceof Error ? res.message : res.status);
}

/** Queue the next step once this response is sent. */
export const kick = (origin: string, chatId: string) => after(() => chain(origin, chatId));

const newJob = () => randomUUID();

/**
 * Start (or redirect) the chat's background read. A read already set keeps going in the requested mode; one whose
 * chain broke is started again.
 */
export async function startRead(origin: string, chat: { id: string; readMode: string | null; readJob: string | null; readNextAt: Date | null; historyLockUntil: Date | null }, mode: "auto" | "full") {
  // A mode with no job id (set before jobs had ids) can never run a step: start it afresh. So does the quiet detail
  // pass: the read asked for must not wait out its backoff (it picks up again after this read).
  if (chat.readMode && chat.readJob && chat.readMode !== MEMORY_MODE) {
    if (chat.readMode !== mode) await db.chatUpload.updateMany({ where: { id: chat.id, readMode: { not: null } }, data: { readMode: mode } });
    return resumeIfStalled(origin, chat);
  }
  await db.chatUpload.update({ where: { id: chat.id }, data: { readMode: mode, readJob: newJob(), readNextAt: new Date(), readError: null, readTries: 0, readBadTries: 0, readRateTries: 0, readWait: null, readParts: null, readPartsDone: null } });
  kick(origin, chat.id);
}

/** Stop the read. A step still running finds its job gone and writes nothing more about it. */
export const cancelRead = (chatId: string) => db.chatUpload.update({ where: { id: chatId }, data: { readMode: null, readJob: null, readNextAt: null, readWait: null } });

/**
 * Where the job token is sent. Never taken from request headers when the deployment says its own URL: a forged
 * Host or X-Forwarded-Host would otherwise get the server to send a valid token anywhere. APP_URL overrides;
 * Netlify gives the production URL, or the branch URL on previews. Locally, the request's origin.
 */
export const appOrigin = (fallback: string) =>
  (process.env.APP_URL || (process.env.CONTEXT === "production" ? process.env.URL : process.env.DEPLOY_PRIME_URL) || fallback).replace(/\/$/, "");

/** This request's own origin, read before `after()` (which can't read headers in a page). */
export async function requestOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** A job is set but no step ran or is due: the chain broke. Start it again. */
export function resumeIfStalled(origin: string, chat: { id: string; readMode: string | null; readNextAt: Date | null; historyLockUntil: Date | null }, now = Date.now()) {
  const locked = chat.historyLockUntil && chat.historyLockUntil.getTime() > now;
  if (chat.readMode && !locked && (chat.readNextAt?.getTime() ?? 0) < now - STALLED_MS) kick(origin, chat.id);
}

/** Quick retries inside one step (the SDK waits 2, 4, 8s); longer outages are the job's backoff. */
const QUICK_RETRIES = 3;
/**
 * A step's model call, retries included, must end this long after the step started. The rest of STEP_MAX_MS is for
 * saving what it answered (memories, embeddings, the user's profile): a request cut off mid-save loses its lock and
 * the chain until someone opens the page. Timed out: retried, with smaller parts after the second time.
 */
const STEP_CALLS_MS = STEP_MAX_MS - 100_000;
/** Times in a row a read may find its history changed under it before it stops. */
const HISTORY_TRIES = 3;

/** Run one step of the chat's background read. `again`: ms until the next step; undefined when the chain stops here. */
export async function step(chatId: string): Promise<{ again?: number }> {
  const chat = await db.chatUpload.findFirst({ where: { id: chatId, ...alive } });
  if (!chat?.readMode || !chat.readJob) return {};
  const wait = (chat.readNextAt?.getTime() ?? 0) - Date.now();
  if (wait > 0) return { again: wait };
  if (!(await claimHistoryRun(chat.id, LOCK_MS))) return {}; // another step is running; it carries the chain

  // Every write about the job goes through here, and only lands while it is still this job (not stopped, not restarted).
  const job = chat.readJob;
  const mine = (data: Prisma.ChatUploadUpdateManyMutationInput) => db.chatUpload.updateMany({ where: { id: chat.id, readJob: job }, data });
  const fail = (error: string) => mine({ readMode: null, readJob: null, readNextAt: null, readWait: null, ...(chat.readMode === MEMORY_MODE ? {} : { readError: error }) });
  const due = (at: Date, readWait: string, tries?: Tries) => mine({ readNextAt: at, readWait, ...(tries ? { readTries: tries.busy, readBadTries: tries.bad, readRateTries: tries.rate ?? 0 } : {}) });

  const startedAt = Date.now();
  const secs = () => Math.round((Date.now() - startedAt) / 1000);
  // Started just before each model call, so loading a long chat doesn't eat the model's time.
  const callSignal = () => AbortSignal.timeout(Math.max(30_000, STEP_CALLS_MS - (Date.now() - startedAt)));
  let key: Awaited<ReturnType<typeof getActiveKey>> = null;
  const result = await (async (): Promise<{ again?: number }> => {
    try {
      const person = await db.person.findFirst({ where: { id: chat.personId, ...alive, user: alive } });
      if (!person) return (await mine({ readMode: null, readJob: null, readNextAt: null }), {});
      key = await getActiveKey(person.userId);
      if (!key) return (await fail("Add an AI key in Settings first"), {});
      const model = getModel(key.provider, key.apiKey, key.model);
      // Removed or moved to someone else while this step ran: the job ends, and nothing of it lands on this person.
      const stillHere = async () => !!(await db.chatUpload.findFirst({ where: { id: chat.id, personId: person.id, deletedAt: null, readJob: job }, select: { id: true } }));

      // Total recall (lib/memory): every sitting stored and read for details, after the read is saved (MEMORY_MODE), so
      // the read never waits on it or fails with it. Only the sync step needs the whole chat; detail steps load just
      // the sittings they read.
      const memory = await memoryWork(chat.id, key);
      const synced = await episodesMatch(chat);
      // Meaning vectors ride along with each step, best effort, and never hold the read up: a free Gemini key embeds
      // ~1,000 texts a day, weeks for a 5-lakh chat. Recall uses the vectors there are and words for the rest; what
      // is left is embedded by the next read.
      const embedSome = async () => {
        if (!memory.embedLeft || secs() > 150) return;
        await embedEpisodes(chat.id, key!).catch((e) => console.info("read job: embedding later", (e as Error)?.message?.slice(0, 160)));
      };
      const memoryStep = async (what: string, run: () => Promise<unknown>) => {
        await run();
        await embedSome();
        const now = await memoryWork(chat.id, key!);
        const parts = memoryParts(now.total);
        const done = parts - memoryParts(now.detailsLeft);
        console.info(`read job: ${what}, ${now.total - now.detailsLeft}/${now.total} sittings read in ${secs()}s`, key!.provider);
        await mine({ readNextAt: new Date(), readWait: null, readTries: 0, readBadTries: 0, readRateTries: 0, readParts: parts, readPartsDone: done });
        return { again: 0 };
      };
      /** The read is done: the detail pass next if it has work, else the job ends. */
      const afterRead = async (data: Prisma.ChatUploadUpdateManyMutationInput) => {
        const more = !synced || memory.detailsLeft > 0;
        const { count } = await mine(more ? { ...data, readMode: MEMORY_MODE, readNextAt: new Date(), readWait: null } : { ...data, readMode: null, readJob: null, readNextAt: null, readWait: null });
        return { count, next: more && count ? { again: 0 } : {} };
      };
      if (chat.readMode === MEMORY_MODE) {
        if (!synced) return await memoryStep("sittings stored", () => loadChat(chat.cipher).then((all) => syncEpisodes(chat, all)));
        if (memory.detailsLeft)
          return await memoryStep("details read", () => readDetails(person, chat, key!, { signal: callSignal(), temperature: chat.readBadTries > 0 ? 0.3 : 0, stillHere }));
        await embedSome();
        const { count } = await mine({ readMode: null, readJob: null, readNextAt: null, readWait: null, readTries: 0, readBadTries: 0, readRateTries: 0 });
        // What the detail pass saved gets its graph work too.
        if (count) scheduleGraphJob(person.userId, person);
        return {};
      }

      const msgs = await loadChat(chat.cipher);
      const budget = budgetFor(key);
      const stored = await loadUnits(chat.id);
      const work = historyWork(msgs, stored, budget, chat.tzOffset);
      // After an unreadable answer, greedy sampling would give the same one again: loosen it a little.
      const retrying = chat.readBadTries > 0;
      const sampling = (seed: string) => ({ temperature: retrying ? 0.3 : 0, seed: seedFor(retrying ? `${seed}:${chat.readBadTries}` : seed), maxRetries: QUICK_RETRIES, abortSignal: callSignal() });
      const who = { personName: person.name, relation: person.relation as RelationId, gender: person.gender, myName: chat.myName, theirName: chat.theirName };
      // Rows from an older shape of this chat (older messages filled in mid-chat): read again.
      if (work.stale.length) await db.chatChapter.deleteMany({ where: { chatId: chat.id, id: { in: work.stale.map((u) => u.id) } } });
      const parts = work.plan.length + work.groups.length;

      const r = work.todo[0];
      if (r) {
        // One chapter: oldest unread first.
        const prev = stored.filter((u) => u.level === 0 && u.toTs < r.fromTs).at(-1)?.result as ChapterResult | undefined;
        const facts = await db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true } });
        const graph = await loadGraph(person, facts.filter((f) => !f.deletedAt));
        const { output } = await generateText({
          model,
          prompt: buildChapterPrompt({ ...who, tzOffsetMin: chat.tzOffset, msgs: inRange(msgs, r), part: work.plan.indexOf(r) + 1, parts: work.plan.length, before: prev, known: graph.known() }),
          output: Output.object({ schema: chapterSchema }),
          ...sampling(`${chat.id}:${r.fromTs}`),
        });
        if (!(await stillHere())) return {};
        // Memories first, then the chapter: if saving stops in between, the chapter is read again and its memories
        // (kept once by their text) aren't lost. Deleted memories count as known, so they don't come back.
        await saveMemories(person, newFacts(facts.map((f) => f.text), factsFromAnalysis(output as unknown as Partial<Analysis>)), { source: "ANALYSIS", chatId: chat.id });
        const unit = await saveUnit(chat.id, { ...r, level: 0, result: output }, key.model);
        // What this period showed about the user, proven by their own lines in it.
        await learnFromChat(person.userId, person, chat, inRange(msgs, r), output.aboutUser, "CHAPTER", { chapterId: unit.id });
      } else if (work.eraTodo[0]) {
        // Every chapter read: condense the oldest ones into an era so the history fits a prompt.
        const g = work.eraTodo[0];
        const chapters = g.map((x) => stored.find((u) => u.level === 0 && u.fromTs === x.fromTs && u.toTs === x.toTs)!.result as ChapterResult);
        const { output } = await generateText({
          model,
          prompt: buildEraPrompt({ ...who, chapters: g.map((x: Range, j) => ({ from: day(x.fromTs, chat.tzOffset), to: day(x.toTs, chat.tzOffset), phase: chapters[j].phase, summary: chapters[j].summary, conflicts: chapters[j].conflicts.map((c) => `${c.when}: ${c.about}`) })) }),
          output: Output.object({ schema: eraSchema }),
          ...sampling(`${chat.id}:era:${g[0].fromTs}`),
        });
        if (!(await stillHere())) return {};
        await saveUnit(chat.id, { ...eraRange(g), level: 1, result: output }, key.model);
      } else {
        // History all read: the read itself.
        const read = await prepareRead(person.userId, person, chat, key, chat.readMode === "full", msgs);
        if ("refused" in read) {
          const { code, error } = read.refused!;
          if (code === "up_to_date") return (await afterRead({})).next;
          if (code === "hourly") return (await due(new Date(Date.now() + 600_000), "hourly"), { again: 600_000 });
          // The history changed under this step (a new export merged in): plan it again next step.
          if (code === "history_needed") {
            // Counted, so a history that never settles can't chain steps back to back forever.
            if (chat.readTries + 1 > HISTORY_TRIES) return (await fail("This chat's history couldn't be planned. Start the read again."), {});
            return (await due(new Date(Date.now() + 5_000), "history", { busy: chat.readTries + 1, bad: chat.readBadTries, rate: chat.readRateTries }), { again: 5_000 });
          }
          return (await fail(error), {});
        }
        // sampling(chat.id) keeps read.call's seed (seedFor(chat.id)) until an unreadable answer loosens it.
        let output: Analysis;
        try {
          output = (await generateText({ model, ...read.call, ...sampling(chat.id), output: Output.object({ schema: analysisSchema }) })).output;
        } catch (e) {
          // A failed attempt must not use up the hourly limit while the job retries.
          await db.analysis.delete({ where: { id: read.runId } }).catch(() => undefined);
          throw e;
        }
        try {
          await read.finish(output);
        } catch (e) {
          // Saving stopped halfway: take back what this run saved, so the retry starts clean instead of saving it twice.
          // Erased, not trashed, as when a chat leaves mid-read (lib/read/run.ts).
          await db.$transaction([
            db.personFact.deleteMany({ where: { personId: person.id, source: "ANALYSIS", analysisId: read.runId } }),
            db.selfEvidence.deleteMany({ where: { personId: person.id, analysisId: read.runId } }),
            db.analysis.deleteMany({ where: { id: read.runId } }),
          ]).catch((x) => console.error("read job: clean-up after a failed save failed", (x as Error)?.message));
          await pruneGraph(person.id).catch(() => undefined);
          await selfChanged(person.userId).catch(() => undefined);
          throw e;
        }
        const { count, next } = await afterRead({ readTries: 0, readBadTries: 0, readRateTries: 0, readPartsDone: parts });
        // The read is saved either way, so its memories get their graph work even if the job was stopped meanwhile.
        scheduleGraphJob(person.userId, person);
        if (count) console.info(`read job: read saved in ${secs()}s (rss ${rssMb()}MB)`, key.provider, key.model);
        return next;
      }
      await embedSome();
      // A step done: failures start counting again, and the page sees the progress (one more part read).
      const done = parts - work.todo.length - work.eraTodo.length + 1;
      console.info(`read job: ${r ? "chapter" : "era"} done, part ${done}/${parts} in ${secs()}s (rss ${rssMb()}MB)`, key.provider, key.model);
      await mine({ readNextAt: new Date(), readWait: null, readTries: 0, readBadTries: 0, readRateTries: 0, readParts: parts, readPartsDone: done });
      return { again: 0 };
    } catch (e) {
      const failure = retryable(e);
      if (failure?.tooBigFor && key) {
        // One call is bigger than the key may send per minute: learn the smaller size (parts already read are kept).
        const smaller = Math.min(charsFor(failure.tooBigFor), Math.floor(budgetFor(key) * 0.7));
        if (smaller < MIN_BUDGET) return (await fail(`Your key allows only ${failure.tooBigFor.toLocaleString("en")} tokens per minute, too little to read this chat. Pick a model or provider with a higher limit in Settings.`), {});
        await db.apiKey.update({ where: { id: key.id }, data: { charBudget: smaller } });
        await due(new Date(Date.now() + failure.waitMs), "rate");
        return { again: failure.waitMs };
      }
      // Timed out twice in a row: the calls are too big for this model's speed. Smaller parts from here on (one slow
      // answer alone may just be a busy moment, and parts already read are kept either way).
      if (failure?.kind === "slow" && key && chat.readWait === "slow" && Math.floor(budgetFor(key) * 0.7) >= MIN_BUDGET)
        await db.apiKey.update({ where: { id: key.id }, data: { charBudget: Math.floor(budgetFor(key) * 0.7) } });
      const next = failure && afterFailure(failure, { busy: chat.readTries, bad: chat.readBadTries, rate: chat.readRateTries });
      if (next && "waitMs" in next) {
        console.info(`read job: ${failure!.kind}, waiting ${Math.round(next.waitMs / 1000)}s`, next.tries, key?.provider, key?.model, (e as Error)?.message?.slice(0, 160));
        await due(new Date(Date.now() + next.waitMs), next.reason, next.tries);
        return { again: next.waitMs };
      }
      console.error("read job: step failed", key?.provider, key?.model, (e as Error)?.message);
      await fail(next?.fail ?? providerError(e));
      return {};
    } finally {
      await releaseHistoryRun(chat.id);
    }
  })();
  // Stopped and started again while this step ran: the new job's first step found this one holding the lock and
  // stopped, so this one carries the new job's chain on.
  if (result.again === undefined) {
    const now = await db.chatUpload.findFirst({ where: { id: chat.id }, select: { readMode: true, readJob: true } });
    if (now?.readMode && now.readJob && now.readJob !== job) return { again: 0 };
  }
  return result;
}

/** Where a chat's background read stands, for the page. */
export async function readStatus(chat: { id: string; tzOffset: number } & JobRow, key: { provider: Parameters<typeof budgetFor>[0]["provider"]; budget?: number }) {
  const msgs = await chatMessages(chat.id);
  const work = historyWork(msgs, await loadUnits(chat.id), budgetFor(key), chat.tzOffset);
  const left = work.todo.reduce((n, r) => n + inRange(msgs, r).reduce((c, m) => c + m.text.length + 30, 0), 0);
  return {
    total: work.plan.length + work.groups.length,
    todo: work.todo.length + work.eraTodo.length,
    chars: left,
    provider: key.provider,
    ...jobStatus(chat),
  };
}

/** The columns jobStatus and resumeIfStalled need: what the page's poll loads. */
export const JOB_FIELDS = { id: true, historyLockUntil: true, readMode: true, readJob: true, readNextAt: true, readWait: true, readError: true, readTries: true, readBadTries: true, readParts: true, readPartsDone: true } as const;

type JobRow = { readMode: string | null; readNextAt: Date | null; readWait: string | null; readError: string | null; readTries: number; readBadTries: number; readParts: number | null; readPartsDone: number | null };

/** The background read as the page shows it: progress, any wait and why, or why it stopped. */
export const jobStatus = (chat: JobRow) => ({
  job: reading(chat.readMode)
    ? { mode: chat.readMode, nextAt: chat.readNextAt?.toISOString() ?? null, wait: chat.readWait, tries: chat.readTries + chat.readBadTries, parts: chat.readParts, done: chat.readPartsDone }
    : null,
  failed: chat.readError,
});
