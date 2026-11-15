import "server-only";
import { db } from "@/lib/db";
import { CHAR_BUDGET } from "./models";
import { cheapText, type Key } from "./cheap";
import { COACH_HISTORY } from "./coach";
import { KEEP_RECENT, needsCompaction, renderForSummary, splitForSummary, summaryPrompt } from "./compact";

/** Most messages loaded for one turn: a compaction leaves KEEP_RECENT and the next one starts past COACH_HISTORY. */
export const COACH_WINDOW = COACH_HISTORY + KEEP_RECENT;

/** The messages after the thread's summary (all of them when there is none), newest first, at most COACH_WINDOW. */
export async function recentMessages(thread: { id: string; summaryThroughId: string | null }) {
  const through = thread.summaryThroughId ? await db.coachMessage.findFirst({ where: { id: thread.summaryThroughId, threadId: thread.id }, select: { createdAt: true } }) : null;
  return db.coachMessage.findMany({ where: { threadId: thread.id, ...(through ? { createdAt: { gt: through.createdAt } } : {}) }, orderBy: { createdAt: "desc" }, take: COACH_WINDOW });
}

/**
 * Fold the older part of a long conversation into the thread's summary (run after the response). Nothing is
 * deleted: the summary only replaces what is sent to the model. A failed summary changes nothing and is retried
 * after the next turn.
 */
export async function compactThread(threadId: string, personName: string, key: Key) {
  const thread = await db.coachThread.findUnique({ where: { id: threadId }, select: { id: true, summary: true, summaryThroughId: true } });
  if (!thread) return;
  const rows = (await recentMessages(thread)).reverse();
  if (!needsCompaction(rows, CHAR_BUDGET[key.provider])) return;
  const { older } = splitForSummary(rows);
  const text = renderForSummary(older);
  if (!older.length || !text) return;
  const summary = (await cheapText(key, summaryPrompt(thread.summary, text.slice(-Math.floor(CHAR_BUDGET[key.provider] * 0.5)), personName))).trim();
  if (summary) await db.coachThread.update({ where: { id: thread.id }, data: { summary: summary.slice(0, 6_000), summaryThroughId: older.at(-1)!.id } });
}
