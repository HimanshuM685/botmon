import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getPerson } from "@/lib/data";
import { alive } from "@/lib/trash";
import { CoachChat } from "@/components/coach-chat";
import { Prisma } from "@/generated/prisma/client";
import { isSignal, SIGNAL_LABEL } from "@/lib/goals";

export const metadata = { title: "Coach" };

export default async function CoachPage({ params, searchParams }: PageProps<"/people/[id]/coach">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();
  const { t, debrief, improve: score } = await searchParams;
  const threadId = typeof t === "string" ? t : null;
  // Arriving from a rehearsal's "How did I do?": a new conversation that starts with that practice run.
  const debriefOf = !threadId && typeof debrief === "string" ? debrief : undefined;
  // Arriving from "Improve this" on the read: a new conversation about one score, which it names with its level.
  const signal = !threadId && !debriefOf && isSignal(score) ? score : undefined;
  const read = signal
    ? await db.analysis.findFirst({ where: { personId: person.id, ...alive, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { result: true } })
    : null;
  const level = signal ? (read?.result as { signals?: Record<string, { level?: number }> } | null)?.signals?.[signal]?.level : undefined;
  const improve = signal ? { signal, ask: `Help me improve this: ${SIGNAL_LABEL[signal]}${typeof level === "number" ? ` (${level}/4 now)` : ""}` } : undefined;

  const [threads, keyCount] = await Promise.all([
    db.coachThread.findMany({ where: { personId: person.id, mode: "coach", ...alive }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true } }),
    db.apiKey.count({ where: { userId: user.id } }),
  ]);
  const active = threadId ? threads.find((x) => x.id === threadId) : undefined;
  const messages = active
    ? (await db.coachMessage.findMany({ where: { threadId: active.id }, orderBy: { createdAt: "asc" } })).map(
        (m) => ({ id: m.id, role: m.role, parts: m.parts, metadata: m.metadata ?? undefined }) as UIMessage,
      )
    : [];

  return (
    <CoachChat
      key={active?.id ?? debriefOf ?? signal ?? "new"}
      debriefOf={debriefOf}
      improve={improve}
      personId={person.id}
      personName={person.name}
      threadId={active?.id ?? null}
      initialMessages={messages}
      threads={threads.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
      canChat={keyCount > 0}
    />
  );
}
