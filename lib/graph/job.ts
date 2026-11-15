import "server-only";
import { after } from "next/server";
import { db } from "../db";
import { getActiveKey, getChat, loadChat } from "../data";
import { encrypt } from "../crypto";
import { alive } from "../trash";
import { CHAR_BUDGET, embedModelFor } from "../ai/models";
import { cheapAsk, type Ask, type Key } from "../ai/cheap";
import { buildGraph } from "../graph";
import { linkMemories, loadGraphRows, mergeNodes, syncGraph } from "../graph-store";
import { acceptCategories, categoryAnswerSchema, categoryPrompt, needsCategory } from "./categories";
import { acceptTriples, backfillAnswerSchema, backfillPrompt, needsTriples } from "./backfill";
import { embedMissing } from "./vectors";
import { promoteMeEdges } from "../self/store";
import { consolidateSelf } from "../self/job";
import { acceptEvidence, chunk, evidenceAnswerSchema, evidenceItem, evidencePrompt, renderItem } from "./evidence";

/**
 * Background graph work, run after a response with Next `after()`: categories for new things, typed edges for
 * old memories, and the chat line (with its tone and date) behind each edge. One run per person at a time, capped per hour, always on the user's own key with the provider's
 * cheapest model. Every step is incremental and safe to cut off: what is not reached now is picked up next run.
 */

type Person = { id: string; name: string };

/** A crashed run frees the lock after this long. */
export const GRAPH_LOCK_MS = 90_000;
/** Cost cap: background graph runs per person per hour (each is a few cheap-model calls). */
export const GRAPH_RUNS_PER_HOUR = 20;
/** A run stops starting new steps after this long: `after()` shares the route's maxDuration. */
const JOB_MS = 45_000;
const CATEGORY_BATCH = 25, BACKFILL_BATCH = 15, EVIDENCE_BATCH = 30, EVIDENCE_RETRY = 60;

/** Same shape as claimModelRun (lib/model-lock.ts), on the graph columns. */
export async function claimGraphRun(personId: string, now = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + GRAPH_LOCK_MS);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const won = await db.$executeRaw`
    UPDATE "Person" SET
      "graphLockUntil" = ${until},
      "graphRuns" = CASE WHEN "graphRunsSince" > ${hourAgo} THEN "graphRuns" + 1 ELSE 1 END,
      "graphRunsSince" = CASE WHEN "graphRunsSince" > ${hourAgo} THEN "graphRunsSince" ELSE ${now} END
    WHERE id = ${personId}
      AND ("graphLockUntil" IS NULL OR "graphLockUntil" < ${now})
      AND NOT ("graphRunsSince" > ${hourAgo} AND "graphRuns" >= ${GRAPH_RUNS_PER_HOUR})`;
  return won > 0;
}

type Step = (person: Person, ask: Ask, key: Key) => Promise<void>;

