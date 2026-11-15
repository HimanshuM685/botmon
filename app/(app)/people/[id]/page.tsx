import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { alive } from "@/lib/trash";
import { Prisma } from "@/generated/prisma/client";
import { currentContextHash, getChatStats, getPerson } from "@/lib/data";
import { adviceStale } from "@/lib/context";
import { enoughMemory } from "@/lib/model";
import { activityWindows } from "@/lib/stats";
import { ChatUploader } from "@/components/chat-uploader";
import { ChatActions } from "@/components/chat-actions";
import { AnalysisView, type ReadState } from "@/components/analysis-view";
import type { Analysis } from "@/lib/ai/schema";
import { pickBaseline } from "@/lib/goals";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();

  const reads = { where: { personId: person.id, ...alive, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" } } as const;
  const [chat, analyses, others, keyCount, context, factCount, goals, me] = await Promise.all([
    db.chatUpload.findFirst({ where: { personId: person.id, ...alive }, orderBy: { createdAt: "desc" }, omit: { cipher: true } }),
    db.analysis.findMany({ ...reads, take: 10, select: { id: true, createdAt: true, model: true, mode: true } }),
    db.person.findMany({ where: { userId: user.id, ...alive, NOT: { id: person.id } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    db.apiKey.count({ where: { userId: user.id } }),
    currentContextHash(person),
    db.personFact.count({ where: { personId: person.id, ...alive } }),
    db.scoreGoal.findMany({ where: { personId: person.id, ...alive }, orderBy: { fromAt: "asc" }, select: { id: true, signal: true, fromLevel: true, fromAt: true, toLevel: true, achievedAt: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { selfNames: true } }),
  ]);
  const selfNames = me?.selfNames ?? [];
  // Only the latest read travels in full; older ones load when picked (loadRead in app/actions.ts).
  // Loaded by the id at the top of the list, so the list and the read shown can never disagree.
  const last = analyses[0] ? await db.analysis.findFirst({ where: { ...reads.where, id: analyses[0].id } }) : null;
  // Growth: the newest read's scores against an earlier one, about a month back (lib/goals.ts pickBaseline).
  // Only dates are loaded for all reads; the one picked is loaded in full.
  const pickedBase = last
    ? pickBaseline((await db.analysis.findMany({ where: { ...reads.where, NOT: { id: last.id } }, select: { id: true, createdAt: true } })).map((r) => ({ at: r.createdAt, signals: null, id: r.id })), last.createdAt)
    : undefined;
  const baseRead = pickedBase ? await db.analysis.findFirst({ where: { ...reads.where, id: (pickedBase as { id: string }).id }, select: { createdAt: true, result: true } }) : null;
  const stats = chat ? await getChatStats(chat) : null;
  const recent = stats ? activityWindows(stats) : null;
  const readState: ReadState = !last || !chat
    ? "none"
    : last.chatId !== chat.id || !last.throughAt
      ? "changed"
      : chat.lastAt > last.throughAt ? "update" : "current";
  const pronoun = person.gender === "FEMALE" ? "She" : person.gender === "MALE" ? "He" : "They";

  return (
    <div className="space-y-10">

      {!chat && <ChatUploader selfNames={selfNames} personId={person.id} personName={person.name} existing={null} />}

      {!keyCount && <p className="card p-5 text-sm text-amber">Add an AI key in Settings to run reads and talk to the coach.</p>}

      <AnalysisView
        personId={person.id}
        state={readState}
        hasChat={!!chat}
        readingInBackground={!!chat?.readMode}
        readFailed={chat?.readMode ? null : chat?.readError ?? null}
        canRun={!!chat && keyCount > 0}
        canSync={keyCount > 0}
        advice={{ stale: last ? adviceStale(last, context) : !chat && enoughMemory(factCount, person.notes), key: context, at: last?.adviceAt?.toISOString() }}
        chatNumbers={stats && recent ? [
          { label: `${pronoun} starts`, value: `${stats.theyInitiatePct}%`, hint: "of conversations" },
          { label: "Message split", value: `${Math.round((stats.theirs / Math.max(1, stats.total)) * 100)}%`, hint: `from ${person.name.split(" ")[0]}` },
          { label: `${pronoun} replies in`, value: fmtMin(stats.theirMedianReplyMin), hint: `you: ${fmtMin(stats.myMedianReplyMin)}` },
          recent.daysSinceLast > 30
            ? { label: "Last message", value: `${recent.daysSinceLast}d`, hint: "ago · upload a newer export" }
            : { label: "Last 30 days", value: recent.last30.toLocaleString(), hint: trend(recent.last30, recent.prev30) },
        ] : undefined}
        compareWith={baseRead ? { at: baseRead.createdAt.toISOString(), signals: (baseRead.result as Analysis | null)?.signals ?? null } : undefined}
        goals={goals.map((g) => ({ ...g, fromAt: g.fromAt.toISOString(), achievedAt: g.achievedAt?.toISOString() ?? null }))}
        history={analyses.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), result: a.id === last?.id ? (last.result as Analysis) : undefined }))}
      />

      {chat && (
        <section className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
          <p className="mr-auto text-sm text-muted">
            {chat.source === "INSTAGRAM" ? "Instagram" : "WhatsApp"} chat with <strong className="text-paper">{chat.theirName}</strong> · {chat.msgCount.toLocaleString()} messages ·{" "}
            {chat.firstAt.toLocaleDateString()} – {chat.lastAt.toLocaleDateString()}
          </p>
          <ChatActions chatId={chat.id} chatWith={chat.theirName} personName={person.name} others={others} />
          <ChatUploader selfNames={selfNames} personId={person.id} personName={person.name} existing={{ myName: chat.myName, theirName: chat.theirName, lastAt: chat.lastAt.getTime() }} />
        </section>
      )}
    </div>
  );
}

const fmtMin = (m: number | null) => (m == null ? "—" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);

function trend(now: number, before: number) {
  if (!before) return "messages from them";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "same as before" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs prior 30d`;
}
