import { kick, step, validToken } from "@/lib/read/job";

export const maxDuration = 300; // STEP_MAX_MS

/** One step of a chat's background read (lib/read/job.ts), queued by the app itself; queues the next. */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const { chatId } = ((await req.json().catch(() => null)) ?? {}) as { chatId?: string };
  if (!chatId || !validToken(chatId, req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const { again } = await step(chatId);
  if (again !== undefined) kick(new URL(req.url).origin, chatId, again, startedAt);
  return Response.json({ again: again ?? null });
}
