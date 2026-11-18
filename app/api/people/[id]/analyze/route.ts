import { getUserId } from "@/lib/auth/server";
import { getActiveKey, getChat, getPerson } from "@/lib/data";
import { startRead } from "@/lib/read/job";

/**
 * Start a read of the person's current chat. Every read runs in the background (lib/read/job.ts): long chats part by
 * part, overloaded models and rate limits retried with waits, and it goes on if the page is closed. The page follows
 * it through the history route.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const [key, chat] = await Promise.all([getActiveKey(userId), getChat(person.id)]);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });
  if (!chat) return Response.json({ error: "Upload a chat first" }, { status: 400 });

  // Incremental by default: the job reuses the last read of this chat and sends only messages after it.
  const mode = ((await req.json().catch(() => null)) as { mode?: string } | null)?.mode === "full" ? "full" : "auto";
  // A read already going keeps going, in the mode asked for now (restarted if its chain broke).
  await startRead(new URL(req.url).origin, chat, mode);
  return Response.json({ background: true }, { status: 202 });
}
