import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getPerson } from "@/lib/data";
import { activityWindows, type ChatStats } from "@/lib/stats";
import { RELATIONS } from "@/lib/labels";
import { deletePerson } from "@/app/actions";
import { ChatUploader } from "@/components/chat-uploader";
import { AnalysisView } from "@/components/analysis-view";
import { ConfirmButton } from "@/components/confirm-button";
import { EditPerson } from "@/components/edit-person";
import type { Analysis } from "@/lib/ai/schema";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();

  const [chat, analyses, keyCount] = await Promise.all([
    db.chatUpload.findFirst({ where: { personId: person.id }, orderBy: { createdAt: "desc" }, omit: { cipher: true } }),
    db.analysis.findMany({ where: { personId: person.id, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.apiKey.count({ where: { userId: user.id } }),
  ]);
  const stats = chat ? (chat.stats as unknown as ChatStats) : null;
  const recent = stats ? activityWindows(stats) : null;
  const pronoun = person.gender === "FEMALE" ? "She" : person.gender === "MALE" ? "He" : "They";

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <span className="chip">{RELATIONS[person.relation]}</span>
          <h1 className="display mt-3 text-5xl">{person.name}</h1>
        </div>
        <EditPerson person={person} />
        <ConfirmButton action={deletePerson.bind(null, person.id)} confirm={`Delete ${person.name} and all their chats and analyses?`} className="btn-danger h-9 px-4">
          Delete
        </ConfirmButton>
      </header>

      {chat && stats && recent && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {chat.source === "INSTAGRAM" ? "Instagram" : "WhatsApp"} chat · {chat.msgCount.toLocaleString()} messages ·{" "}
              {chat.firstAt.toLocaleDateString()} – {chat.lastAt.toLocaleDateString()}
            </p>
            <ChatUploader personId={person.id} personName={person.name} hasChat />
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-4">
            <Stat label={`${pronoun} starts`} value={`${stats.theyInitiatePct}%`} hint="of conversations" />
            <Stat label="Message split" value={`${Math.round((stats.theirs / Math.max(1, stats.total)) * 100)}%`} hint={`from ${person.name.split(" ")[0]}`} />
            <Stat label={`${pronoun} replies in`} value={fmtMin(stats.theirMedianReplyMin)} hint={`you: ${fmtMin(stats.myMedianReplyMin)}`} />
            {recent.daysSinceLast > 30 ? (
              <Stat label="Last message" value={`${recent.daysSinceLast}d`} hint="ago · upload a newer export" />
            ) : (
              <Stat label="Last 30 days" value={recent.last30.toLocaleString()} hint={trend(recent.last30, recent.prev30)} />
            )}
          </dl>
        </section>
      )}
      {!chat && <ChatUploader personId={person.id} personName={person.name} hasChat={false} />}

      {!keyCount && <p className="card p-5 text-sm text-amber">Add an AI key in Settings to run analyses.</p>}

      <AnalysisView
        personId={person.id}
        canRun={!!chat && keyCount > 0}
        history={analyses.map((a) => ({ id: a.id, createdAt: a.createdAt.toISOString(), model: a.model, result: a.result as Analysis }))}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-ink-2 p-5">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="display mt-2 text-3xl">{value}</dd>
      <dd className="mt-1 text-xs text-dim">{hint}</dd>
    </div>
  );
}

const fmtMin = (m: number | null) => (m == null ? "—" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);

function trend(now: number, before: number) {
  if (!before) return "messages from them";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "same as before" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs prior 30d`;
}
