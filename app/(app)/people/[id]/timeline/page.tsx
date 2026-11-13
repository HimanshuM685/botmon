import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getPerson } from "@/lib/data";
import { alive } from "@/lib/trash";
import { Timeline } from "@/components/timeline";

export const metadata = { title: "Timeline" };

export default async function TimelinePage({ params }: PageProps<"/people/[id]/timeline">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();
  const [facts, links] = await Promise.all([
    db.personFact.findMany({
      where: { personId: person.id, ...alive },
      orderBy: [{ happenedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }),
    db.memoryLink.findMany({ where: { from: { personId: person.id, ...alive }, to: { ...alive } }, select: { fromId: true, toId: true, kind: true } }),
  ]);
  return (
    <Timeline
      personId={person.id}
      personName={person.name}
      links={links}
      facts={facts.map((f) => ({ id: f.id, kind: f.kind, text: f.text, source: f.source, entities: f.entities, happenedAt: f.happenedAt?.toISOString().slice(0, 10) ?? null, createdAt: f.createdAt.toISOString() }))}
    />
  );
}
