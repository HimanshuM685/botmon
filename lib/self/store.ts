import "server-only";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { alive } from "../trash";
import type { ChatVoices } from "../data";
import type { Voice } from "../voice";
import { mergeVoices } from "./voice";
import { ME_EDGE, meEdgeItem, rescope, stripNames, verifyItems, visible, type Item, type Verified } from "./traits";
import type { Msg } from "../parsers/types";
import type { Relation } from "@/generated/prisma/client";

/** A name the user picked as "me" in an upload, remembered so the next upload preselects it. */
export async function rememberSelfName(userId: string, name: string) {
  await db.$executeRaw`UPDATE "User" SET "selfNames" = array_append("selfNames", ${name}) WHERE "id" = ${userId} AND NOT (${name} = ANY("selfNames"))`;
}

/** Recompute the user's merged voice from the stored voice of every live chat, newest first. */
export async function refreshSelfVoice(userId: string) {
  const chats = await db.chatUpload.findMany({ where: { ...alive, voiceCipher: { not: null }, person: { userId, ...alive } }, orderBy: { lastAt: "desc" }, select: { voiceCipher: true } });
  const merged = mergeVoices(chats.map((c) => (JSON.parse(decrypt(c.voiceCipher!)) as ChatVoices).me));
  const voiceCipher = merged ? encrypt(JSON.stringify(merged)) : null;
  await db.selfProfile.upsert({ where: { userId }, create: { userId, voiceCipher }, update: { voiceCipher } });
}

/**
 * After a person or chat leaves, comes back or is purged: traits follow their evidence, and the merged voice drops
 * (or regains) that chat's real sample messages.
 */
export async function selfChanged(userId: string) {
  await recountTraits(userId);
  await refreshSelfVoice(userId);
}

/** Every name in the user's life that must never land in a trait: people, how they appear in chats, people in graphs. */
export async function allNames(userId: string) {
  const [people, chats, nodes] = await Promise.all([
    db.person.findMany({ where: { userId, deletedAt: undefined }, select: { name: true } }),
    db.chatUpload.findMany({ where: { deletedAt: undefined, person: { userId } }, select: { theirName: true } }),
    db.memoryNode.findMany({ where: { kind: "person", person: { userId } }, select: { label: true } }),
  ]);
  return [...people.map((p) => p.name), ...chats.map((c) => c.theirName), ...nodes.map((n) => n.label)];
}

/** The user's merged voice: for drafts to a person with no chat. Null until a chat was uploaded. */
export async function selfVoice(userId: string): Promise<Voice | null> {
  const p = await db.selfProfile.findUnique({ where: { userId }, select: { voiceCipher: true } });
  return p?.voiceCipher ? (JSON.parse(decrypt(p.voiceCipher)) as Voice) : null;
}

/* ---------- Traits ---------- */

type Source = "ANALYSIS" | "CHAPTER" | "COACH" | "GRAPH" | "USER";
type Refs = { chatId?: string; chapterId?: string; analysisId?: string };

/** Names that must never appear in a trait: the person's, how they appear in the chat, and people in their graph. */
export async function namesFor(person: { id: string; name: string }, theirName?: string) {
  const people = await db.memoryNode.findMany({ where: { personId: person.id, kind: "person" }, select: { label: true } });
  return [person.name, ...(theirName ? [theirName] : []), ...people.map((p) => p.label)];
}

/**
 * Store verified items (lib/self/traits.ts) as traits of the user, with the user's own line behind each,
 * encrypted. Repeat-safe: a trait is recognised by its key, a piece of evidence by (trait, person, line time).
 * A trait the user hid stays hidden.
 */
export async function ingestSelf(userId: string, person: { id: string }, items: Verified[], source: Source, refs: Refs = {}) {
  if (!items.length) return;
  const traits = await Promise.all(
    items.map((it) =>
      db.selfTrait.upsert({
        where: { userId_kind_key: { userId, kind: it.kind, key: it.key } },
        create: { userId, kind: it.kind, key: it.key, text: it.text, source },
        update: {},
        select: { id: true },
      }),
    ),
  );
  await db.selfEvidence.createMany({
    data: items.map((it, i) => ({
      traitId: traits[i].id, personId: person.id, ...refs,
      quoteCipher: it.line ? encrypt(it.line) : null, quoteTs: BigInt(it.ts), at: new Date(it.ts || Date.now()),
    })),
    skipDuplicates: true,
  });
  await recountTraits(userId, traits.map((t) => t.id));
}

/**
 * Bring traits in line with their evidence (lib/self/traits.ts rescope): after new evidence, a trashed or restored
 * person, a removed chat, a purge. `ids` absent: every trait of the user.
 */
