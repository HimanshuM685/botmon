import "server-only";
import { generateText, Output } from "ai";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { embed } from "../graph/vectors";
import { embedModelFor, CHEAP_MODEL, type ProviderId } from "../ai/models";
import { getModel } from "../ai/provider";
import { seedFor } from "../ai/stream";
import { buildDetailPrompt, type RelationId } from "../ai/prompt";
import { detailSchema, type DetailResult } from "../ai/schema";
import { factsFromAnalysis, newFacts, normalizeFact } from "../facts";
import { loadGraph, saveMemories } from "../graph-store";
import { alive } from "../trash";
import type { Msg } from "../parsers/types";
import { splitEpisodes, termsOf, type EpisodeRange } from "./split";

/**
 * Total recall, stored (lib/memory/split.ts is the pure part). Three kinds of work, each incremental and safe to cut
 * off, run as steps of the background read (lib/read/job.ts) before its chapters:
 * - sync: the chat's sittings match its messages (new ones added, changed ones rebuilt), with their word hashes;
 * - details: each sitting is read once by the detail pass, so every small thing said lands on the timeline;
 * - embed: each sitting gets a meaning vector, where the user's key can embed.
 */

type Key = { provider: ProviderId; apiKey: string; model: string };
type Person = { id: string; name: string; relation: string; gender: string };
type Chat = { id: string; myName: string; theirName: string; tzOffset: number };

/** Sittings written per step: a 5-lakh-message chat (~20k sittings) is stored in a few steps. */
const SYNC_BATCH = 4_000;
/**
 * Chars of chat per detail call: small enough that nothing gets skimmed (about 5k tokens on a cheap model).
 * ponytail: at 5 lakh messages that is ~1,800 calls; 24 a step, 6 at once, so ~75 steps (a few hours on a paid key,
 * days on a free one). Raise DETAIL_PARALLEL for keys with high limits if it needs to go faster.
 */
export const DETAIL_CHARS = 20_000;
/** Detail calls at once within a step. Rate limits are the provider's to say; the job waits them out. */
const DETAIL_PARALLEL = 6;
/** Detail calls per step. */
const DETAIL_CALLS = 24;
/** Sittings embedded per call (NIM takes smaller batches), and calls per step. */
const embedBatch = (p: ProviderId) => (p === "NIM" ? 32 : 96);
const EMBED_CALLS = 8;
/**
 * Numbers per sitting vector where the model can shorten it (Gemini, OpenAI): plenty for finding a sitting, and small
 * to store (~20k per chat). NIM's model can't, and keeps its own size; vectors are only compared within one model.
 */
export const EMBED_DIMS = 256;

/** Where the chat's sittings stand: what is left of each kind of work. */
export async function memoryWork(chatId: string, key: { provider: ProviderId }) {
  const model = embedModelFor(key.provider);
  const [total, detailsLeft, embedLeft] = await Promise.all([
    db.chatEpisode.count({ where: { chatId } }),
    db.chatEpisode.count({ where: { chatId, detailsAt: null } }),
    model ? db.chatEpisode.count({ where: { chatId, OR: [{ embedModel: null }, { embedModel: { not: model } }] } }) : 0,
  ]);
  return { total, detailsLeft, embedLeft };
}

/**
 * Make the stored sittings match the messages. Sittings are greedy from the start, so they match up to the first one
 * that differs (older messages filled in, or the open last sitting grown): from there on they are rebuilt.
 * Returns false when there is more to write than one step does.
 */
export async function syncEpisodes(chat: { id: string }, msgs: Msg[]): Promise<boolean> {
  const want = splitEpisodes(msgs);
  const have = await db.chatEpisode.findMany({ where: { chatId: chat.id }, orderBy: { fromTs: "asc" }, select: { id: true, fromTs: true, toTs: true, msgCount: true } });
  let same = 0;
  while (same < have.length && same < want.length && have[same].fromTs.getTime() === want[same].fromTs && have[same].toTs.getTime() === want[same].toTs && have[same].msgCount === want[same].msgCount) same++;
  if (have.length > same) await db.chatEpisode.deleteMany({ where: { chatId: chat.id, id: { in: have.slice(same).map((e) => e.id) } } });
  const todo = want.slice(same, same + SYNC_BATCH);
  for (let i = 0; i < todo.length; i += 500)
    await db.chatEpisode.createMany({ data: todo.slice(i, i + 500).map((e) => row(chat.id, e, msgs)) });
  return same + todo.length >= want.length;
}

