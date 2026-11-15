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
import { emotionMap, FACTS_SHARE, factsWithinBudget } from "@/lib/facts";
import { adviceStale, contextHash } from "@/lib/context";
import { applyPatch, changedSince, enoughMemory } from "@/lib/model";
import { computeScore } from "@/lib/stats";
import { applyVoice, voiceForPrompt, voiceProfile } from "@/lib/voice";
import { claimModelRun, releaseModelRun } from "@/lib/model-lock";
import { loadGraph } from "@/lib/graph-store";

export const maxDuration = 300;
const HOURLY_LIMIT = 10; // first reads built from memory share the read limit

/**
 * Bring the person's living read up to date with what is known now. Never re-reads the chat.
 * - A read exists: patch it (advice always; status, signals, mind and mood only if the new information moves them).
 * - No read yet: build the first one from memory and notes alone, once enough has been told.
 * Answers 204 when there is nothing to do, so every surface can call it after any change.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  // Everything up to now is what this run reads; memories changed while it runs count as new next time.
  const startedAt = new Date();
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
      select: { id: true, kind: true, text: true, happenedAt: true, updatedAt: true, deletedAt: true, entities: true, feeling: true, valence: true },
    }),
  ]);
  const facts = allFacts.filter((f) => !f.deletedAt);
  const hash = contextHash(person, facts);
  // A first read from memory alone is only for people without a chat; with a chat, the real read comes from Analyze.
  if (read ? !adviceStale(read, hash) : chat || !enoughMemory(facts.length, person.notes)) return new Response(null, { status: 204 });
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });

  // One update per person at a time (the coach, timeline and read page all call this), with an hourly cap.
  const claim = await claimModelRun(person.id, startedAt);
  if (claim === "busy") return new Response(null, { status: 204 });
  if (claim === "capped") return Response.json({ error: "This read has been updated a lot this hour. It will catch up later." }, { status: 429 });
  const release = () => releaseModelRun(person.id);

  // What the read has not absorbed yet; memory connected to it is kept first if the timeline is over budget.
  const { added, removed } = changedSince(allFacts, read?.adviceAt ?? null);
  const msgs = chat ? await loadChat(chat.cipher) : [];
  const voice = chat ? voiceProfile(msgs, chat.myName) : null;
  const emotion = emotionMap(facts); // shares the memory budget below
  const graph = await loadGraph(person, facts);
  // The graph around what changed, plus what the links show overall.
  const graphBrief = graph.brief(added.flatMap((f) => f.entities).flatMap((k) => graph.resolve(k)?.id ?? [])).slice(0, 8_000);
  const known = graph.known();
  // Memory, emotion map, graph and names share one slice of the prompt.
  const memoryBudget = Math.max(2_000, Math.floor(CHAR_BUDGET[key.provider] * FACTS_SHARE) - emotion.length - graphBrief.length - known.join(", ").length);
  const base = {
    voice: voice ? voiceForPrompt(voice) : undefined,
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    notes: person.notes,
    myName: chat?.myName,
    theirName: chat?.theirName,
    stats: chat ? await getChatStats(chat) : null,
    tzOffsetMin: chat?.tzOffset ?? 0,
    facts: factsWithinBudget(facts, memoryBudget, added.flatMap((f) => f.entities)).facts,
    emotion,
    graph: graphBrief,
    known,
  };
  const model = getModel(key.provider, key.apiKey, key.model);
  // Same input, same answer. `hash` is the context this result is written for: if it changes mid-run,
  // the stored hash no longer matches and the next call updates again.
  const sampling = { temperature: 0, seed: seedFor(person.id + hash), maxRetries: 1 } as const;

  if (!read) {
    const run = await db.analysis.create({ data: { personId: person.id, provider: key.provider, model: key.model, mode: "memory" } });
    const recent = await db.analysis.count({ where: { person: { userId }, deletedAt: undefined, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    // A failed run leaves nothing behind: no null-result row, no held lock.
    const discard = () => Promise.all([db.analysis.delete({ where: { id: run.id } }).catch(() => undefined), release()]);
    if (recent > HOURLY_LIMIT) {
      await discard();
      return Response.json({ error: "Hourly limit reached. Try again later." }, { status: 429 });
    }
    const result = streamText({ model, system: SYSTEM, prompt: buildMemoryReadPrompt(base), output: Output.object({ schema: analysisSchema }), ...sampling });
    const res = await streamResponse(result.stream, {
      label: `model create ${key.provider} ${key.model}`,
      headers: { "x-model-mode": "create" },
      onDone: async () => {
        try {
          const generated = await result.output;
          const output: Analysis = { ...generated, status: { ...generated.status, score: computeScore(generated.signals, null) } };
          await db.analysis.update({ where: { id: run.id }, data: { result: output, contextHash: hash, adviceAt: startedAt } });
          await release();
        } catch (e) {
          await discard();
          throw e;
        }
      },
    });
    if (!res.ok) await discard();
    return res;
  }

  const saved = read.result as unknown as Analysis;
  const result = streamText({
    model,
    system: SYSTEM,
    prompt: buildModelPatchPrompt({ ...base, read: saved, msgs, added, removed }),
    output: Output.object({ schema: modelPatchSchema }),
    ...sampling,
  });
  const res = await streamResponse(result.stream, {
    label: `model update ${key.provider} ${key.model}`,
    headers: { "x-model-mode": "patch" },
    onDone: async () => {
      try {
        const patched = applyPatch(saved, await result.output, base.stats);
        // Held to the user's own typing habits, whatever the model did.
        const merged: Analysis = { ...patched, messageSuggestions: patched.messageSuggestions.map((m) => applyVoice(m, voice)), voiceFrom: voice?.count ?? patched.voiceFrom };
        await db.analysis.update({ where: { id: read.id }, data: { result: merged, contextHash: hash, adviceAt: startedAt } });
      } finally {
        await release();
      }
    },
  });
  if (!res.ok) await release();
  return res;
}
