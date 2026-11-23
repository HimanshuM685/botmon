import "server-only";
import { db } from "@/lib/db";
import { chatMessages, currentContextHash, getChatStats, getVoices, type getActiveKey, type getChat, type getPerson } from "@/lib/data";
import type { Analysis } from "@/lib/ai/schema";
import { Prisma } from "@/generated/prisma/client";
import { buildPrompt, SYSTEM, type RelationId } from "@/lib/ai/prompt";
import { seedFor } from "@/lib/ai/stream";
import { emotionMap, FACTS_SHARE, factsFromAnalysis, factsWithinBudget, newFacts, normalizeFact, untouched } from "@/lib/facts";
import { budgetFor } from "@/lib/ai/models";
import { computeScore } from "@/lib/stats";
import { linkMemories, loadGraph, pruneGraph, saveMemories } from "@/lib/graph-store";
import { applyVoice, voiceForPrompt } from "@/lib/voice";
import { goalsPrompt, markReachedGoals } from "@/lib/goals-store";
import { learnFromChat, loadSelf, promoteMeEdges, selfChanged } from "@/lib/self/store";
import { SELF_SHARE, selfForPrompt } from "@/lib/self/prompt";
import { historyFor } from "@/lib/history-store";
import type { Msg } from "@/lib/parsers/types";

/** Memories last changed before this could not have had a feeling set or cleared by the user (migration memory_feeling). */
const FEELINGS_SINCE = new Date("2026-11-16T00:00:00Z");
const HOURLY_LIMIT = 10;

type Person = NonNullable<Awaited<ReturnType<typeof getPerson>>>;
type Chat = NonNullable<Awaited<ReturnType<typeof getChat>>>;
type Key = NonNullable<Awaited<ReturnType<typeof getActiveKey>>>;

export type ReadRefusal = { error: string; status: number; code?: string; todo?: number };

/**
 * Everything a read of the person's current chat needs, shared by the streamed read (analyze route) and the
 * background one (lib/read/job.ts): the model call to make, and `finish` to save what it answered.
 */
