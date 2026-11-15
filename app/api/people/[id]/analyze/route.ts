import { Output, streamText } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { currentContextHash, getActiveKey, getChat, getChatStats, getPerson, loadChat } from "@/lib/data";
import { analysisSchema, type Analysis } from "@/lib/ai/schema";
import { Prisma } from "@/generated/prisma/client";
import { buildPrompt, SYSTEM, type RelationId } from "@/lib/ai/prompt";
import { getModel } from "@/lib/ai/provider";
import { seedFor, streamResponse } from "@/lib/ai/stream";
import { emotionMap, FACTS_SHARE, factsFromAnalysis, factsWithinBudget, newFacts, normalizeFact } from "@/lib/facts";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { computeScore } from "@/lib/stats";
import { applyVoice, voiceForPrompt, voiceProfile } from "@/lib/voice";

export const maxDuration = 300;
/** Memories last changed before this could not have had a feeling set or cleared by the user (migration memory_feeling). */
const FEELINGS_SINCE = new Date("2026-11-16T00:00:00Z");
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
    db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true, entities: true, feeling: true, valence: true, createdAt: true, updatedAt: true } }),
  ]);
  const facts = allFacts.filter((f) => !f.deletedAt);
  // Everything shares one budget: timeline (capped), previous read, then as much chat as still fits.
  const total = CHAR_BUDGET[key.provider];
  const memory = factsWithinBudget(facts, Math.floor(total * FACTS_SHARE));
  const emotion = emotionMap(facts);
  const chatBudget = Math.max(5_000, total - memory.chars - emotion.length - (prev ?? prior ? JSON.stringify((prev ?? prior)!.result).length : 0));
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
    emotion,
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
      // The chat was removed or moved to another person while this read ran (removeChat / moveChat):
      // save nothing, or the wrong person's memories would land here after the clean-up.
      const chatStillHere = () => db.chatUpload.findFirst({ where: { id: chat.id, personId: person.id, deletedAt: null }, select: { id: true } });
      if (!(await chatStillHere())) return;
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
      // Connect older memories too: ones saved before tags or feelings existed get what this read gave the same fact.
      // Only never-edited memories: if the user edited one (e.g. cleared its tags), that choice stands.
      // Feelings also reach memories last changed before feelings existed: nobody could have cleared one then
      // (this covers memories an earlier tag backfill had touched).
      // One transaction = one connection, so a large timeline can't flood the pool.
      const again = new Map(found.map((f) => [normalizeFact(f.text), f]));
      const untouched = (f: { createdAt: Date; updatedAt: Date }) => f.updatedAt.getTime() - f.createdAt.getTime() < 1000;
      const backfill = facts
        .map((f) => ({ f, now: again.get(normalizeFact(f.text)) }))
        .map(({ f, now }) => ({ f, now, tags: !!now && untouched(f) && !f.entities.length && now.entities.length > 0, felt: !!now?.feeling && !f.feeling && (untouched(f) || f.updatedAt < FEELINGS_SINCE) }))
        .filter((b) => b.tags || b.felt)
        .slice(0, 200);
      if (backfill.length)
        await db.$transaction(backfill.map(({ f, now, tags, felt }) => db.personFact.update({
          where: { id: f.id },
          // updatedAt kept: a backfill is not an edit, so it neither looks like one next time nor counts as new information.
          data: { ...(tags ? { entities: now!.entities } : {}), ...(felt ? { feeling: now!.feeling, valence: now!.valence } : {}), updatedAt: f.updatedAt },
        })));
      // Fingerprint after the new facts land, so the read's own facts don't make its advice look stale.
      const contextHash = await currentContextHash(person);
      await db.analysis.update({ where: { id: run.id }, data: { result: output, contextHash, adviceAt: new Date() } });
      // The chat left while the lines above were saving (after the check at the top): take this run's memories off the timeline too.
      if (!(await chatStillHere())) {
        const at = new Date();
        await db.$transaction([
          db.personFact.updateMany({ where: { analysisId: run.id, deletedAt: null }, data: { deletedAt: at } }),
          db.analysis.updateMany({ where: { id: run.id, deletedAt: null }, data: { deletedAt: at } }),
        ]);
      }
    },
  });
}