function row(chatId: string, e: EpisodeRange, msgs: Msg[]) {
  const lines = msgs.slice(e.start, e.start + e.msgCount);
  return {
    chatId, fromTs: new Date(e.fromTs), toTs: new Date(e.toTs), msgCount: e.msgCount, chars: e.chars,
    cipher: encrypt(JSON.stringify(lines)),
    terms: termsOf(lines.map((m) => m.text).join("\n")),
  };
}

export const episodeLines = (cipher: string) => JSON.parse(decrypt(cipher)) as Msg[];

/** The next unread sittings, grouped into detail calls of about DETAIL_CHARS each. */
async function nextDetailBatches(chatId: string) {
  const rows = await db.chatEpisode.findMany({ where: { chatId, detailsAt: null }, orderBy: { fromTs: "asc" }, take: 1_000, select: { id: true, chars: true, cipher: true } });
  const batches: (typeof rows)[] = [];
  let cur: typeof rows = [], size = 0;
  for (const r of rows) {
    if (cur.length && size + r.chars > DETAIL_CHARS) {
      batches.push(cur);
      if (batches.length >= DETAIL_CALLS) break;
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += r.chars;
  }
  if (cur.length && batches.length < DETAIL_CALLS) batches.push(cur);
  return batches;
}

/**
 * The detail pass: a few calls' worth of unread sittings, read on the provider's cheapest model, every concrete thing
 * about the person saved as a memory pointing at its sitting and line. Said again later: the memory is reinforced
 * (mentions, lastSeenAt), not repeated. Calls that worked are saved even when another failed; the failure is then
 * thrown so the job can wait and retry the rest.
 */
export async function readDetails(person: Person, chat: Chat, key: Key, opts: { signal?: AbortSignal; temperature?: number; stillHere: () => Promise<boolean> }) {
  const batches = await nextDetailBatches(chat.id);
  if (!batches.length) return 0;
  const facts = await db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, select: { id: true, kind: true, text: true, happenedAt: true, deletedAt: true, mentions: true, lastSeenAt: true, updatedAt: true } });
  const known = (await loadGraph(person, facts.filter((f) => !f.deletedAt))).known();
  const who = { personName: person.name, relation: person.relation as RelationId, gender: person.gender, myName: chat.myName, theirName: chat.theirName };
  const model = (name: string) => getModel(key.provider, key.apiKey, name);

  const ask = async (batch: (typeof batches)[number]) => {
    const parts = batch.map((e) => ({ id: e.id, lines: episodeLines(e.cipher) }));
    const lines = parts.flatMap((p) => p.lines.map((m) => ({ m, episodeId: p.id })));
    const call = (name: string) =>
      generateText({
        model: model(name),
        prompt: buildDetailPrompt({ ...who, tzOffsetMin: chat.tzOffset, lines: lines.map((l) => l.m), known }),
        output: Output.object({ schema: detailSchema }),
        temperature: opts.temperature ?? 0,
        seed: seedFor(`${chat.id}:detail:${batch[0].id}`),
        maxRetries: 3,
        abortSignal: opts.signal,
      });
    // The cheapest model first. Busy, rate-limited, not on this key or out of credits: the user's own model instead
    // (the one their reads already work on). Not when the step itself ran out of time.
    let output;
    try {
      ({ output } = await call(CHEAP_MODEL[key.provider]));
    } catch (e) {
      if (CHEAP_MODEL[key.provider] === key.model || opts.signal?.aborted) throw e;
      ({ output } = await call(key.model));
    }
    return { batch, lines, output };
  };

  // A few at a time; each finished call is saved before the next group starts.
  let saved = 0, failure: unknown = null;
  for (let i = 0; i < batches.length && !failure; i += DETAIL_PARALLEL) {
    const done = await Promise.allSettled(batches.slice(i, i + DETAIL_PARALLEL).map(ask));
    if (!(await opts.stillHere())) return saved;
    for (const d of done) {
      if (d.status === "rejected") {
        failure ??= d.reason;
        continue;
      }
      await saveDetails(person, chat, key, facts, d.value.lines, d.value.output.details);
      await db.chatEpisode.updateMany({ where: { id: { in: d.value.batch.map((e) => e.id) } }, data: { detailsAt: new Date() } });
      saved += d.value.batch.length;
    }
  }
  if (failure) throw failure;
  return saved;
}

