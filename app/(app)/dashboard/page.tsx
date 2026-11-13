import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { MAX_PEOPLE } from "@/lib/data";
import { RELATIONS, timeAgo } from "@/lib/labels";
import { PersonForm } from "@/components/person-form";
import type { Analysis } from "@/lib/ai/schema";

export const metadata = { title: "Your people" };

export default async function Dashboard() {
  const user = await requireUser();
  const [keyCount, people] = await Promise.all([
    db.apiKey.count({ where: { userId: user.id } }),
    db.person.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: {
        chats: { select: { msgCount: true, lastAt: true }, take: 1 },
        analyses: { select: { result: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);
  if (!keyCount) redirect("/onboarding");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="display text-4xl">Hey {user.name.split(" ")[0] || "there"}.</h1>
        <p className="mt-2 text-muted">{people.length ? "Who are we reading today?" : "Add the first person you want to understand better."}</p>
      </div>

      {people.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => {
            const a = p.analyses[0]?.result as Analysis | undefined;
            const chat = p.chats[0];
            return (
              <Link key={p.id} href={`/people/${p.id}`} className="card group p-6 transition hover:border-heart/50 hover:bg-ink-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="display text-2xl">{p.name}</h2>
                    <span className="chip mt-2">{RELATIONS[p.relation]}</span>
                  </div>
                  {a && <span className="display text-4xl text-heart">{a.status.score}</span>}
                </div>
                <p className="mt-6 text-sm text-muted">
                  {a ? <em className="display text-base text-paper">{a.status.label}</em> : chat ? "Chat uploaded. Ready to analyze." : "No chat yet"}
                </p>
                <p className="mt-1 text-xs text-dim">
                  {chat ? `${chat.msgCount.toLocaleString()} messages` : "Upload a WhatsApp or Instagram export"}
                  {p.analyses[0] && ` · read ${timeAgo(p.analyses[0].createdAt)}`}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {people.length < MAX_PEOPLE ? (
        <section className="card p-6 sm:p-8">
          <h2 className="display text-2xl">Add a person</h2>
          <p className="mb-6 mt-1 text-sm text-muted">{MAX_PEOPLE - people.length} of {MAX_PEOPLE} slots left.</p>
          <PersonForm />
        </section>
      ) : (
        <p className="text-sm text-dim">You&apos;re tracking {MAX_PEOPLE} people, the max. Delete one to add someone new.</p>
      )}
    </div>
  );
}
