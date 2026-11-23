import { recallMemory } from "@/lib/memory/recall";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { db } from "@/lib/db";
import { getChat, getChatStats, chatMessages, getVoices } from "@/lib/data";
import { beginTurn } from "@/lib/ai/turn";
import { Prisma } from "@/generated/prisma/client";
import { getModel, providerError } from "@/lib/ai/provider";
import { budgetFor } from "@/lib/ai/models";
import { emotionMap, entitiesIn, FACTS_SHARE, factsWithinBudget } from "@/lib/facts";
import { after } from "next/server";
import { anyWordQuery, buildCoachContext, capFor, COACH_STEPS, COACH_SYSTEM, coachTools, snippet } from "@/lib/ai/coach";
import { compactThread, recentMessages } from "@/lib/ai/thread";
import { decrypt } from "@/lib/crypto";
import { DEBRIEF_SYSTEM, rehearsalTranscript } from "@/lib/ai/persona";
import { improveSystem, isSignal } from "@/lib/goals";
import { buildGraph } from "@/lib/graph";
import { loadGraphRows, saveMemories, syncGraph } from "@/lib/graph-store";
import type { RelationId } from "@/lib/ai/prompt";
import { voiceForPrompt } from "@/lib/voice";
import { ingestSelf, loadSelf, namesFor, selfVoice } from "@/lib/self/store";
import { commonGround, SELF_SHARE, selfForPrompt } from "@/lib/self/prompt";
import { toldItem } from "@/lib/self/traits";
import { historyFor } from "@/lib/history-store";
import { scheduleGraphJob } from "@/lib/graph/job";
import { newSince } from "@/lib/graph/findings";
import { focusNodes as focusOf } from "@/lib/graph/vectors";

export const maxDuration = 120;
// Assistant ids are minted here; client-sent ids are never trusted as row keys.
const newId = createIdGenerator({ prefix: "msg", size: 16 });

/**
 * Earlier coach conversations about this person that mention any of the words, and conversation summaries that do.
 * Rehearsal threads are never searched: what a simulation said is not something that was said.
 * ponytail: the tsvector is computed per row, no index; add a generated column + GIN index past a few thousand messages.
 */
