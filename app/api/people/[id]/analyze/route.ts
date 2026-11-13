import { Output, streamText } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getActiveKey, getChatStats, getPerson, loadChat } from "@/lib/data";
import { analysisSchema, type Analysis } from "@/lib/ai/schema";
import { Prisma } from "@/generated/prisma/client";
import { buildPrompt, SYSTEM, type RelationId } from "@/lib/ai/prompt";
import { getModel, providerError } from "@/lib/ai/provider";
import { CHAR_BUDGET } from "@/lib/ai/models";

export const maxDuration = 300;
const HOURLY_LIMIT = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const [key, chat] = await Promise.all([
    getActiveKey(userId),
    db.chatUpload.findFirst({ where: { personId: person.id }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });
  if (!chat) return Response.json({ error: "Upload a chat first" }, { status: 400 });

  // Incremental by default: reuse the last read of this chat and send only messages after it.
  const full = ((await req.json().catch(() => null)) as { mode?: string } | null)?.mode === "full";
  const prev = full
    ? null
    : await db.analysis.findFirst({
        where: { personId: person.id, chatId: chat.id, result: { not: Prisma.DbNull }, throughAt: { not: null } },
        orderBy: { createdAt: "desc" },
      });
  if (prev && chat.lastAt <= prev.throughAt!)
    return Response.json({ error: "Already up to date with this chat. Add a newer export, or run a full re-read." }, { status: 409 });
  const mode = prev ? "incremental" : "full";

  // Record the attempt first, then count: concurrent requests all see each other's rows,
  // and failed or aborted runs still count toward the limit.
  const run = await db.analysis.create({
    data: { personId: person.id, provider: key.provider, model: key.model, chatId: chat.id, throughAt: chat.lastAt, mode },
  });
  const recent = await db.analysis.count({ where: { person: { userId }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent > HOURLY_LIMIT) {
    await db.analysis.delete({ where: { id: run.id } });
    return Response.json({ error: "Hourly limit reached. Try again later." }, { status: 429 });
  }

  const msgs = await loadChat(chat.cipher);
  const prompt = buildPrompt({
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    notes: person.notes,
    myName: chat.myName,
    theirName: chat.theirName,
    stats: await getChatStats(chat),
    tzOffsetMin: chat.tzOffset,
    msgs,
    budget: CHAR_BUDGET[key.provider],
    previous: prev ? { result: prev.result as unknown as Analysis, throughAt: prev.throughAt!.getTime() } : undefined,
  });
  const newMessages = prev ? msgs.filter((m) => m.ts > prev.throughAt!.getTime()).length : msgs.length;

  const result = streamText({
    model: getModel(key.provider, key.apiKey, key.model),
    system: SYSTEM,
    prompt,
    output: Output.object({ schema: analysisSchema }),
    maxRetries: 1,
  });

  // Wait for the first token so auth/quota errors become a proper error response instead of an empty stream.
  const parts = result.stream[Symbol.asyncIterator]();
  const next = async (): Promise<{ text: string } | { error: unknown } | null> => {
    for (;;) {
      const n = await parts.next();
      if (n.done) return null;
      if (n.value.type === "text-delta") return { text: n.value.text };
      if (n.value.type === "error") return { error: n.value.error };
    }
  };
  const first = await next();
  if (!first || "error" in first) {
    const err = first?.error ?? new Error("The model returned nothing");
    console.error("analyze failed", key.provider, key.model, (err as Error)?.message);
    return Response.json({ error: providerError(err) }, { status: 502 });
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start: (c) => c.enqueue(enc.encode(first.text)),
    async pull(c) {
      const n = await next();
      if (!n) {
        // Save before closing so the client's refresh sees it. Invalid/partial JSON throws and is not saved.
        try {
          const output = await result.output;
          await db.analysis.update({ where: { id: run.id }, data: { result: output } });
        } catch (e) {
          console.error("analysis not saved", (e as Error)?.message);
        }
        return c.close();
      }
      if ("error" in n) return c.error(n.error);
      c.enqueue(enc.encode(n.text));
    },
    cancel: () => void parts.return?.(),
  });
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-read-mode": mode, "x-read-messages": String(newMessages) },
  });
}
