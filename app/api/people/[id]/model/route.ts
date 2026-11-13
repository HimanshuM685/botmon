import { Output, streamText } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { alive } from "@/lib/trash";
import { getActiveKey, getChat, getChatStats, getPerson, loadChat } from "@/lib/data";
import { Prisma } from "@/generated/prisma/client";
import { analysisSchema, modelPatchSchema, type Analysis } from "@/lib/ai/schema";
import { buildMemoryReadPrompt, buildModelPatchPrompt, SYSTEM, type RelationId } from "@/lib/ai/prompt";
import { getModel } from "@/lib/ai/provider";
import { seedFor, streamResponse } from "@/lib/ai/stream";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { FACTS_SHARE, factsWithinBudget } from "@/lib/facts";
import { adviceStale, contextHash } from "@/lib/context";
import { applyPatch, changedSince, enoughMemory } from "@/lib/model";
import { computeScore } from "@/lib/stats";

export const maxDuration = 300;
const HOURLY_LIMIT = 10; // first reads built from memory share the read limit

/**
 * Bring the person's living read up to date with what is known now. Never re-reads the chat.
 * - A read exists: patch it (advice always; status, signals, mind and mood only if the new information moves them).
 * - No read yet: build the first one from memory and notes alone, once enough has been told.
 * Answers 204 when there is nothing to do, so every surface can call it after any change.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const [key, chat, read, allFacts] = await Promise.all([
    getActiveKey(userId),
    getChat(person.id),
    db.analysis.findFirst({ where: { personId: person.id, ...alive, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" } }),
    db.personFact.findMany({
      where: { personId: person.id, deletedAt: undefined }, // trashed ones too: "no longer true" is information
      orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, kind: true, text: true, happenedAt: true, updatedAt: true, deletedAt: true, entities: true },
    }),
  ]);
  const facts = allFacts.filter((f) => !f.deletedAt);
  const hash = contextHash(person, facts);
  if (read ? !adviceStale(read, hash) : !enoughMemory(facts.length, person.notes)) return new Response(null, { status: 204 });
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });

  // What the read has not absorbed yet; memory connected to it is kept first if the timeline is over budget.
  const { added, removed } = changedSince(allFacts, read?.adviceAt ?? null);
  const base = {
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    notes: person.notes,
    myName: chat?.myName,
    theirName: chat?.theirName,
    stats: chat ? await getChatStats(chat) : null,
    tzOffsetMin: chat?.tzOffset ?? 0,
    facts: factsWithinBudget(facts, Math.floor(CHAR_BUDGET[key.provider] * FACTS_SHARE), added.flatMap((f) => f.entities)).facts,
  };
  const model = getModel(key.provider, key.apiKey, key.model);
  // Same input, same answer. `hash` is the context this result is written for: if it changes mid-run,
  // the stored hash no longer matches and the next call updates again.
  const sampling = { temperature: 0, seed: seedFor(person.id + hash), maxRetries: 1 } as const;

  if (!read) {
    // Another surface may already be building it (the coach and the read page both call this).
    const running = await db.analysis.findFirst({ where: { personId: person.id, mode: "memory", result: { equals: Prisma.DbNull }, createdAt: { gt: new Date(Date.now() - 120_000) } } });
    if (running) return new Response(null, { status: 204 });
    const run = await db.analysis.create({ data: { personId: person.id, provider: key.provider, model: key.model, mode: "memory" } });
    const recent = await db.analysis.count({ where: { person: { userId }, deletedAt: undefined, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent > HOURLY_LIMIT) {
      await db.analysis.delete({ where: { id: run.id } });
      return Response.json({ error: "Hourly limit reached. Try again later." }, { status: 429 });
    }
    const result = streamText({ model, system: SYSTEM, prompt: buildMemoryReadPrompt(base), output: Output.object({ schema: analysisSchema }), ...sampling });
    return streamResponse(result.stream, {
      label: `model create ${key.provider} ${key.model}`,
      headers: { "x-model-mode": "create" },
      onDone: async () => {
        const generated = await result.output;
        const output: Analysis = { ...generated, status: { ...generated.status, score: computeScore(generated.signals, null) } };
        await db.analysis.update({ where: { id: run.id }, data: { result: output, contextHash: hash, adviceAt: new Date() } });
      },
    });
  }

  const saved = read.result as unknown as Analysis;
  const result = streamText({
    model,
    system: SYSTEM,
    prompt: buildModelPatchPrompt({ ...base, read: saved, msgs: chat ? await loadChat(chat.cipher) : [], added, removed }),
    output: Output.object({ schema: modelPatchSchema }),
    ...sampling,
  });
  return streamResponse(result.stream, {
    label: `model update ${key.provider} ${key.model}`,
    headers: { "x-model-mode": "patch" },
    onDone: async () => {
      const merged = applyPatch(saved, await result.output, base.stats);
      await db.analysis.update({ where: { id: read.id }, data: { result: merged, contextHash: hash, adviceAt: new Date() } });
    },
  });
}