async function searchCoachHistory(personId: string, exceptId: string, query: string, limit: number) {
  const tsq = anyWordQuery(query);
  if (!tsq) return [];
  const [hits, threads] = await Promise.all([
    db.$queryRaw<{ role: string; createdAt: Date; title: string; parts: unknown }[]>`
      SELECT m."role", m."createdAt", t."title", m."parts"
      FROM "CoachMessage" m JOIN "CoachThread" t ON t."id" = m."threadId"
      WHERE t."personId" = ${personId} AND t."deletedAt" IS NULL AND t."mode" = 'coach' AND m."id" <> ${exceptId}
        AND jsonb_to_tsvector('simple', m."parts", '["string"]') @@ to_tsquery('simple', ${tsq})
      ORDER BY ts_rank(jsonb_to_tsvector('simple', m."parts", '["string"]'), to_tsquery('simple', ${tsq})) DESC, m."createdAt" DESC
      LIMIT ${limit}`,
    db.coachThread.findMany({ where: { personId, deletedAt: null, mode: "coach", summary: { not: null } }, select: { title: true, summary: true } }),
  ]);
  const words = tsq.split(" | ");
  return [
    ...hits.map((h) => ({ source: `coach conversation "${h.title}", ${h.createdAt.toISOString().slice(0, 10)}, ${h.role === "user" ? "user" : "coach"}`, text: snippet(h.parts, query) })),
    ...threads.filter((t) => words.some((w) => t.summary!.toLowerCase().includes(w))).slice(0, 3).map((t) => ({ source: `summary of "${t.title}"`, text: t.summary! })),
  ];
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = await beginTurn(req, (await params).id, { mode: "coach" });
  if (started instanceof Response) return started;
  const { userId, person, key, thread, message } = started;
  // Set when the thread was created from a rehearsal. Later turns read the column, not message JSON.
  const debriefId = thread.debriefOfId;
  // Opened from "Improve this": the score goal this thread works on.
  const goal = thread.goalId ? await db.scoreGoal.findFirst({ where: { id: thread.goalId, personId: person.id, deletedAt: null } }) : null;
  const transcript = debriefId
    ? rehearsalTranscript(await db.coachMessage.findMany({ where: { threadId: debriefId, thread: { personId: person.id, mode: "rehearsal" } }, orderBy: { createdAt: "asc" }, select: { role: true, parts: true } }), person.name)
    : "";

  const [rows, { chat, msgs }, read, allFacts, graphRows, findings] = await Promise.all([
    recentMessages(thread), // after the thread's summary, when a long conversation has one
    getChat(person.id).then(async (c) => ({ chat: c, msgs: c ? await chatMessages(c.id) : [] })), // messages fetched alongside the rest
    db.analysis.findFirst({ where: { personId: person.id, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { result: true } }),
    db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true, entities: true, feeling: true, valence: true } }),
    loadGraphRows(person.id),
    db.memoryFinding.findMany({ where: { personId: person.id }, orderBy: { firstSeenAt: "desc" } }),
  ]);
  const facts = allFacts.filter((f) => !f.deletedAt);
  // One budget for the whole context: timeline (capped), latest read, conversation, then recent chat.
  const total = budgetFor(key);
  // If memory is over budget, keep what is connected to the people and topics the user just mentioned.
  const focus = entitiesIn(message.parts.map((p) => p.text).join(" "), facts.flatMap((f) => f.entities));
  const memory = factsWithinBudget(facts, Math.floor(total * FACTS_SHARE), focus);
  const emotion = emotionMap(facts);
  // Retrieval before the model: the part of the graph around what the user just mentioned, and what its links show.
  const graph = buildGraph(graphRows.nodes, graphRows.edges, facts, { them: person.name });
  const said = message.parts.map((p) => p.text).join(" ");
  // What the message is about: nodes it names, plus (with a key that can embed) nodes its other words mean.
  const focusNodes = await focusOf(graph, person.id, key, said);
  // Findings first seen since this conversation's previous turn come first, marked as new. rows[0] is the message just saved.
  const fresh = newSince(findings, rows[1]?.createdAt);
  const graphBrief = graph.brief(focusNodes.map((n) => n.id), fresh).slice(0, 12_000);
  const known = graph.known();
  // The user's own profile (shared by every person) and what they have in common with this one.
  const me = await loadSelf(userId);
  const selfBlock = selfForPrompt({ ...me, relation: person.relation, budget: Math.floor(total * SELF_SHARE) });
  const common = commonGround(me.traits, graph, person.name);
  const used = selfBlock.length + common.length + memory.chars + emotion.length + graphBrief.length + known.join(", ").length + (read ? JSON.stringify(read.result).length : 0) + rows.reduce((n, r) => n + JSON.stringify(r.parts).length, 0) + (thread.summary?.length ?? 0) + transcript.length + 6_000;
  // This chat's voice, stored at upload; without a chat, the user's voice from their other chats.
  const voice = chat ? (await getVoices(chat, msgs)).me : await selfVoice(userId);
  // Long chats: what every earlier period held, read once (lib/history.ts). Whatever is read so far is used.
  const chatHistory = chat ? (await historyFor(chat, msgs, total)).text : "";
  const chatBudget = Math.max(3_000, total - used - chatHistory.length);

  const allTools = coachTools({
    msgs,
    tz: chat?.tzOffset ?? 0,
    knownFacts: allFacts.map((f) => f.text), // incl. trashed ones, so the coach doesn't re-add what the user deleted
    saveFact: async (f) => {
      const { ids, delta } = await saveMemories(person, [f], { source: "COACH" }, key);
      return ids[0] ? { id: ids[0], ...delta } : undefined;
    },
    graph: graphRows,
    personName: person.name,
    facts,
    linkFacts: async (fromId, toId, kind) => {
      await db.memoryLink.create({ data: { fromId, toId, kind } });
    },
    retireFact: async (id) => {
      await db.personFact.updateMany({ where: { id, personId: person.id, deletedAt: null }, data: { deletedAt: new Date() } });
      await syncGraph(person);
    },
    // The one place a stored chat line is decrypted for the model. Scoped to this person and to memories still alive.
    quote: async (edgeId) => {
      const e = await db.memoryEdge.findFirst({ where: { id: edgeId, personId: person.id, fact: { deletedAt: null } }, select: { quoteCipher: true, quoteTs: true, quoteSender: true } });
      return e?.quoteCipher ? { text: decrypt(e.quoteCipher), ts: Number(e.quoteTs), sender: e.quoteSender === "me" ? "me" : "them" } : null;
    },
    findings,
    searchHistory: (query, limit) => searchCoachHistory(person.id, message.id, query, limit),
    recallDetail: (query, words) => recallMemory(person.id, query, key, chat?.tzOffset ?? 0, words),
    voice,
    cap: capFor(total),
    // What the user tells about themself goes to their own profile, shared by every person (lib/self).
    rememberMe: async (kind, text) => {
      const item = toldItem(kind, text, await namesFor(person, chat?.theirName));
      if (item) await ingestSelf(userId, person, [item], "COACH");
      return !!item;
    },
  });
  // In a debrief the coach reads simulated words, so it cannot write memory: what a simulation said is not a fact.
  const { remember, correct, rememberMe, ...readOnly } = allTools;
  const tools = debriefId ? readOnly : { remember, correct, rememberMe, ...readOnly };

  const history = rows.reverse().map((r) => ({ id: r.id, role: r.role, parts: r.parts, metadata: r.metadata ?? undefined }) as UIMessage);
  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: history, tools });
  } catch {
    messages = [{ id: message.id, role: "user", parts: message.parts }]; // stored history from an older format: continue with just this turn
  }

  const context = buildCoachContext({
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    notes: person.notes,
    chat: chat ? { myName: chat.myName, theirName: chat.theirName, tzOffset: chat.tzOffset, stats: await getChatStats(chat, msgs), msgs } : null,
    read: read?.result ?? null,
    facts: memory.facts,
    emotion,
    graph: graphBrief,
    known,
    budget: chatBudget,
    voice: voice ? voiceForPrompt(voice) : undefined,
    summary: thread.summary,
    self: selfBlock,
    common,
    history: chatHistory,
  });
  // What this reply is built from, kept on the reply for the "why?" toggle.
  const shown = [...graph.tensions(focusNodes.map((n) => n.id), 8, true), ...graph.tensions([], 6)];
  const traceBase = {
    provider: key.provider,
    model: key.model,
    focus: focusNodes.map((n) => n.label),
    findings: [...new Map(shown.map((t) => [t.key, { kind: t.kind, isNew: fresh.has(t.key), confidence: t.confidence }])).values()],
    edges: (graphBrief.match(/^- /gm) ?? []).length,
    memories: memory.facts.length,
    history: { messages: messages.length, summarised: !!thread.summary },
    chars: { context: context.length, budget: total },
  };

  const result = streamText({
    model: getModel(key.provider, key.apiKey, key.model),
    system: `${COACH_SYSTEM}\n\n${goal && isSignal(goal.signal) ? `${improveSystem(person.name, goal.signal, (read?.result as { signals?: Record<string, { level?: number; evidence?: string; tip?: string }> } | null)?.signals?.[goal.signal], goal)}\n\n` : ""}${debriefId ? `${DEBRIEF_SYSTEM(person.name)}\n\n<rehearsal_transcript note="practice with a SIMULATION; nothing in it was said by ${person.name} or sent to them">\n${transcript}\n</rehearsal_transcript>\n\n` : ""}${context}`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(COACH_STEPS),
    maxRetries: 1,
  });

  // Peek until real output so a rejected key or exhausted quota becomes a clear error instead of an empty reply.
  const it = result.stream[Symbol.asyncIterator]();
  const buffered: TextStreamPart<ToolSet>[] = [];
  for (;;) {
    const n = await it.next();
    if (n.done) break;
    if (n.value.type === "error") {
      console.error("coach failed", key.provider, key.model, (n.value.error as Error)?.message);
      return Response.json({ error: providerError(n.value.error), threadId: thread.id }, { status: 502, headers: { "x-thread-id": thread.id } });
    }
    buffered.push(n.value);
    if (n.value.type === "text-delta" || n.value.type === "tool-call") break;
  }
  const replay = new ReadableStream<TextStreamPart<ToolSet>>({
    start(c) {
      for (const p of buffered) c.enqueue(p);
    },
    async pull(c) {
      const n = await it.next();
      if (n.done) c.close();
      else c.enqueue(n.value);
    },
    cancel: () => void it.return?.(),
  });

  // After the reply: whatever the coach just remembered gets its categories and evidence, and a conversation
  // that has grown long gets its older part summarised.
  scheduleGraphJob(userId, person);
  after(() => compactThread(thread.id, person.name, key).catch((e) => console.error("compaction failed", key.provider, (e as Error)?.message)));

  return createUIMessageStreamResponse({
    headers: { "x-thread-id": thread.id },
    stream: toUIMessageStream({
      stream: replay,
      tools,
      originalMessages: messages,
      generateMessageId: newId,
      onEnd: async ({ messages: all, isContinuation }) => {
        // Persist every new message (assistant replies incl. tool calls). Nothing is trimmed.
        // Every write is scoped to this thread, so no id can touch another conversation.
        const known = new Set(rows.map((r) => r.id));
        const fresh = all.filter((m) => !known.has(m.id));
        if (fresh.length)
          await db.coachMessage.createMany({
            data: fresh.map((m) => ({ id: m.id, threadId: thread.id, role: m.role, parts: m.parts as Prisma.InputJsonValue, metadata: (m.metadata ?? undefined) as Prisma.InputJsonValue | undefined })),
            skipDuplicates: true,
          });
        const last = all.at(-1);
        if (isContinuation && last && known.has(last.id))
          await db.coachMessage.updateMany({ where: { id: last.id, threadId: thread.id }, data: { parts: last.parts as Prisma.InputJsonValue } });
        await db.coachThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        if (last?.role === "assistant") {
          const parts = last.parts as { type: string; output?: unknown }[];
          const trace = {
            ...traceBase,
            steps: parts.filter((p) => p.type === "step-start").length || 1,
            tools: parts.filter((p) => p.type.startsWith("tool-")).map((p) => ({ name: p.type.slice(5), chars: JSON.stringify(p.output ?? "").length })),
          };
          await db.coachMessage.updateMany({ where: { id: last.id, threadId: thread.id }, data: { trace } });
        }
      },
    }),
  });
}
