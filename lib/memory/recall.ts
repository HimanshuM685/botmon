import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { embed } from "../graph/vectors";
import { embedModelFor, type ProviderId } from "../ai/models";
import { chatLine } from "../chat-lines";
import { alive } from "../trash";
import { episodeLines, EMBED_DIMS } from "./episodes";
import { fuse, queryTerms, wordsOf } from "./split";

/**
 * Total recall, asked: everything remembered about something, however long ago or casually it was said. Three
 * searches at once, fused by rank (lib/memory/split.ts fuse):
 * - by meaning over every sitting of the chat (finds "wonton" for "what food does she like"), where the key embeds;
 * - by words over every sitting (blind keyword index), for exact names, places and things;
 * - the memories on the timeline that mention it, strongest (said most often) first.
 */

type Key = { provider: ProviderId; apiKey: string };

const SITTINGS = 6;
const FACTS = 12;

const literal = (v: number[]) => `[${v.join(",")}]`;

async function byWords(chatId: string, query: string): Promise<string[]> {
  const words = queryTerms(query);
  if (!words.length) return [];
  // One point per asked word found (in any of its forms): sittings with more of them first, then newer.
  const hits = Prisma.join(words.map((alts) => Prisma.sql`("terms" && ${alts}::int[])::int`), " + ");
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ChatEpisode" WHERE "chatId" = ${chatId} AND "terms" && ${words.flat()}::int[]
    ORDER BY (${hits}) DESC, "toTs" DESC LIMIT 20`;
  return rows.map((r) => r.id);
}

async function byMeaning(chatId: string, query: string, key: Key): Promise<string[]> {
  const model = embedModelFor(key.provider);
  if (!model) return [];
  const [v] = (await embed(key, [query], { dims: EMBED_DIMS })) ?? [];
  if (!v) return [];
  // Exact cosine over one chat's sittings (~20k at most): no index needed, nothing approximate.
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ChatEpisode" WHERE "chatId" = ${chatId} AND "embedModel" = ${model} AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${literal(v)}::vector LIMIT 20`;
  return rows.map((r) => r.id);
}

/** Timeline memories mentioning any asked word, strongest and most recently said first. */
async function memories(personId: string, query: string) {
  const words = [...new Set(wordsOf(query))].filter((w) => w.length >= 3).slice(0, 8);
  if (!words.length) return [];
  return db.personFact.findMany({
    where: { personId, ...alive, OR: words.map((w) => ({ text: { contains: w, mode: "insensitive" as const } })) },
    orderBy: [{ mentions: "desc" }, { lastSeenAt: { sort: "desc", nulls: "last" } }],
    take: FACTS,
    select: { text: true, kind: true, happenedAt: true, saidAt: true, mentions: true },
  });
}

/** The recall as text for the model: memories, then the chat sittings behind the answer with their dates. */
export async function recallMemory(personId: string, query: string, key: Key | null, tz: number): Promise<string> {
  const chat = await db.chatUpload.findFirst({ where: { personId, ...alive }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const [facts, words, meaning] = await Promise.all([
    memories(personId, query),
    chat ? byWords(chat.id, query) : [],
    chat && key ? byMeaning(chat.id, query, key).catch(() => []) : [],
  ]);
  const top = fuse([meaning, words]).slice(0, SITTINGS).map((x) => x.id);
  const rows = top.length ? await db.chatEpisode.findMany({ where: { id: { in: top } }, select: { id: true, cipher: true } }) : [];
  const asked = new Set(wordsOf(query));
  const sittings = top.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return [];
    const lines = episodeLines(r.cipher);
    // Long sittings: the lines around the words asked about, not all forty.
    const hit = lines.findIndex((m) => wordsOf(m.text).some((w) => asked.has(w)));
    const from = hit < 0 ? 0 : Math.max(0, hit - 6);
    return [lines.slice(from, from + 14).map((m) => chatLine(m, tz)).join("\n")];
  });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const out = [
    facts.length
      ? `Memories:\n${facts.map((f) => `- [${f.kind.toLowerCase()}${f.happenedAt ? ` ${day(f.happenedAt)}` : ""}] ${f.text}${f.saidAt ? ` (said ${day(f.saidAt)}` : " ("}${f.mentions > 1 ? `${f.saidAt ? ", " : ""}came up ${f.mentions} times` : ""})`.replace(" ()", "")).join("\n")}`
      : "",
    sittings.length ? `From the chat (${meaning.length ? "by meaning and words" : "by words"}):\n${sittings.join("\n--\n")}` : "",
  ].filter(Boolean);
  return out.length ? out.join("\n\n") : "Nothing in memory or the chat about that.";
}
