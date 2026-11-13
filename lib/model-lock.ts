import "server-only";
import { db } from "./db";

/** One living-read update per person at a time; a crashed run frees the lock after this long. */
export const MODEL_LOCK_MS = 150_000;
/** Cost cap: living-read updates per person per hour (each is a full-budget model call). */
export const MODEL_RUNS_PER_HOUR = 30;

/**
 * Atomically take the person's model lock and count the run. One UPDATE, so two concurrent callers can't both win.
 * "busy": another update is running; "capped": hourly cap reached.
 */
export async function claimModelRun(personId: string, now = new Date()): Promise<"ok" | "busy" | "capped"> {
  const until = new Date(now.getTime() + MODEL_LOCK_MS);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const won = await db.$executeRaw`
    UPDATE "Person" SET
      "modelLockUntil" = ${until},
      "modelRuns" = CASE WHEN "modelRunsSince" > ${hourAgo} THEN "modelRuns" + 1 ELSE 1 END,
      "modelRunsSince" = CASE WHEN "modelRunsSince" > ${hourAgo} THEN "modelRunsSince" ELSE ${now} END
    WHERE id = ${personId}
      AND ("modelLockUntil" IS NULL OR "modelLockUntil" < ${now})
      AND NOT ("modelRunsSince" > ${hourAgo} AND "modelRuns" >= ${MODEL_RUNS_PER_HOUR})`;
  if (won) return "ok";
  // Decide from the counter, not the lock: the lock may already be released by the run that beat us.
  const p = await db.person.findUnique({ where: { id: personId }, select: { modelRuns: true, modelRunsSince: true } });
  return p?.modelRunsSince && p.modelRunsSince > hourAgo && p.modelRuns >= MODEL_RUNS_PER_HOUR ? "capped" : "busy";
}

export async function releaseModelRun(personId: string) {
  await db.person.update({ where: { id: personId }, data: { modelLockUntil: null } }).catch(() => undefined);
}
