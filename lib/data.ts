import "server-only";
import { gunzipSync } from "node:zlib";
import { cache } from "react";
import { z } from "zod";
import { db } from "./db";
import { alive } from "./trash";
import { decrypt, decryptBuffer } from "./crypto";
import type { Msg } from "./parsers/types";
import type { ProviderId } from "./ai/models";
import { computeStats, type ChatStats } from "./stats";
import { contextHash } from "./context";

export const MAX_PEOPLE = 3;
export const MAX_MESSAGES = 200_000;

export const chatPayloadSchema = z.object({
  source: z.enum(["WHATSAPP", "INSTAGRAM", "PASTE"]),
  myName: z.string().min(1).max(200),
  theirName: z.string().min(1).max(200),
  tzOffset: z.number().int().min(-14 * 60).max(14 * 60),
  messages: z
    .array(z.object({ sender: z.string().max(200), text: z.string().max(20_000), ts: z.number().int().positive() }))
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
  return { provider: k.provider as ProviderId, model: k.model, apiKey: decrypt(k.cipher) };
}

/** Fingerprint of the person's notes and alive timeline right now (see lib/context.ts). */
export async function currentContextHash(person: { id: string; notes: string | null; relation: string; gender: string }) {
  const facts = await db.personFact.findMany({ where: { personId: person.id, ...alive }, select: { id: true, updatedAt: true } });
  return contextHash(person, facts);
}
