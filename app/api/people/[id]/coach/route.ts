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
import { z } from "zod";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getActiveKey, getChat, getChatStats, getPerson, loadChat } from "@/lib/data";
import { Prisma } from "@/generated/prisma/client";
import { getModel, providerError } from "@/lib/ai/provider";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { emotionMap, entitiesIn, FACTS_SHARE, factsWithinBudget } from "@/lib/facts";
import { buildCoachContext, COACH_HISTORY, COACH_SYSTEM, coachTools } from "@/lib/ai/coach";
import type { RelationId } from "@/lib/ai/prompt";
import { voiceForPrompt, voiceProfile } from "@/lib/voice";

export const maxDuration = 120;
const HOURLY_LIMIT = 60;
// Message ids are always minted here; client-sent ids are never trusted as row keys.
const newId = createIdGenerator({ prefix: "msg", size: 16 });

const bodySchema = z.object({
  threadId: z.string().max(40).nullish(),
  message: z.object({
    role: z.literal("user"),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().min(1).max(4000) })).min(1).max(5),
  }),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Message must be 1–4000 characters" }, { status: 400 });
  const { threadId } = parsed.data;
  const message = { ...parsed.data.message, id: newId() };

  const key = await getActiveKey(userId);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });

  const sent = await db.coachMessage.count({ where: { role: "user", thread: { person: { userId } }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (sent >= HOURLY_LIMIT) return Response.json({ error: "You've sent a lot of messages this hour. Take a breath and try again soon." }, { status: 429 });

  const thread = threadId
    ? await db.coachThread.findFirst({ where: { id: threadId, personId: person.id, deletedAt: null } })
    : await db.coachThread.create({ data: { personId: person.id, title: message.parts[0].text.slice(0, 60) } });
  if (!thread) return Response.json({ error: "Conversation not found" }, { status: 404 });

  // Save the user's message before calling the model, so nothing they type is lost even if the AI fails.
  await db.coachMessage.create({ data: { id: message.id, threadId: thread.id, role: "user", parts: message.parts } });

  const [rows, chat, read, allFacts] = await Promise.all([
    db.coachMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "desc" }, take: COACH_HISTORY }),
    getChat(person.id),
    db.analysis.findFirst({ where: { personId: person.id, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { result: true } }),
    db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true, entities: true, feeling: true, valence: true } }),
  ]);
  const facts = allFacts.filter((f) => !f.deletedAt);
  // One budget for the whole context: timeline (capped), latest read, conversation, then recent chat.
  const total = CHAR_BUDGET[key.provider];
  // If memory is over budget, keep what is connected to the people and topics the user just mentioned.
  const focus = entitiesIn(message.parts.map((p) => p.text).join(" "), facts.flatMap((f) => f.entities));
  const memory = factsWithinBudget(facts, Math.floor(total * FACTS_SHARE), focus);
  const emotion = emotionMap(facts);
  const used = memory.chars + emotion.length + (read ? JSON.stringify(read.result).length : 0) + rows.reduce((n, r) => n + JSON.stringify(r.parts).length, 0) + 6_000;
  const chatBudget = Math.max(3_000, total - used);
  const msgs = chat ? await loadChat(chat.cipher) : [];
  const voice = chat ? voiceProfile(msgs, chat.myName) : null;

  const tools = coachTools({
    msgs,
    tz: chat?.tzOffset ?? 0,
    knownFacts: allFacts.map((f) => f.text), // incl. trashed ones, so the coach doesn't re-add what the user deleted
    saveFact: async (f) => (await db.personFact.create({ data: { ...f, personId: person.id, source: "COACH" }, select: { id: true } })).id,
    facts,
    linkFacts: async (fromId, toId, kind) => {
      await db.memoryLink.create({ data: { fromId, toId, kind } });
    },
    retireFact: async (id) => {
      await db.personFact.updateMany({ where: { id, personId: person.id, deletedAt: null }, data: { deletedAt: new Date() } });
    },
  });

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
    chat: chat ? { myName: chat.myName, theirName: chat.theirName, tzOffset: chat.tzOffset, stats: await getChatStats(chat), msgs } : null,
    read: read?.result ?? null,
    facts: memory.facts,
    emotion,
    budget: chatBudget,
    voice: voice ? voiceForPrompt(voice) : undefined,
  });

  const result = streamText({
    model: getModel(key.provider, key.apiKey, key.model),
    system: `${COACH_SYSTEM}\n\n${context}`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
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
      },
    }),
  });
}