type Known = { id: string; text: string; deletedAt: Date | null; mentions: number; lastSeenAt: Date | null; updatedAt: Date | null };

async function saveDetails(person: Person, chat: Chat, key: Key, facts: Known[], lines: { m: Msg; episodeId: string }[], details: DetailResult["details"]) {
  const found = factsFromAnalysis({ keyFacts: details });
  const at = (i: number) => lines[Math.min(lines.length - 1, Math.max(0, (details[i]?.line ?? 1) - 1))];
  const byText = new Map(facts.map((f) => [normalizeFact(f.text), f]));
  // Said again later in the chat: the memory gets stronger (deleted ones stay deleted: the user said no). Only lines
  // after its last sighting count: a sitting read again (rebuilt after a merge) repeats what was counted already, and
  // the first sighting of a memory from a chapter or read only dates it (that was the same mention).
  const again = found.flatMap((f, i) => {
    const old = byText.get(normalizeFact(f.text));
    return old && old.id && !old.deletedAt ? [{ old, ts: at(i).m.ts }] : [];
  });
  const updates = again.flatMap(({ old, ts }) => {
    const last = old.lastSeenAt?.getTime();
    if (last !== undefined && ts <= last) return [];
    if (last !== undefined) old.mentions += 1;
    old.lastSeenAt = new Date(ts);
    // updatedAt kept: being said again is not an edit (lib/facts.ts untouched).
    return [db.personFact.update({ where: { id: old.id }, data: { ...(last !== undefined ? { mentions: { increment: 1 } } : {}), lastSeenAt: old.lastSeenAt, ...(old.updatedAt ? { updatedAt: old.updatedAt } : {}) } })];
  });
  if (updates.length) await db.$transaction(updates);
  const fresh = newFacts(facts.map((f) => f.text), found);
  if (!fresh.length) return;
  const index = new Map(found.map((f, i) => [f, i]));
  const rows = fresh.map((f) => {
    const l = at(index.get(f) ?? 0);
    return { ...f, episodeId: l.episodeId, saidAt: new Date(l.m.ts), lastSeenAt: new Date(l.m.ts) };
  });
  const { ids } = await saveMemories(person, rows, { source: "ANALYSIS", chatId: chat.id }, key);
  // Known by id from here on, so the same detail said again later in this step is counted too.
  const now = new Date();
  rows.forEach((f, i) => facts.push({ id: ids[i], text: f.text, deletedAt: null, mentions: 1, lastSeenAt: f.lastSeenAt, updatedAt: now }));
}

const literal = (v: number[]) => `[${v.join(",")}]`;

/** Meaning vectors for the next sittings without one of this key's model. Nothing to do for keys that can't embed. */
export async function embedEpisodes(chatId: string, key: Key) {
  const model = embedModelFor(key.provider);
  if (!model) return 0;
  const rows = await db.chatEpisode.findMany({
    where: { chatId, OR: [{ embedModel: null }, { embedModel: { not: model } }] },
    orderBy: { fromTs: "asc" }, take: embedBatch(key.provider) * EMBED_CALLS, select: { id: true, cipher: true },
  });
  let done = 0;
  for (let i = 0; i < rows.length; i += embedBatch(key.provider)) {
    const group = rows.slice(i, i + embedBatch(key.provider));
    const vectors = await embed(key, group.map((r) => episodeLines(r.cipher).map((m) => `${m.sender}: ${m.text}`).join("\n").slice(0, 6_000)), { dims: EMBED_DIMS, strict: true });
    if (!vectors) throw new Error("Embedding failed");
    // One statement: a transaction of ~100 updates outlasts the transaction timeout on a far-away database.
    await db.$executeRaw`UPDATE "ChatEpisode" AS e SET "embedding" = v.vec::vector, "embedModel" = ${model}
      FROM unnest(${group.map((r) => r.id)}::text[], ${vectors.map(literal)}::text[]) AS v(id, vec)
      WHERE e."id" = v.id`;
    done += group.length;
  }
  return done;
}

/** The person's current chat: where recall looks. */
export const currentChatId = async (personId: string) => (await db.chatUpload.findFirst({ where: { personId, ...alive }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id ?? null;
