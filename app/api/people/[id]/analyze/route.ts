import { Output, streamText } from "ai";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getActiveKey, getChat, getPerson } from "@/lib/data";
import { analysisSchema } from "@/lib/ai/schema";
import { getModel } from "@/lib/ai/provider";
import { rateLimit } from "@/lib/ai/limits";
import { streamResponse } from "@/lib/ai/stream";
import { scheduleGraphJob } from "@/lib/graph/job";
import { prepareRead } from "@/lib/read/run";
import { startRead } from "@/lib/read/job";

export const maxDuration = 300;

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
  const mode = ((await req.json().catch(() => null)) as { mode?: string } | null)?.mode === "full" ? "full" : "auto";
  const background = () => startRead(new URL(req.url).origin, chat.id, mode).then(() => Response.json({ background: true }, { status: 202 }));
  if (chat.readMode) return Response.json({ background: true }, { status: 202 }); // already reading

  const read = await prepareRead(userId, person, chat, key, mode === "full");
  // Long chats: parts of the history are unread. They're read in the background, then the read itself.
  if ("refused" in read) return read.refused!.code === "history_needed" ? background() : Response.json(read.refused, { status: read.refused!.status });

  const result = streamText({
    model: getModel(key.provider, key.apiKey, key.model),
    ...read.call,
    output: Output.object({ schema: analysisSchema }),
    maxRetries: 1,
  });

  // Once the read is saved and sent: categories for the new things, typed edges for older memories.
  scheduleGraphJob(userId, person);

  return streamResponse(result.stream, {
    label: `analyze ${key.provider} ${key.model}`,
    headers: { "x-read-mode": read.mode, "x-read-messages": String(read.newMessages) },
    onDone: async () => read.finish(await result.output),
    // Rate limited before a word came back: the background read waits for the limit and retries by itself.
    onError: async (e) => {
      if (!rateLimit(e)) return;
      await db.analysis.delete({ where: { id: read.runId } }).catch(() => undefined); // not an attempt the hourly limit counts
      return background();
    },
  });
}
