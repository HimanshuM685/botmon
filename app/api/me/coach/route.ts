import { convertToModelMessages, createIdGenerator, stepCountIs, streamText, validateUIMessages, type UIMessage } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getActiveKey } from "@/lib/data";
import { Prisma } from "@/generated/prisma/client";
import { getModel, providerError } from "@/lib/ai/provider";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { overHourlyCap } from "@/lib/ai/turn";
import { compactThread, recentMessages } from "@/lib/ai/thread";
import { voiceForPrompt } from "@/lib/voice";
import { allNames, loadSelf, selfVoice } from "@/lib/self/store";
import { SELF_SHARE, selfForPrompt } from "@/lib/self/prompt";
import { SELF_COACH_SYSTEM, selfTools } from "@/lib/self/coach";
import { toldItem } from "@/lib/self/traits";

export const maxDuration = 60;
const newId = createIdGenerator({ prefix: "msg", size: 16 });

const bodySchema = z.object({
  threadId: z.string().max(40).nullish(),
  message: z.object({ role: z.literal("user"), parts: z.array(z.object({ type: z.literal("text"), text: z.string().min(1).max(4000) })).min(1).max(5) }),
});

/**
 * "Coach me": a coach conversation about the user themself, owned by the user, tied to no person. It reads only
 * the user's own profile, and writes only to it (what the user says about themself is their own word).
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } }))) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Message must be 1–4000 characters" }, { status: 400 });
  const key = await getActiveKey(userId);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });
  if (await overHourlyCap(userId)) return Response.json({ error: "You've sent a lot of messages this hour. Take a breath and try again soon." }, { status: 429 });

  const message = { ...parsed.data.message, id: newId() };
  const thread = parsed.data.threadId
    ? await db.coachThread.findFirst({ where: { id: parsed.data.threadId, userId, mode: "self", deletedAt: null } })
    : await db.coachThread.create({ data: { userId, mode: "self", title: message.parts[0].text.slice(0, 60) } });
  if (!thread) return Response.json({ error: "Conversation not found" }, { status: 404 });
  await db.coachMessage.create({ data: { id: message.id, threadId: thread.id, role: "user", parts: message.parts } });

  const [rows, me, voice, names] = await Promise.all([recentMessages(thread), loadSelf(userId), selfVoice(userId), allNames(userId)]);
  const tools = selfTools(async (kind, text) => {
    const item = toldItem(kind, text, names); // no names of the people in their life
    if (!item) return false;
    // Told by the user directly: their own word, which background work never rewrites or removes.
    // Already learned from a chat: now it is theirs too, so it stays whatever happens to that chat's evidence.
    await db.selfTrait.upsert({ where: { userId_kind_key: { userId, kind: item.kind, key: item.key } }, create: { userId, kind: item.kind, key: item.key, text: item.text, source: "USER" }, update: { deletedAt: null, source: "USER" } });
    return true;
  });
  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: rows.reverse().map((r) => ({ id: r.id, role: r.role, parts: r.parts, metadata: r.metadata ?? undefined }) as UIMessage), tools });
  } catch {
    messages = [{ id: message.id, role: "user", parts: message.parts }];
  }
  const profile = selfForPrompt({ ...me, budget: Math.floor(CHAR_BUDGET[key.provider] * SELF_SHARE * 2) });
  const context = [
    profile ? `<about_user>\n${profile}\n</about_user>` : "<about_user>Nothing learned yet: no chat has been read and they haven't told you about themself. Ask.</about_user>",
    thread.summary ? `<conversation_so_far>\n${thread.summary}\n</conversation_so_far>` : "",
    voice ? voiceForPrompt(voice) : "",
  ].filter(Boolean).join("\n\n");

  const result = streamText({ model: getModel(key.provider, key.apiKey, key.model), system: `${SELF_COACH_SYSTEM}\n\n${context}`, messages: await convertToModelMessages(messages), tools, stopWhen: stepCountIs(4), maxRetries: 1 });
  after(() => compactThread(thread.id, "the user themself", key).catch(() => undefined));
  return result.toUIMessageStreamResponse({
    headers: { "x-thread-id": thread.id },
    originalMessages: messages,
    generateMessageId: newId,
    onError: (e) => providerError(e),
    onFinish: async ({ messages: all }) => {
      const known = new Set(rows.map((r) => r.id));
      const fresh = all.filter((m) => !known.has(m.id));
      if (fresh.length)
        await db.coachMessage.createMany({ data: fresh.map((m) => ({ id: m.id, threadId: thread.id, role: m.role, parts: m.parts as Prisma.InputJsonValue })), skipDuplicates: true });
      await db.coachThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    },
  });
}
