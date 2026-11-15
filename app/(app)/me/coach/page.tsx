import type { UIMessage } from "ai";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { alive } from "@/lib/trash";
import { CoachChat } from "@/components/coach-chat";

export const metadata = { title: "Coach me" };

/** "Coach me": conversations about the user themself, with no person (app/api/me/coach). */
export default async function SelfCoachPage({ searchParams }: PageProps<"/me/coach">) {
  const user = await requireUser();
  const t = (await searchParams).t;
  const [threads, keyCount] = await Promise.all([
    db.coachThread.findMany({ where: { userId: user.id, mode: "self", ...alive }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true } }),
    db.apiKey.count({ where: { userId: user.id } }),
  ]);
  const active = typeof t === "string" ? threads.find((x) => x.id === t) : undefined;
  const messages = active
    ? (await db.coachMessage.findMany({ where: { threadId: active.id }, orderBy: { createdAt: "asc" } })).map((m) => ({ id: m.id, role: m.role, parts: m.parts, metadata: m.metadata ?? undefined }) as UIMessage)
    : [];
  return (
    <div className="space-y-6">
      <h1 className="display text-4xl">Coach me</h1>
      <CoachChat
        key={active?.id ?? "new"}
        mode="self"
        personId=""
        personName="you"
        threadId={active?.id ?? null}
        initialMessages={messages}
        threads={threads.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
        canChat={keyCount > 0}
      />
    </div>
  );
}
