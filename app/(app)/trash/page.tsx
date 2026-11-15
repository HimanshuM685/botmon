import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { daysLeft, purgeCutoff, TRASH_DAYS } from "@/lib/trash";
import { RestoreButton } from "@/components/restore-button";

export const metadata = { title: "Trash" };

type Row = { kind: "person" | "chat" | "analysis" | "thread" | "fact" | "trait"; id: string; label: string; sub: string; deletedAt: Date };

export default async function Trash() {
  const user = await requireUser();
  // Past-window items wait for the next `npm run purge`; just don't list them.
  const deleted = { not: null, gte: purgeCutoff() };
  const mine = { person: { userId: user.id } };
  const [people, chats, analyses, threads, facts, traits] = await Promise.all([
    db.person.findMany({ where: { userId: user.id, deletedAt: deleted }, select: { id: true, name: true, deletedAt: true } }),
    db.chatUpload.findMany({ where: { ...mine, deletedAt: deleted }, select: { id: true, msgCount: true, lastAt: true, deletedAt: true, person: { select: { name: true } } } }),
    db.analysis.findMany({ where: { ...mine, deletedAt: deleted }, select: { id: true, createdAt: true, deletedAt: true, person: { select: { name: true } } } }),
    db.coachThread.findMany({ where: { OR: [mine, { userId: user.id }], deletedAt: deleted }, select: { id: true, title: true, deletedAt: true, person: { select: { name: true } } } }),
    db.personFact.findMany({ where: { ...mine, deletedAt: deleted }, select: { id: true, text: true, deletedAt: true, person: { select: { name: true } } } }),
    db.selfTrait.findMany({ where: { userId: user.id, deletedAt: deleted }, select: { id: true, text: true, deletedAt: true } }),
  ]);

  const rows: Row[] = [
    ...people.map((p) => ({ kind: "person" as const, id: p.id, label: p.name, sub: "Person, with all their chats, reads, coach talks and timeline", deletedAt: p.deletedAt! })),
    ...chats.map((c) => ({ kind: "chat" as const, id: c.id, label: `${c.msgCount.toLocaleString()} messages up to ${c.lastAt.toLocaleDateString()}`, sub: `Chat · ${c.person.name}`, deletedAt: c.deletedAt! })),
    ...analyses.map((a) => ({ kind: "analysis" as const, id: a.id, label: `Read from ${a.createdAt.toLocaleString()}`, sub: `Read · ${a.person.name}`, deletedAt: a.deletedAt! })),
    ...threads.map((t) => ({ kind: "thread" as const, id: t.id, label: t.title, sub: t.person ? `Coach conversation · ${t.person.name}` : "Coach me conversation", deletedAt: t.deletedAt! })),
    ...traits.map((t) => ({ kind: "trait" as const, id: t.id, label: t.text, sub: "About you", deletedAt: t.deletedAt! })),
    ...facts.map((f) => ({ kind: "fact" as const, id: f.id, label: f.text, sub: `Timeline · ${f.person.name}`, deletedAt: f.deletedAt! })),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  return (
    <div className="space-y-8">
      <div>
        <h1 className="display text-4xl">Trash</h1>
        <p className="mt-2 text-muted">Deleted things stay here for {TRASH_DAYS} days, then they&apos;re erased for good.</p>
      </div>
      {rows.length === 0 ? (
        <p className="card p-10 text-center text-muted">Trash is empty.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center gap-4 px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.label}</p>
                <p className="text-xs text-dim">{r.sub}</p>
              </div>
              <span className="text-xs text-amber">{daysLeft(r.deletedAt)} days left</span>
              <RestoreButton kind={r.kind} id={r.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