/** `loaded`: the chat's messages when the caller has already decrypted them. */
export async function prepareRead(userId: string, person: Person, chat: Chat, key: Key, full: boolean, loaded?: Msg[]) {
  // Latest read of this chat: the base for an incremental read, or a stability anchor for a full re-read.
  const last = await db.analysis.findFirst({
    where: { personId: person.id, chatId: chat.id, deletedAt: null, result: { not: Prisma.DbNull }, throughAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const prev = full ? null : last;
  // First read of this chat: a read built earlier from memory (or of a replaced chat) is the prior to stay consistent with.
  const prior = last ?? (await db.analysis.findFirst({ where: { personId: person.id, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" } }));
  if (prev && chat.lastAt <= prev.throughAt!)
    return { refused: { error: "Already up to date with this chat. Add a newer export, or run a full re-read.", status: 409, code: "up_to_date" } satisfies ReadRefusal };
  const mode = prev ? "incremental" : "full";

  // Long chats are read whole: every period before the newest stretch must be read (lib/read/job.ts) first,
  // so a read never silently skips months.
  const msgs = loaded ?? (await chatMessages(chat.id));
  const budget = budgetFor(key);
  const history = await historyFor(chat, msgs, budget);
  if (!history.ready)
    return { refused: { error: `Read the rest of this chat's history first (${history.todo} of ${history.parts} parts left).`, status: 409, code: "history_needed", todo: history.todo } satisfies ReadRefusal };

  // Record the attempt first, then count: concurrent requests all see each other's rows,
  // and failed or aborted runs still count toward the limit.
  const run = await db.analysis.create({
    data: { personId: person.id, provider: key.provider, model: key.model, chatId: chat.id, throughAt: chat.lastAt, mode },
  });
  const recent = await db.analysis.count({ where: { person: { userId }, deletedAt: undefined, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent > HOURLY_LIMIT) {
    await db.analysis.delete({ where: { id: run.id } });
    return { refused: { error: "Hourly limit reached. Try again later.", status: 429, code: "hourly" } satisfies ReadRefusal };
  }

  const allFacts = await db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true, entities: true, feeling: true, valence: true, mentions: true, createdAt: true, updatedAt: true } });
  const facts = allFacts.filter((f) => !f.deletedAt);
  // Everything shares one budget: timeline (capped), previous read, then as much chat as still fits.
  const memory = factsWithinBudget(facts, Math.floor(budget * FACTS_SHARE));
  const emotion = emotionMap(facts);
  const graph = await loadGraph(person, facts);
  const graphBrief = graph.brief().slice(0, 8_000), known = graph.known();
  const chatBudget = Math.max(5_000, budget - memory.chars - emotion.length - graphBrief.length - known.join(", ").length - history.text.length - (prev ?? prior ? JSON.stringify((prev ?? prior)!.result).length : 0));
  const stats = await getChatStats(chat, msgs);
  const voice = (await getVoices(chat, msgs)).me; // stored at upload (lib/data.ts)
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
    graph: graphBrief,
    known,
    goals: await goalsPrompt(person.id),
    // The user's own profile: a prior for yourSide and for advice that fits them (lib/self).
    self: selfForPrompt({ ...(await loadSelf(userId)), relation: person.relation, budget: Math.floor(budget * SELF_SHARE) }),
    voice: voice ? voiceForPrompt(voice) : undefined,
    history: history.text || undefined,
    historyTo: history.to,
  });

  // The chat was removed or moved to another person while this read ran (removeChat / moveChat).
  const chatStillHere = () => db.chatUpload.findFirst({ where: { id: chat.id, personId: person.id, deletedAt: null }, select: { id: true } });

  /** Save a finished answer: the read, its new memories, and what it showed about the user. */
  async function finish(generated: Analysis) {
    // Save nothing if the chat left, or the wrong person's memories would land here after the clean-up.
    if (!(await chatStillHere())) return;
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
    // Saved through the graph store: each memory's triples become nodes and edges.
    await saveMemories(person, fresh, { source: "ANALYSIS", analysisId: run.id }, key);
    // Connect older memories too: ones saved before tags or feelings existed get what this read gave the same fact.
    // Only never-edited memories: if the user edited one (e.g. cleared its tags), that choice stands.
    // Feelings also reach memories last changed before feelings existed: nobody could have cleared one then
    // (this covers memories an earlier tag backfill had touched).
    // One transaction = one connection, so a large timeline can't flood the pool.
    const again = new Map(found.map((f) => [normalizeFact(f.text), f]));
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
    // Never-edited memories already on the timeline join the graph with what this read states for the same fact:
    // its edges, and the tags they just got (the store skips edges they already have). One call, one graph load.
    // Edited ones are left alone here too: a tag the user removed must not come back as an edge.
    const gotTags = new Set(backfill.filter((b) => b.tags).map((b) => b.f.id));
    const relink = facts.flatMap((f) => {
      const now = again.get(normalizeFact(f.text));
      if (!now || !untouched(f) || !(now.triples?.length || gotTags.has(f.id))) return [];
      return [{ f, tags: gotTags.has(f.id) ? now.entities : f.entities, triples: now.triples }];
    }).slice(0, 200);
    const { entities: linked } = await linkMemories(person, relink.map(({ f, tags, triples }) => ({ factId: f.id, tags, triples })), key);
    // The tag list cached on each memory follows the graph, as for new memories (saveMemories).
    const retag = relink.filter(({ f, tags }) => (linked.get(f.id) ?? tags).join("|") !== tags.join("|"));
    if (retag.length)
      await db.$transaction(retag.map(({ f }) => db.personFact.update({ where: { id: f.id }, data: { entities: linked.get(f.id)!, updatedAt: f.updatedAt } })));
    // Fingerprint after the new facts land, so the read's own facts don't make its advice look stale.
    const contextHash = await currentContextHash(person);
    await db.analysis.update({ where: { id: run.id }, data: { result: output, contextHash, adviceAt: new Date() } });
    await markReachedGoals(person.id, output.signals);
    // What this read showed about the user, kept only when one of their own lines proves it (lib/self).
    await learnFromChat(userId, person, chat, msgs, output.aboutUser, "ANALYSIS", { analysisId: run.id });
    await promoteMeEdges(userId, person).catch(() => undefined);
    // The chat left while the lines above were saving (after the check at the top): take this run's memories off the
    // timeline too. Erased, not trashed, for the same reason as detachChat (app/actions.ts): a trashed memory tells
    // the AI the user said it is no longer true.
    if (!(await chatStillHere())) {
      await db.$transaction([
        db.personFact.deleteMany({ where: { personId: person.id, source: "ANALYSIS", analysisId: run.id } }),
        db.analysis.updateMany({ where: { id: run.id, deletedAt: null }, data: { deletedAt: new Date() } }),
        // What this run learned about the user from the chat that left.
        db.selfEvidence.deleteMany({ where: { personId: person.id, analysisId: run.id } }),
      ]);
      await pruneGraph(person.id);
      await selfChanged(userId);
    }
  }

  return {
    runId: run.id,
    // Same chat, same answer: greedy sampling, plus a per-chat seed where the provider supports one.
    call: { system: SYSTEM, prompt, temperature: 0, seed: seedFor(chat.id) },
    finish,
  };
}
