import { getUserId } from "@/lib/auth/server";
import { getActiveKey, getChat, getPerson } from "@/lib/data";
import { jobStatus, readStatus, resumeIfStalled } from "@/lib/read/job";

/**
 * Where the current chat's history and background read stand: parts in all, parts still to read, the size of what
 * is left, and the job (lib/read/job.ts). Asking also restarts a job whose chain broke.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });
  const [key, chat] = await Promise.all([getActiveKey(userId), getChat(person.id)]);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });
  if (!chat) return Response.json({ error: "Upload a chat first" }, { status: 400 });
  resumeIfStalled(new URL(req.url).origin, chat);
  // ?job=1: the page following a read, every few seconds; the job keeps its progress on the row, so no decrypting.
  if (new URL(req.url).searchParams.has("job")) return Response.json(jobStatus(chat));
  return Response.json(await readStatus(chat, key));
}
