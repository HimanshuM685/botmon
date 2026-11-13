import "server-only";
import { db } from "./db";
import { purgeCutoff } from "./trash";

/**
 * Permanently delete everything that has been in the trash for more than 30 days.
 * Pass `userId` to limit it to one account (cheap opportunistic run on sign-in).
 */
export async function purgeExpired({ now = Date.now(), userId }: { now?: number; userId?: string } = {}) {
  const old = { lt: purgeCutoff(now) };
  const mine = userId ? { person: { userId } } : {};

  const [facts, threads, analyses, chats, people] = await db.$transaction([
    db.personFact.deleteMany({ where: { deletedAt: old, ...mine } }),
    db.coachThread.deleteMany({ where: { deletedAt: old, ...mine } }), // messages cascade
    db.analysis.deleteMany({ where: { deletedAt: old, ...mine } }),
    db.chatUpload.deleteMany({ where: { deletedAt: old, ...mine } }),
    db.person.deleteMany({ where: { deletedAt: old, ...(userId ? { userId } : {}) } }), // children cascade
  ]);

  let users = 0;
  if (!userId) {
    const expired = await db.user.findMany({ where: { deletedAt: old }, select: { id: true } });
    for (const { id } of expired) {
      // App data cascades from User. The Neon Auth identity lives in neon_auth; remove it too so the account is fully gone.
      await db.$transaction([
        db.user.delete({ where: { id } }),
        db.$executeRaw`DELETE FROM neon_auth.session WHERE "userId" = ${id}`,
        db.$executeRaw`DELETE FROM neon_auth.account WHERE "userId" = ${id}`,
        db.$executeRaw`DELETE FROM neon_auth."user" WHERE id = ${id}`,
      ]);
      users++;
    }
  }
  return { facts: facts.count, threads: threads.count, analyses: analyses.count, chats: chats.count, people: people.count, users };
}
