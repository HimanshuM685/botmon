import "server-only";
import { createIdGenerator } from "ai";
import { z } from "zod";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getActiveKey, getPerson } from "@/lib/data";
import { Prisma } from "@/generated/prisma/client";
import { isSignal, SIGNAL_LABEL, type SignalKey } from "@/lib/goals";

/** Coach and rehearsal share one hourly cap: both count the user's messages. */
export const HOURLY_MESSAGE_LIMIT = 60;

const newId = createIdGenerator({ prefix: "msg", size: 16 });

const bodySchema = z.object({
  threadId: z.string().max(40).nullish(),
  /** Start a debrief: the id of a rehearsal thread whose transcript this new coach conversation is about. */
  debriefOf: z.string().max(40).nullish(),
  /** Start working on a read score ("Improve this"): one of the signal keys (lib/goals.ts). */
  improve: z.string().max(40).nullish(),
  message: z.object({
    role: z.literal("user"),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().min(1).max(4000) })).min(1).max(5),
  }),
});

/**
 * The open goal for this score, or a new one starting at the latest read's level. A score with no read yet
 * starts at 0. ponytail: find-then-create can race into two goals on a double click; harmless (the newest counts).
 */
async function openGoal(personId: string, signal: SignalKey) {
  const open = await db.scoreGoal.findFirst({ where: { personId, signal, achievedAt: null }, orderBy: { createdAt: "desc" } });
  if (open) return open;
  const read = await db.analysis.findFirst({ where: { personId, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { result: true } });
  const level = (read?.result as { signals?: Record<string, { level?: number }> } | null)?.signals?.[signal]?.level;
  return db.scoreGoal.create({ data: { personId, signal, fromLevel: typeof level === "number" ? level : 0 } });
}

type Person = NonNullable<Awaited<ReturnType<typeof getPerson>>>;

export type StartedTurn = {
  userId: string;
  person: Person;
  key: NonNullable<Awaited<ReturnType<typeof getActiveKey>>>;
  thread: NonNullable<Awaited<ReturnType<typeof db.coachThread.findFirst>>>;
  message: { id: string; role: "user"; parts: { type: "text"; text: string }[] };
};

/**
 * Shared start of a coach or rehearsal turn: auth, the message, the hourly cap, the thread.
 * A thread is only continued in its own mode, so a rehearsal cannot be resumed as a coach thread.
 * A new debrief stores `debriefOfId` on the thread. Later turns read that column.
 */
export async function beginTurn(
  req: Request,
  personId: string,
  opts: {
    mode: "coach" | "rehearsal";
    /** Stop before a thread is created (rehearsal refuses when too little is known). */
    gate?: (person: Person) => Promise<Response | null>;
  },
): Promise<Response | StartedTurn> {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, personId);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Message must be 1–4000 characters" }, { status: 400 });

  const key = await getActiveKey(userId);
  if (!key) return Response.json({ error: "Add an AI key in Settings first" }, { status: 400 });

  const blocked = await opts.gate?.(person);
  if (blocked) return blocked;

  const sent = await db.coachMessage.count({ where: { role: "user", thread: { person: { userId } }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (sent >= HOURLY_MESSAGE_LIMIT) return Response.json({ error: "You've sent a lot of messages this hour. Take a breath and try again soon." }, { status: 429 });

  const { threadId } = parsed.data;
  // Only a rehearsal of this same person can be debriefed, and only as a new coach thread.
  const requested = opts.mode === "coach" && !threadId ? parsed.data.debriefOf : null;
  const practice = requested
    ? await db.coachThread.findFirst({ where: { id: requested, personId: person.id, mode: "rehearsal", deletedAt: null }, select: { id: true, title: true } })
    : null;

  // "Improve this": a new coach thread about one score, tied to the goal (an open one is reused).
  const improve = opts.mode === "coach" && !threadId && !practice && isSignal(parsed.data.improve) ? parsed.data.improve : null;
  const goal = improve ? await openGoal(person.id, improve) : null;

  const message = { ...parsed.data.message, id: newId() };
  const thread = threadId
    ? await db.coachThread.findFirst({ where: { id: threadId, personId: person.id, deletedAt: null, mode: opts.mode } })
    : await db.coachThread.create({
        data: {
          personId: person.id,
          mode: opts.mode,
          title: practice ? `Debrief: ${practice.title}`.slice(0, 60) : improve ? `Improve: ${SIGNAL_LABEL[improve]}` : message.parts[0].text.slice(0, 60),
          ...(practice ? { debriefOfId: practice.id } : {}),
          ...(goal ? { goalId: goal.id } : {}),
        },
      });
  if (!thread) return Response.json({ error: "Conversation not found" }, { status: 404 });

  await db.coachMessage.create({ data: { id: message.id, threadId: thread.id, role: "user", parts: message.parts } });
  return { userId, person, key, thread, message };
}
