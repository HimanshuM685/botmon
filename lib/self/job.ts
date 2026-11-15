import "server-only";
import { after } from "next/server";
import { db } from "../db";
import { getActiveKey } from "../data";
import { cheapAsk } from "../ai/cheap";
import { acceptMerges, consolidationPrompt, consolidationSchema, MERGE_OVER, traitsHash } from "./consolidate";
import { visible } from "./traits";
import { recountTraits } from "./store";

/** A crashed run frees the lock after this long. */
const SELF_LOCK_MS = 90_000;
/** Cost cap: consolidation runs per user per hour. */
export const SELF_RUNS_PER_HOUR = 6;
/** Most traits sent in one consolidation call. */
const MAX_SENT = 200;

/** Same shape as claimGraphRun (lib/graph/job.ts), on the user's SelfProfile. */
export async function claimSelfRun(userId: string, now = new Date()) {
  await db.selfProfile.upsert({ where: { userId }, create: { userId }, update: {} });
  const until = new Date(now.getTime() + SELF_LOCK_MS), hourAgo = new Date(now.getTime() - 3600_000);
  const won = await db.$executeRaw`
    UPDATE "SelfProfile" SET
      "lockUntil" = ${until},
      "runs" = CASE WHEN "runsSince" > ${hourAgo} THEN "runs" + 1 ELSE 1 END,
      "runsSince" = CASE WHEN "runsSince" > ${hourAgo} THEN "runsSince" ELSE ${now} END
    WHERE "userId" = ${userId}
      AND ("lockUntil" IS NULL OR "lockUntil" < ${now})
      AND NOT ("runsSince" > ${hourAgo} AND "runs" >= ${SELF_RUNS_PER_HOUR})`;
  return won > 0;
}

/**
 * Merge near-duplicate traits once there are many, and rewrite the summary when the traits changed. Merged
 * traits' evidence moves to the one kept. Edited, pinned and user-written traits are never merged away or rewritten.
 */
export async function consolidateSelf(userId: string) {
  const [profile, all] = await Promise.all([
    db.selfProfile.findUnique({ where: { userId }, select: { contextHash: true } }),
    db.selfTrait.findMany({ where: { userId }, orderBy: [{ support: "desc" }, { lastSeenAt: "desc" }], select: { id: true, kind: true, text: true, support: true, people: true, source: true, edited: true, pinned: true, noEvidence: true } }),
  ]);
  const traits = all.filter(visible).slice(0, MAX_SENT);
  const hash = traitsHash(traits);
  if (!traits.length || profile?.contextHash === hash) return; // nothing changed since the last run
  const key = await getActiveKey(userId);
  if (!key || !(await claimSelfRun(userId))) return;
  try {
    const merge = traits.length > MERGE_OVER;
    const answer = await cheapAsk(key)(consolidationSchema, consolidationPrompt(traits, merge));
    const into = merge ? acceptMerges(traits, answer.merges) : new Map<string, string>();
    for (const [drop, keep] of into) {
      // Evidence the kept trait already has for the same line would collide: those copies just go.
      const have = await db.selfEvidence.findMany({ where: { traitId: keep }, select: { personId: true, quoteTs: true } });
      const dup = new Set(have.map((e) => `${e.personId}|${e.quoteTs}`));
      const moving = await db.selfEvidence.findMany({ where: { traitId: drop }, select: { id: true, personId: true, quoteTs: true } });
      await db.$transaction([
        db.selfEvidence.updateMany({ where: { id: { in: moving.filter((e) => !dup.has(`${e.personId}|${e.quoteTs}`)).map((e) => e.id) } }, data: { traitId: keep } }),
        db.selfTrait.delete({ where: { id: drop } }),
      ]);
    }
    if (into.size) await recountTraits(userId, [...new Set(into.values())]);
    const left = into.size ? (await db.selfTrait.findMany({ where: { userId }, select: { id: true, text: true, support: true, source: true, edited: true, pinned: true, noEvidence: true } })).filter(visible) : traits;
    await db.selfProfile.update({ where: { userId }, data: { ...(answer.summary.trim() ? { summary: answer.summary.trim().slice(0, 2_000) } : {}), contextHash: traitsHash(left) } });
  } finally {
    await db.selfProfile.update({ where: { userId }, data: { lockUntil: null } }).catch(() => undefined);
  }
}

/** Run consolidation once the response has been sent. Call wherever the graph job is scheduled. */
export function scheduleSelfJob(userId: string) {
  after(() => consolidateSelf(userId).catch((e) => console.error("self consolidation failed", (e as Error)?.message)));
}
