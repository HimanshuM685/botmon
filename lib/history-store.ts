import "server-only";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { historyForPrompt, historyWork, HISTORY_SHARE, type Unit } from "./history";
import type { Msg } from "./parsers/types";

/** A chat's stored chapters and eras, decrypted, oldest first. */
export async function loadUnits(chatId: string): Promise<(Unit & { id: string })[]> {
  const rows = await db.chatChapter.findMany({ where: { chatId }, orderBy: [{ level: "asc" }, { fromTs: "asc" }] });
  return rows.map((r) => ({ id: r.id, fromTs: r.fromTs.getTime(), toTs: r.toTs.getTime(), msgCount: r.msgCount, level: r.level, result: JSON.parse(decrypt(r.cipher)) }));
}

export async function saveUnit(chatId: string, u: Unit, model: string) {
  await db.chatChapter.create({
    data: { chatId, fromTs: new Date(u.fromTs), toTs: new Date(u.toTs), msgCount: u.msgCount, level: u.level, model, cipher: encrypt(JSON.stringify(u.result)) },
  });
}

/**
 * The history block for a read or coach prompt, and the last message it covers (messages after it go in full).
 * `ready` false: chapters or eras are still to be read (the history route does that).
 */
export async function historyFor(chat: { id: string; tzOffset: number }, msgs: Msg[], budget: number) {
  const work = historyWork(msgs, await loadUnits(chat.id), budget, chat.tzOffset);
  const text = historyForPrompt(work.units, Math.floor(budget * HISTORY_SHARE));
  return { text, to: work.plan.at(-1)?.toTs, ready: work.ready, todo: work.todo.length + work.eraTodo.length, parts: work.plan.length };
}

/** Same pattern as claimModelRun (lib/model-lock.ts), one history run per chat. */
export async function claimHistoryRun(chatId: string, ms: number, now = new Date()) {
  const won = await db.chatUpload.updateMany({
    where: { id: chatId, OR: [{ historyLockUntil: null }, { historyLockUntil: { lt: now } }] },
    data: { historyLockUntil: new Date(now.getTime() + ms) },
  });
  return won.count > 0;
}

export const releaseHistoryRun = (chatId: string) => db.chatUpload.update({ where: { id: chatId }, data: { historyLockUntil: null } }).catch(() => undefined);
