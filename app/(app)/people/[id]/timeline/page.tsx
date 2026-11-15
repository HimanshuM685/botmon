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
  const [facts, links, edges] = await Promise.all([
    db.personFact.findMany({
      where: { personId: person.id, ...alive },
      orderBy: [{ happenedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }),
    // From live memories to anything: a correction links the new truth to the memory it retired (now in the trash).
    db.memoryLink.findMany({
      where: { from: { personId: person.id, ...alive } },
      select: { fromId: true, toId: true, kind: true, to: { select: { text: true, deletedAt: true } } },
    }),
    // Graph edges between two things (cheese IS_A milk product), not the ones from the person: drawn between topics on the map.
    db.memoryEdge.findMany({
      where: { personId: person.id, from: { kind: { notIn: ["them", "me"] } }, to: { kind: { notIn: ["them", "me"] } }, OR: [{ factId: null }, { fact: { ...alive } }] },
      select: { rel: true, label: true, from: { select: { key: true } }, to: { select: { key: true } } },
    }),
  ]);
  const replaced: Record<string, string> = {};
  for (const l of links) if (l.kind === "updates" && l.to.deletedAt) replaced[l.fromId] = l.to.text;
  return (
    <Timeline
      personId={person.id}
      personName={person.name}
      links={links.filter((l) => !l.to.deletedAt).map(({ fromId, toId, kind }) => ({ fromId, toId, kind }))}
      replaced={replaced}
      relations={edges.map((e) => ({ from: e.from.key, to: e.to.key, rel: e.label ? `${e.rel} (${e.label})` : e.rel }))}
      facts={facts.map((f) => ({ id: f.id, kind: f.kind, text: f.text, source: f.source, entities: f.entities, feeling: f.feeling, valence: f.valence, happenedAt: f.happenedAt?.toISOString().slice(0, 10) ?? null, createdAt: f.createdAt.toISOString() }))}
    />
  );
}
