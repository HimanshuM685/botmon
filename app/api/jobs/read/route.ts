import { after } from "next/server";
import { chain, step, validToken } from "@/lib/read/job";

export const maxDuration = 300; // STEP_MAX_MS

/**
 * One step of a chat's background read (lib/read/job.ts), called by the app itself. It answers straight away, so
 * the caller knows the step arrived, then runs the step and queues the next one.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const { chatId } = ((await req.json().catch(() => null)) ?? {}) as { chatId?: string };
  if (!chatId || !validToken(chatId, req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const origin = new URL(req.url).origin;
  after(async () => {
    const { again } = await step(chatId).catch((e) => (console.error("read job: step crashed", (e as Error)?.message), { again: undefined }));
    if (again !== undefined) await chain(origin, chatId, again, startedAt);
  });
  return Response.json({ ok: true }, { status: 202 });
}
