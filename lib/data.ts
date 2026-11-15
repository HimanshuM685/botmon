import "server-only";
import { gunzipSync } from "node:zlib";
import { cache } from "react";
import { z } from "zod";
import { db } from "./db";
import { alive } from "./trash";
import { decrypt, decryptBuffer, encrypt } from "./crypto";
import { voiceProfile, type Voice } from "./voice";
import type { Msg } from "./parsers/types";
import { CHAR_BUDGET, type ProviderId } from "./ai/models";
import { computeStats, type ChatStats } from "./stats";
import { contextHash } from "./context";
import { capText } from "./upload";

export const MAX_PEOPLE = 3;
/** Messages per upload request: long chats go up in parts (lib/upload.ts). */
export const MAX_MESSAGES = 50_000;
/** Messages per stored chat, checked when a part is merged in. */
export const MAX_CHAT_MESSAGES = 1_000_000;

export const chatPayloadSchema = z.object({
  source: z.enum(["WHATSAPP", "INSTAGRAM", "PASTE"]),
  myName: z.string().min(1).max(200),
  theirName: z.string().min(1).max(200),
  tzOffset: z.number().int().min(-14 * 60).max(14 * 60),
  messages: z
    .array(z.object({ sender: z.string().max(200), text: z.string().transform(capText), ts: z.number().int().positive() }))
    .min(1, "No messages found")
    .max(MAX_MESSAGES),
});

/** Owner-scoped person lookup. Null for other users' ids, people in the trash, and accounts pending deletion. */
export const getPerson = cache((userId: string, personId: string) =>
  db.person.findFirst({ where: { id: personId, userId, ...alive, user: alive } }),
); // cache: the person layout and its page ask for the same row in one request

/** The person's current chat (not in the trash). */
export function getChat(personId: string) {
  return db.chatUpload.findFirst({ where: { personId, ...alive }, orderBy: { createdAt: "desc" } });
}

export async function loadChat(cipher: string): Promise<Msg[]> {
  return JSON.parse(gunzipSync(decryptBuffer(cipher)).toString("utf8")).messages;
}

export type ChatVoices = { me: Voice | null; them: Voice | null };

/** Both sides' voices for a chat's messages, ready to store (encrypted: samples are real messages). */
export const measureVoices = (msgs: Msg[], myName: string, theirName: string): ChatVoices => ({ me: voiceProfile(msgs, myName), them: voiceProfile(msgs, theirName) });
export const sealVoices = (v: ChatVoices) => encrypt(JSON.stringify(v));

/**
 * Stored voices, or for chats uploaded before voices were stored: measured from the messages once and saved.
 * Pass `msgs` when the chat is already decrypted, so it isn't decrypted twice.
 */
export async function getVoices(chat: { id: string; voiceCipher: string | null; myName: string; theirName: string; cipher?: string }, msgs?: Msg[]): Promise<ChatVoices> {
  if (chat.voiceCipher) return JSON.parse(decrypt(chat.voiceCipher)) as ChatVoices;
  const all = msgs ?? (await loadChat(chat.cipher ?? (await db.chatUpload.findUniqueOrThrow({ where: { id: chat.id }, select: { cipher: true } })).cipher));
  const voices = measureVoices(all, chat.myName, chat.theirName);
  await db.chatUpload.update({ where: { id: chat.id }, data: { voiceCipher: sealVoices(voices) } });
  return voices;
}

/** Stored stats, or for chats uploaded before stats were stored: compute from the messages once and save. */
export async function getChatStats(chat: { id: string; stats: unknown; myName: string; tzOffset: number; cipher?: string }): Promise<ChatStats> {
  if (chat.stats) return chat.stats as ChatStats;
  const cipher = chat.cipher ?? (await db.chatUpload.findUniqueOrThrow({ where: { id: chat.id }, select: { cipher: true } })).cipher;
  const stats = computeStats(await loadChat(cipher), chat.myName, chat.tzOffset);
  await db.chatUpload.update({ where: { id: chat.id }, data: { stats } });
  return stats;
}

export async function getActiveKey(userId: string) {
  const [user, keys] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { defaultProvider: true } }),
    db.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);
  const k = keys.find((x) => x.provider === user?.defaultProvider) ?? keys[0];
  if (!k) return null;
  const provider = k.provider as ProviderId;
  // Chars per call: the provider default, or less once the key's rate limit said so (rateLimit, lib/ai/provider.ts).
  return { id: k.id, provider, model: k.model, apiKey: decrypt(k.cipher), budget: Math.min(k.charBudget ?? Infinity, CHAR_BUDGET[provider]) };
}

/** Fingerprint of the person's notes and alive timeline right now (see lib/context.ts). */
export async function currentContextHash(person: { id: string; notes: string | null; relation: string; gender: string }) {
  const [facts, findings] = await Promise.all([
    db.personFact.findMany({ where: { personId: person.id, ...alive }, select: { id: true, updatedAt: true } }),
    db.memoryFinding.findMany({ where: { personId: person.id, retiredAt: null }, select: { key: true } }),
  ]);
  return contextHash(person, facts, findings.map((f) => f.key));
}
