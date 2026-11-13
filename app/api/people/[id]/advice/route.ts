import { Output, streamText } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { alive } from "@/lib/trash";
import { currentContextHash, getActiveKey, getChat, getChatStats, getPerson, loadChat } from "@/lib/data";
import { Prisma } from "@/generated/prisma/client";
import { adviceSchema, type Analysis } from "@/lib/ai/schema";
import { buildAdvicePrompt, SYSTEM, type RelationId } from "@/lib/ai/prompt";
import { getModel } from "@/lib/ai/provider";
import { seedFor, streamResponse } from "@/lib/ai/stream";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { FACTS_SHARE, factsWithinBudget } from "@/lib/facts";
import { adviceStale } from "@/lib/context";

export const maxDuration = 120;

/**
 * Rewrite only the advice part of the latest read for the current notes, timeline and date.
 * No chat re-read. Answers 204 when the advice already matches the current context, so calling it is always safe.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const [key, chat, read, hash] = await Promise.all([
    getActiveKey(userId),
    getChat(person.id),
    db.analysis.findFirst({ where: { personId: person.id, ...alive, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" } }),
    currentContextHash(person),
  ]);
  if (!read || !chat) return Response.json({ error: "Run a read first" }, { status: 400 });
  if (!adviceStale(read, hash)) return new Response(null, { status: 204 });
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });

  const [msgs, facts, stats] = await Promise.all([
    loadChat(chat.cipher),
    db.personFact.findMany({ where: { personId: person.id, ...alive }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { kind: true, text: true, happenedAt: true } }),
    getChatStats(chat),
  ]);
  const saved = read.result as unknown as Analysis;
  const prompt = buildAdvicePrompt({
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    notes: person.notes,
    myName: chat.myName,
    theirName: chat.theirName,
    stats,
    tzOffsetMin: chat.tzOffset,
    facts: factsWithinBudget(facts, Math.floor(CHAR_BUDGET[key.provider] * FACTS_SHARE)).facts,
    read: saved,
    msgs,
  });

  const result = streamText({
    model: getModel(key.provider, key.apiKey, key.model),
    system: SYSTEM,
    prompt,
    output: Output.object({ schema: adviceSchema }),
    // Same context, same advice.
    temperature: 0,
    seed: seedFor(read.id + hash),
    maxRetries: 1,
  });

  return streamResponse(result.stream, {
    label: `advice ${key.provider} ${key.model}`,
    onDone: async () => {
      const advice = await result.output;
      // `hash` is the context this advice was written for: if the context changed mid-run,
      // the next page view sees a mismatch and refreshes again.
      await db.analysis.update({ where: { id: read.id }, data: { result: { ...saved, ...advice }, contextHash: hash, adviceAt: new Date() } });
    },
  });
}
