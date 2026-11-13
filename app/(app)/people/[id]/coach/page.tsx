import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getPerson } from "@/lib/data";
import { alive } from "@/lib/trash";
import { CoachChat } from "@/components/coach-chat";

export const metadata = { title: "Coach" };

export default async function CoachPage({ params, searchParams }: PageProps<"/people/[id]/coach">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();
  const t = (await searchParams).t;
  const threadId = typeof t === "string" ? t : null;

  const [threads, keyCount] = await Promise.all([
    db.coachThread.findMany({ where: { personId: person.id, ...alive }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true } }),
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
      key={active?.id ?? "new"}
      personId={person.id}
      personName={person.name}
      threadId={active?.id ?? null}
      initialMessages={messages}
      threads={threads.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
      canChat={keyCount > 0}
    />
  );
}