export async function recountTraits(userId: string, ids?: string[]) {
  const traits = await db.selfTrait.findMany({
    where: { userId, deletedAt: undefined, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, source: true, scope: true, edited: true, pinned: true, confidence: true, noEvidence: true, evidence: { select: { personId: true, at: true, person: { select: { relation: true, deletedAt: true } } } } },
  });
  const ops = traits.map((t) => {
    const r = rescope(t, t.evidence.map((e) => ({ personId: e.personId, relation: e.person.relation, at: e.at, hidden: !!e.person.deletedAt })));
    if (r.action === "delete") return db.selfTrait.delete({ where: { id: t.id } });
    const { lastSeenAt, relation, ...data } = r.data;
    return db.selfTrait.update({ where: { id: t.id }, data: { ...data, relation: relation as Relation | null, ...(lastSeenAt ? { lastSeenAt } : {}) } });
  });
  if (ops.length) await db.$transaction(ops);
}

/**
 * What a read or chapter learned about the user, kept only when proven by one of the user's own lines in this
 * chat (lib/self/traits.ts verifyItems). Best-effort: a failure here never fails the read.
 */
export async function learnFromChat(userId: string, person: { id: string; name: string }, chat: { id: string; myName: string; theirName: string }, msgs: Msg[], items: Item[] | undefined, source: "ANALYSIS" | "CHAPTER", refs: Refs) {
  if (!items?.length) return;
  try {
    const verified = verifyItems(items, msgs, chat.myName, await namesFor(person, chat.theirName));
    await ingestSelf(userId, person, verified, source, { chatId: chat.id, ...refs });
  } catch (e) {
    console.error("self profile not updated", (e as Error)?.message);
  }
}

/**
 * The user's own edges in a person's graph (me LIKES / WANTS / DISLIKES / FEARS x) as traits. A line already
 * mined for the edge and sent by the user is reused as evidence, still encrypted.
 */
export async function promoteMeEdges(userId: string, person: { id: string; name: string }) {
  const edges = await db.memoryEdge.findMany({
    where: { personId: person.id, rel: { in: Object.keys(ME_EDGE) }, supersededById: null, from: { key: "me" }, to: { kind: { not: "person" } }, fact: { deletedAt: null } },
    select: { rel: true, createdAt: true, quoteCipher: true, quoteTs: true, quoteSender: true, to: { select: { label: true } }, fact: { select: { happenedAt: true } } },
  });
  const names = await namesFor(person);
  const items = edges.flatMap((e) => {
    const it = meEdgeItem(e.rel, stripNames(e.to.label, names));
    if (!it || it.key.replace(/\bthem\b/g, "").trim().length < 3) return [];
    const mine = e.quoteSender === "me" && e.quoteCipher && e.quoteTs;
    const ts = mine ? Number(e.quoteTs) : (e.fact?.happenedAt ?? e.createdAt).getTime();
    return [{ it: { ...it, ts }, cipher: mine ? e.quoteCipher : null }];
  });
  if (!items.length) return;
  // One upsert per trait: two edges saying the same thing would race on the unique key.
  const unique = [...new Map(items.map(({ it }) => [`${it.kind}|${it.key}`, it])).values()];
  const ids = new Map<string, string>();
  for (const it of unique) {
    const t = await db.selfTrait.upsert({ where: { userId_kind_key: { userId, kind: it.kind, key: it.key } }, create: { userId, kind: it.kind, key: it.key, text: it.text, source: "GRAPH" }, update: {}, select: { id: true } });
    ids.set(`${it.kind}|${it.key}`, t.id);
  }
  await db.selfEvidence.createMany({ data: items.map(({ it, cipher }) => ({ traitId: ids.get(`${it.kind}|${it.key}`)!, personId: person.id, quoteCipher: cipher, quoteTs: BigInt(it.ts), at: new Date(it.ts) })), skipDuplicates: true });
  await recountTraits(userId, [...ids.values()]);
}

/** The user's visible traits and summary, for prompts and common ground. */
export async function loadSelf(userId: string) {
  const [profile, traits] = await Promise.all([
    db.selfProfile.findUnique({ where: { userId }, select: { summary: true } }),
    db.selfTrait.findMany({ where: { userId }, orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }], take: 300, select: { kind: true, text: true, scope: true, relation: true, people: true, support: true, confidence: true, noEvidence: true, source: true, edited: true, pinned: true } }),
  ]);
  return { summary: profile?.summary ?? null, traits: traits.filter(visible) };
}
