import { generateText, Output } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getActiveKey, getChat, getPerson, loadChat } from "@/lib/data";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { getModel, providerError } from "@/lib/ai/provider";
import { seedFor } from "@/lib/ai/stream";
import { buildChapterPrompt, buildEraPrompt, type RelationId } from "@/lib/ai/prompt";
import { chapterSchema, eraSchema, type Analysis, type ChapterResult } from "@/lib/ai/schema";
import { eraRange, historyWork, type Range } from "@/lib/history";
import { claimHistoryRun, loadUnits, releaseHistoryRun, saveUnit } from "@/lib/history-store";
import { learnFromChat } from "@/lib/self/store";
import { factsFromAnalysis, newFacts } from "@/lib/facts";
import { loadGraph, saveMemories } from "@/lib/graph-store";
import { toLocal } from "@/lib/stats";

export const maxDuration = 300;
/**
 * One chapter (or era) per request: each request stays about as long as one model call, well inside any host's
 * function time limit, and a cut-off request loses at most that one. The client calls until `todo` is 0.
 */
const LOCK_MS = 120_000;

const day = (ts: number, tz: number) => toLocal(ts, tz).toISOString().slice(0, 10);

/** Where the current chat's history stands: parts in all, parts still to read, and the size of what is left. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await load((await params).id);
  if ("error" in ctx) return ctx.error;
  const { work, msgs } = ctx;
  const left = work.todo.reduce((n, r) => n + msgs.filter((m) => m.ts >= r.fromTs && m.ts <= r.toTs).reduce((c, m) => c + m.text.length + 30, 0), 0);
  return Response.json({ total: work.plan.length + work.groups.length, todo: work.todo.length + work.eraTodo.length, chars: left, provider: ctx.key.provider });
}

/** Read the next chapter (or, once all are read, the next era) of the person's current chat, and save it. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await load((await params).id);
  if ("error" in ctx) return ctx.error;
  const { userId, person, chat, key, msgs } = ctx;
  if (!(await claimHistoryRun(chat.id, LOCK_MS))) return Response.json({ busy: true, retryAfter: 10 });
  const model = getModel(key.provider, key.apiKey, key.model);
  const who = { personName: person.name, relation: person.relation as RelationId, gender: person.gender, myName: chat.myName, theirName: chat.theirName };
  try {
    let work = ctx.work;
    // Rows from an older shape of this chat (a gap filled mid-chat moves later chapters): read again.
    if (work.stale.length) await db.chatChapter.deleteMany({ where: { chatId: chat.id, id: { in: work.stale.map((u) => u.id) } } });
    const known = new Set((await db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, select: { text: true } })).map((f) => f.text));
    const total = work.plan.length + work.groups.length;

    for (const r of work.todo.slice(0, 1)) {
      const i = work.plan.indexOf(r);
      const prev = (await loadUnits(chat.id)).filter((u) => u.level === 0 && u.toTs < r.fromTs).at(-1)?.result as ChapterResult | undefined;
      const facts = await db.personFact.findMany({ where: { personId: person.id, deletedAt: null }, select: { id: true, kind: true, text: true, happenedAt: true } });
      const graph = await loadGraph(person, facts);
      const { output } = await generateText({
        model,
        prompt: buildChapterPrompt({ ...who, tzOffsetMin: chat.tzOffset, msgs: inRange(msgs, r), part: i + 1, parts: work.plan.length, before: prev, known: graph.known() }),
        output: Output.object({ schema: chapterSchema }),
        temperature: 0,
        seed: seedFor(`${chat.id}:${r.fromTs}`),
        maxRetries: 1,
      });
      // Removed or moved while this was being read: its memories must not land on this person.
      if (!(await db.chatUpload.findFirst({ where: { id: chat.id, personId: person.id, deletedAt: null }, select: { id: true } }))) return Response.json({ total, todo: 0, gone: true });
      const unit = await saveUnit(chat.id, { ...r, level: 0, result: output }, key.model);
      // What this period showed about the user, proven by their own lines in it.
      await learnFromChat(userId, person, chat, inRange(msgs, r), output.aboutUser, "CHAPTER", { chapterId: unit.id });
      // What this period taught goes to the timeline like any read's memories, marked with its chat.
      const fresh = newFacts([...known], factsFromAnalysis(output as unknown as Partial<Analysis>));
      await saveMemories(person, fresh, { source: "ANALYSIS", chatId: chat.id });
      for (const f of fresh) known.add(f.text);
    }

    work = historyWork(msgs, await loadUnits(chat.id), CHAR_BUDGET[key.provider], chat.tzOffset);
    if (!work.todo.length && ctx.work.todo.length === 0) {
      const units = await loadUnits(chat.id);
      for (const g of work.eraTodo.slice(0, 1)) {
        const parts = g.map((r) => units.find((u) => u.level === 0 && u.fromTs === r.fromTs)!.result as ChapterResult);
        const { output } = await generateText({
          model,
          prompt: buildEraPrompt({ ...who, chapters: g.map((r: Range, j) => ({ from: day(r.fromTs, chat.tzOffset), to: day(r.toTs, chat.tzOffset), phase: parts[j].phase, summary: parts[j].summary, conflicts: parts[j].conflicts.map((c) => `${c.when}: ${c.about}`) })) }),
          output: Output.object({ schema: eraSchema }),
          temperature: 0,
          seed: seedFor(`${chat.id}:era:${g[0].fromTs}`),
          maxRetries: 1,
        });
        await saveUnit(chat.id, { ...eraRange(g), level: 1, result: output }, key.model);
      }
      work = historyWork(msgs, await loadUnits(chat.id), CHAR_BUDGET[key.provider], chat.tzOffset);
      // Eras regrouped as the chat grew: the old ones are no longer shown.
      const old = work.stale.filter((u) => u.level > 0);
      if (old.length) await db.chatChapter.deleteMany({ where: { chatId: chat.id, id: { in: old.map((u) => u.id) } } });
    }
    const next = work.todo[0];
    return Response.json({
      total, todo: work.todo.length + work.eraTodo.length,
      next: next ? `${day(next.fromTs, chat.tzOffset)} to ${day(next.toTs, chat.tzOffset)}` : null,
    });
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    const limited = status === 429 || /quota|rate limit|resource.?exhausted/i.test(String((e as Error)?.message));
    // What was read so far is saved; the client waits and continues.
    if (limited) return Response.json({ retryAfter: 60, error: providerError(e) });
    return Response.json({ error: providerError(e) }, { status: 502 });
  } finally {
    await releaseHistoryRun(chat.id);
  }
}

const inRange = (msgs: { ts: number }[], r: Range) => msgs.filter((m) => m.ts >= r.fromTs && m.ts <= r.toTs) as Parameters<typeof buildChapterPrompt>[0]["msgs"];

async function load(personId: string) {
  const userId = await getUserId();
  if (!userId) return { error: Response.json({ error: "Not signed in" }, { status: 401 }) };
  const person = await getPerson(userId, personId);
  if (!person) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  const [key, chat] = await Promise.all([getActiveKey(userId), getChat(person.id)]);
  if (!key) return { error: Response.json({ error: "Add an AI key in Settings first" }, { status: 400 }) };
  if (!chat) return { error: Response.json({ error: "Upload a chat first" }, { status: 400 }) };
  const msgs = await loadChat(chat.cipher);
  const work = historyWork(msgs, await loadUnits(chat.id), CHAR_BUDGET[key.provider], chat.tzOffset);
  return { userId, person, chat, key, msgs, work };
}
