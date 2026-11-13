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
import { buildCoachContext, COACH_HISTORY, COACH_SYSTEM, coachTools } from "@/lib/ai/coach";
import type { RelationId } from "@/lib/ai/prompt";

export const maxDuration = 120;
const HOURLY_LIMIT = 60;

const bodySchema = z.object({
  threadId: z.string().max(40).nullish(),
  message: z.object({
    id: z.string().min(1).max(100),
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
  const { message, threadId } = parsed.data;

  const key = await getActiveKey(userId);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });

  const sent = await db.coachMessage.count({ where: { role: "user", thread: { person: { userId } }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (sent >= HOURLY_LIMIT) return Response.json({ error: "You've sent a lot of messages this hour. Take a breath and try again soon." }, { status: 429 });

  const thread = threadId
    ? await db.coachThread.findFirst({ where: { id: threadId, personId: person.id, deletedAt: null } })
    : await db.coachThread.create({ data: { personId: person.id, title: message.parts[0].text.slice(0, 60) } });
  if (!thread) return Response.json({ error: "Conversation not found" }, { status: 404 });

  // Save the user's message before calling the model, so nothing they type is lost even if the AI fails.
  await db.coachMessage.upsert({
    where: { id: message.id },
    create: { id: message.id, threadId: thread.id, role: "user", parts: message.parts },
    update: {},
  });

  const [rows, chat, read, facts] = await Promise.all([
    db.coachMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "desc" }, take: COACH_HISTORY }),
    getChat(person.id),
    db.analysis.findFirst({ where: { personId: person.id, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { result: true } }),
    db.personFact.findMany({ where: { personId: person.id, deletedAt: null }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { kind: true, text: true, happenedAt: true } }),
  ]);
  const msgs = chat ? await loadChat(chat.cipher) : [];

  const tools = coachTools({
    msgs,
    tz: chat?.tzOffset ?? 0,
    knownFacts: facts.map((f) => f.text),
    saveFact: async (f) => {
      await db.personFact.create({ data: { ...f, personId: person.id, source: "COACH" } });
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
    facts,
    budget: Math.floor(CHAR_BUDGET[key.provider] / 2),
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
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages: all }) => {
        // Persist every new or updated message (assistant replies incl. tool calls). Nothing is trimmed.
        const known = new Set(rows.map((r) => r.id));
        for (const m of all) {
          if (known.has(m.id) && m !== all.at(-1)) continue; // already stored; the last one may be a continuation
          await db.coachMessage.upsert({
            where: { id: m.id },
            create: { id: m.id, threadId: thread.id, role: m.role, parts: m.parts as Prisma.InputJsonValue, metadata: (m.metadata ?? undefined) as Prisma.InputJsonValue | undefined },
            update: { parts: m.parts as Prisma.InputJsonValue },
          });
        }
        await db.coachThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      },
    }),
  });
}