/** New things with nothing above them get up to two narrow parents. Each node is asked about once. */
async function categorize(person: Person, ask: Ask) {
  const [{ nodes, edges }, pending] = await Promise.all([
    loadGraphRows(person.id),
    db.memoryNode.findMany({ where: { personId: person.id, kind: "thing", categorizedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  const open = new Set(pending.map((n) => n.id));
  const todo = needsCategory(nodes, edges, new Set(nodes.filter((n) => !open.has(n.id)).map((n) => n.id))).slice(0, CATEGORY_BATCH);
  if (!todo.length) return;
  const known = buildGraph(nodes, edges, []).known();
  const { items } = await ask(categoryAnswerSchema, categoryPrompt(todo.map((n) => n.label), known));
  // Answers come back by label; the nodes were asked by label.
  const byLabel = items.map((a) => ({ ...a, name: todo.find((n) => n.label.toLowerCase() === a.name.trim().toLowerCase())?.key ?? a.name }));
  const plan = acceptCategories(byLabel, todo, nodes, edges);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const merges = plan.merges.flatMap((m) => {
    const from = byKey.get(m.fromKey), to = byKey.get(m.toKey);
    return from && to ? [{ fromId: from.id, toId: to.id }] : [];
  });
  if (merges.length) await mergeNodes(person.id, merges); // sameAs: one node, the asked key kept as an alias
  if (plan.triples.length) await linkMemories(person, [{ factId: "", triples: plan.triples }]); // IS_A edges carry no memory
  const gone = new Set(merges.map((m) => m.fromId));
  const asked = todo.map((n) => n.id).filter((id) => !gone.has(id));
  if (asked.length) await db.memoryNode.updateMany({ where: { personId: person.id, id: { in: asked } }, data: { categorizedAt: new Date() } });
}

/** Older memories that only have MENTIONS edges gain typed ones. Walks forward from `graphFactsAt`. */
async function backfillTriples(person: Person, ask: Ask, key: Key) {
  const p = await db.person.findUnique({ where: { id: person.id }, select: { graphFactsAt: true } });
  const facts = await db.personFact.findMany({
    where: { personId: person.id, ...alive, ...(p?.graphFactsAt ? { createdAt: { gt: p.graphFactsAt } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, text: true, entities: true, createdAt: true, updatedAt: true },
  });
  if (!facts.length) return;
  const { nodes, edges } = await loadGraphRows(person.id);
  const open = needsTriples(facts, edges);
  // A batch ends on a createdAt boundary, so memories saved together are never split by the cursor.
  let n = Math.min(BACKFILL_BATCH, open.length);
  while (n > 0 && n < open.length && open[n].createdAt.getTime() === open[n - 1].createdAt.getTime()) n++;
  const todo = open.slice(0, n);
  const through = n < open.length ? todo[n - 1].createdAt : facts[facts.length - 1].createdAt;
  if (todo.length) {
    const { items } = await ask(backfillAnswerSchema, backfillPrompt(todo, person.name, buildGraph(nodes, edges, []).known()));
    const links = acceptTriples(items, todo);
    const { entities: linked } = await linkMemories(person, links, key);
    // The tag list cached on each memory follows the graph; updatedAt kept, since this is not an edit.
    const byId = new Map(todo.map((f) => [f.id, f]));
    const retag = links.filter((l) => (linked.get(l.factId) ?? l.tags).join("|") !== l.tags.join("|"));
    if (retag.length)
      await db.$transaction(retag.map((l) => db.personFact.update({ where: { id: l.factId }, data: { entities: linked.get(l.factId)!, updatedAt: byId.get(l.factId)!.updatedAt } })));
  }
  await db.person.update({ where: { id: person.id }, data: { graphFactsAt: through } });
}

/** The user's own edges (me LIKES x) join their profile, with any line just mined for them (lib/self). */
const promoteSelf: Step = async (person) => {
  const owner = await db.person.findUnique({ where: { id: person.id }, select: { userId: true } });
  if (owner) await promoteMeEdges(owner.userId, person);
};

/** Nodes without an embedding of this provider's model get one (nothing to do for providers that can't embed). */
const embedLabels: Step = (person, _ask, key) => embedMissing(person.id, key);

/**
 * Find the chat line behind each memory-backed edge, and how it was said. New edges are searched in the whole
 * chat, newest first; once none are left, edges still without a line are tried again in whatever the chat gained
 * since `graphThroughAt`. Prompts are cut to the provider's budget.
 */
async function mineEvidence(person: Person, ask: Ask, key: Key) {
  const [chat, p] = await Promise.all([getChat(person.id), db.person.findUnique({ where: { id: person.id }, select: { graphThroughAt: true } })]);
  if (!chat) return;
  const open = await db.memoryEdge.findMany({
    where: { personId: person.id, quoteCipher: null, fact: { ...alive } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fromId: true, toId: true, rel: true, label: true, factId: true, minedAt: true, fact: { select: { text: true } } },
  });
  const typedFirst = <T extends { rel: string }>(list: T[]) => [...list.filter((e) => e.rel !== "MENTIONS"), ...list.filter((e) => e.rel === "MENTIONS")];
  const fresh = typedFirst(open.filter((e) => !e.minedAt));
  const grown = !p?.graphThroughAt || chat.lastAt > p.graphThroughAt;
  const todo = fresh.length ? fresh.slice(0, EVIDENCE_BATCH) : grown && p?.graphThroughAt ? typedFirst(open).slice(0, EVIDENCE_RETRY) : [];
  if (todo.length) {
    const [msgs, nodes] = await Promise.all([loadChat(chat.cipher), db.memoryNode.findMany({ where: { personId: person.id }, select: { id: true, key: true, label: true, kind: true, aliases: true } })]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const name = (id: string) => (byId.get(id)?.key === "them" ? chat.theirName : byId.get(id)?.key === "me" ? chat.myName : byId.get(id)?.label ?? "?");
    const after = fresh.length ? 0 : p!.graphThroughAt!.getTime();
    const items = todo.flatMap((e) => evidenceItem(e, `${name(e.fromId)} ${e.rel}${e.label ? ` (${e.label})` : ""} ${name(e.toId)}. Memory: "${e.fact!.text.slice(0, 200)}"`, byId, msgs, after) ?? []);
    const found = [];
    // ponytail: a claim's block is rendered twice (once to size it); cache it if the batches ever get big.
    for (const group of chunk(items, (it) => renderItem(it, 1, msgs, chat.tzOffset).length, Math.min(24_000, CHAR_BUDGET[key.provider] * 0.4))) {
      const { items: answer } = await ask(evidenceAnswerSchema, evidencePrompt(group.map((it, i) => renderItem(it, i + 1, msgs, chat.tzOffset)), { me: chat.myName, them: chat.theirName }));
      found.push(...acceptEvidence(answer, group, msgs, chat.myName));
    }
    const now = new Date();
    await db.$transaction([
      ...found.map((f) => db.memoryEdge.update({ where: { id: f.edgeId }, data: { quoteCipher: encrypt(f.text), quoteTs: BigInt(f.ts), quoteSender: f.sender, at: new Date(f.ts), tone: f.tone, polarity: f.polarity, confidence: f.confidence } })),
      db.memoryEdge.updateMany({ where: { personId: person.id, id: { in: todo.map((e) => e.id) } }, data: { minedAt: now } }),
    ]);
    // Dates and tones just landed: what has been overtaken may have changed.
    await syncGraph(person);
  }
  // Only once no new edge is waiting: everything has now seen the chat up to its last message.
  if (fresh.length <= EVIDENCE_BATCH && grown) await db.person.update({ where: { id: person.id }, data: { graphThroughAt: chat.lastAt } });
}

/** Anything to do? Asked before claiming, so idle runs don't use up the hourly cap. */
async function hasWork(personId: string, key: Key) {
  const p = await db.person.findUnique({ where: { id: personId }, select: { graphFactsAt: true, graphThroughAt: true } });
  const model = embedModelFor(key.provider);
  const [nodes, facts, chat, unmined, unembedded] = await Promise.all([
    db.memoryNode.count({ where: { personId, kind: "thing", categorizedAt: null } }),
    db.personFact.count({ where: { personId, ...alive, ...(p?.graphFactsAt ? { createdAt: { gt: p.graphFactsAt } } : {}) } }),
    getChat(personId),
    db.memoryEdge.count({ where: { personId, quoteCipher: null, minedAt: null, fact: { ...alive } } }),
    model ? db.memoryNode.count({ where: { personId, kind: { notIn: ["them", "me"] }, OR: [{ embedModel: null }, { embedModel: { not: model } }] } }) : 0,
  ]);
  const evidence = !!chat && (unmined > 0 || !p?.graphThroughAt || chat.lastAt > p.graphThroughAt);
  return nodes + facts + unembedded > 0 || evidence;
}

export async function runGraphJob(person: Person, key: Key) {
  if (!(await hasWork(person.id, key)) || !(await claimGraphRun(person.id))) return;
  const until = Date.now() + JOB_MS;
  const ask = cheapAsk(key);
  try {
    // Typed edges first, so the evidence step has them to work on in the same run.
    for (const step of [backfillTriples, categorize, mineEvidence, embedLabels, promoteSelf] as Step[]) {
      if (Date.now() > until) break;
      // One step failing (a malformed answer, a rate limit) must not stop the others.
      await step(person, ask, key).catch((e) => console.error(`graph job: ${step.name} failed`, key.provider, (e as Error)?.message));
    }
  } finally {
    await db.person.update({ where: { id: person.id }, data: { graphLockUntil: null } }).catch(() => undefined);
  }
}

/** Run the graph job once the response has been sent. Call from a route handler or server action. */
export function scheduleGraphJob(userId: string, person: Person) {
  after(async () => {
    const key = await getActiveKey(userId);
    if (key) await runGraphJob({ id: person.id, name: person.name }, key);
    // The user's own profile next: whatever this person's reads and graph added to it is merged and summarised.
    await consolidateSelf(userId).catch((e) => console.error("self consolidation failed", (e as Error)?.message));
  });
}
