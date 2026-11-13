import "server-only";
import { db } from "./db";
import { purgeCutoff } from "./trash";

/** Permanently delete everything that has been in the trash for more than 30 days (run by hand: `npm run purge`). */
export async function purgeExpired({ now = Date.now() }: { now?: number } = {}) {
  const old = { lt: purgeCutoff(now) };

  const [facts, threads, analyses, chats, people] = await db.$transaction([
    db.personFact.deleteMany({ where: { deletedAt: old } }),
    db.coachThread.deleteMany({ where: { deletedAt: old } }), // messages cascade
    db.analysis.deleteMany({ where: { deletedAt: old } }),
    db.chatUpload.deleteMany({ where: { deletedAt: old } }),
    db.person.deleteMany({ where: { deletedAt: old } }), // children cascade
  ]);

  let users = 0;
  const failed: string[] = [];
  const expired = await db.user.findMany({ where: { deletedAt: old }, select: { id: true } });
  for (const { id } of expired) {
    // App data cascades from User. The Neon Auth identity lives in neon_auth; remove it too so the account is fully gone.
    // One account failing must not block the rest; it is retried on the next run.
    try {
      await db.$transaction([
        db.user.delete({ where: { id } }),
        db.$executeRaw`DELETE FROM neon_auth.session WHERE "userId"::text = ${id}`,
        db.$executeRaw`DELETE FROM neon_auth.account WHERE "userId"::text = ${id}`,
        db.$executeRaw`DELETE FROM neon_auth."user" WHERE id::text = ${id}`,
      ]);
      users++;
    } catch (e) {
      failed.push(id);
      console.error("purge: account failed", id, (e as Error).message);
    }
  }
  return { facts: facts.count, threads: threads.count, analyses: analyses.count, chats: chats.count, people: people.count, users, failed };
}
