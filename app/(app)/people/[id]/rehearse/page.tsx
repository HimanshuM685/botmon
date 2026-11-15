import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getChat, getPerson } from "@/lib/data";
import { alive } from "@/lib/trash";
import { enoughMemory } from "@/lib/model";
import { CoachChat } from "@/components/coach-chat";

export const metadata = { title: "Practise" };

export default async function RehearsePage({ params, searchParams }: PageProps<"/people/[id]/rehearse">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();
  const t = (await searchParams).t;
  const threadId = typeof t === "string" ? t : null;

  const [threads, keyCount, chat, factCount] = await Promise.all([
    db.coachThread.findMany({ where: { personId: person.id, mode: "rehearsal", ...alive }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true } }),
    db.apiKey.count({ where: { userId: user.id } }),
    getChat(person.id),
    db.personFact.count({ where: { personId: person.id, ...alive } }),
  ]);
  const active = threadId ? threads.find((x) => x.id === threadId) : undefined;
  const messages = active
    ? (await db.coachMessage.findMany({ where: { threadId: active.id }, orderBy: { createdAt: "asc" } })).map(
        (m) => ({ id: m.id, role: m.role, parts: m.parts, metadata: m.metadata ?? undefined }) as UIMessage,
      )
    : [];
  const known = !!chat || enoughMemory(factCount, person.notes);

  return (
    <CoachChat
      key={active?.id ?? "new"}
      mode="rehearsal"
      personId={person.id}
      personName={person.name}
      threadId={active?.id ?? null}
      initialMessages={messages}
      threads={threads.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
      canChat={keyCount > 0 && known}
      notice={!known ? `Not enough is known about ${person.name} to practise with yet. Upload a chat, or tell the coach more about them first.` : !chat ? `No chat uploaded: how ${person.name} writes is a guess here, only what they would say is grounded in what you've told the coach.` : undefined}
    />
  );
}
