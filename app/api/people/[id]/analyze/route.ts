import { Output, streamText } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { currentContextHash, getActiveKey, getChat, getChatStats, getPerson, loadChat } from "@/lib/data";
import { analysisSchema, type Analysis } from "@/lib/ai/schema";
import { Prisma } from "@/generated/prisma/client";
import { buildPrompt, SYSTEM, type RelationId } from "@/lib/ai/prompt";
import { getModel } from "@/lib/ai/provider";
import { seedFor, streamResponse } from "@/lib/ai/stream";
import { FACTS_SHARE, factsFromAnalysis, factsWithinBudget, newFacts, normalizeFact } from "@/lib/facts";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { computeScore } from "@/lib/stats";
import { applyVoice, voiceForPrompt, voiceProfile } from "@/lib/voice";

export const maxDuration = 300;
const HOURLY_LIMIT = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const [key, chat] = await Promise.all([
    getActiveKey(userId),
    getChat(person.id),
  ]);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });
  if (!chat) return Response.json({ error: "Upload a chat first" }, { status: 400 });

  // Incremental by default: reuse the last read of this chat and send only messages after it.
  const full = ((await req.json().catch(() => null)) as { mode?: string } | null)?.mode === "full";
  // Latest read of this chat: the base for an incremental read, or a stability anchor for a full re-read.
  const last = await db.analysis.findFirst({
    where: { personId: person.id, chatId: chat.id, deletedAt: null, result: { not: Prisma.DbNull }, throughAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const prev = full ? null : last;
  // First read of this chat: a read built earlier from memory (or of a replaced chat) is the prior to stay consistent with.
  const prior = last ?? (await db.analysis.findFirst({ where: { personId: person.id, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" } }));
  if (prev && chat.lastAt <= prev.throughAt!)
    return Response.json({ error: "Already up to date with this chat. Add a newer export, or run a full re-read." }, { status: 409 });
  const mode = prev ? "incremental" : "full";

  // Record the attempt first, then count: concurrent requests all see each other's rows,
  // and failed or aborted runs still count toward the limit.
  const run = await db.analysis.create({
    data: { personId: person.id, provider: key.provider, model: key.model, chatId: chat.id, throughAt: chat.lastAt, mode },
  });
  const recent = await db.analysis.count({ where: { person: { userId }, deletedAt: undefined, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent > HOURLY_LIMIT) {
    await db.analysis.delete({ where: { id: run.id } });
    return Response.json({ error: "Hourly limit reached. Try again later." }, { status: 429 });
  }

  const [msgs, allFacts] = await Promise.all([
    loadChat(chat.cipher),
    db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true, entities: true, createdAt: true, updatedAt: true } }),
  ]);
  const facts = allFacts.filter((f) => !f.deletedAt);
  // Everything shares one budget: timeline (capped), previous read, then as much chat as still fits.
  const total = CHAR_BUDGET[key.provider];
  const memory = factsWithinBudget(facts, Math.floor(total * FACTS_SHARE));
  const chatBudget = Math.max(5_000, total - memory.chars - (prev ?? prior ? JSON.stringify((prev ?? prior)!.result).length : 0));
  const stats = await getChatStats(chat);
  const voice = voiceProfile(msgs, chat.myName);
  const prompt = buildPrompt({
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    notes: person.notes,
    myName: chat.myName,
    theirName: chat.theirName,
    stats,
    tzOffsetMin: chat.tzOffset,
    msgs,
    budget: chatBudget,
    previous: prev ? { result: prev.result as unknown as Analysis, throughAt: prev.throughAt!.getTime() } : undefined,
    anchor: !prev && prior ? (prior.result as unknown as Analysis) : undefined,
    facts: memory.facts,
    voice: voice ? voiceForPrompt(voice) : undefined,
  });
  const newMessages = prev ? msgs.filter((m) => m.ts > prev.throughAt!.getTime()).length : msgs.length;

  const result = streamText({
    model: getModel(key.provider, key.apiKey, key.model),
    system: SYSTEM,
    prompt,
    output: Output.object({ schema: analysisSchema }),
    // Same chat, same answer: greedy sampling, plus a per-chat seed where the provider supports one.
    temperature: 0,
    seed: seedFor(chat.id),
    maxRetries: 1,
  });

  return streamResponse(result.stream, {
    label: `analyze ${key.provider} ${key.model}`,
    headers: { "x-read-mode": mode, "x-read-messages": String(newMessages) },
    onDone: async () => {
      const generated = await result.output;
      const output: Analysis = {
        ...generated,
        status: { ...generated.status, score: computeScore(generated.signals, stats) },
        // Held to the user's own typing habits, whatever the model did.
        messageSuggestions: generated.messageSuggestions.map((m) => applyVoice(m, voice)),
        voiceFrom: voice?.count,
      };
      // Keep every new detail as long-term memory (skips ones already on the timeline).
      // Facts the user deleted count as known too, so a re-read doesn't bring them back.
      const found = factsFromAnalysis(output);
      const fresh = newFacts(allFacts.map((f) => f.text), found);
      if (fresh.length)
        await db.personFact.createMany({ data: fresh.map((f) => ({ ...f, personId: person.id, source: "ANALYSIS" as const, analysisId: run.id })) });
      // Connect older memories too: ones saved before tags existed get the tags this read gave the same fact.
      // Only never-edited memories: if the user edited one (e.g. cleared its tags), that choice stands.
      // One transaction = one connection, so a large timeline can't flood the pool.
      const tags = new Map(found.filter((f) => f.entities.length).map((f) => [normalizeFact(f.text), f.entities]));
      const untouched = (f: { createdAt: Date; updatedAt: Date }) => f.updatedAt.getTime() - f.createdAt.getTime() < 1000;
      const backfill = facts.filter((f) => !f.entities.length && untouched(f) && tags.has(normalizeFact(f.text))).slice(0, 200);
      if (backfill.length)
        await db.$transaction(backfill.map((f) => db.personFact.update({ where: { id: f.id }, data: { entities: tags.get(normalizeFact(f.text))! } })));
      // Fingerprint after the new facts land, so the read's own facts don't make its advice look stale.
      const contextHash = await currentContextHash(person);
      await db.analysis.update({ where: { id: run.id }, data: { result: output, contextHash, adviceAt: new Date() } });
    },
  });
}
