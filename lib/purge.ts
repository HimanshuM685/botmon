import "server-only";
import { db } from "./db";
import { purgeCutoff } from "./trash";
import { pruneGraph } from "./graph-store";
import { recountTraits } from "./self/store";

/** Permanently delete everything that has been in the trash for more than 30 days (run by hand: `npm run purge`). */
export async function purgeExpired({ now = Date.now() }: { now?: number } = {}) {
  const old = { lt: purgeCutoff(now) };

  // People losing memories for good: their graphs are tidied afterwards (edges cascade with the memory, nodes don't).
  const losing = await db.personFact.findMany({ where: { deletedAt: old, person: { deletedAt: undefined } }, select: { personId: true }, distinct: ["personId"] });

  // Users losing a person or a chat for good: what those taught about them goes with them, so their traits are recounted.
  const [gonePeople, goneChats] = await Promise.all([
    db.person.findMany({ where: { deletedAt: old }, select: { userId: true } }),
    db.chatUpload.findMany({ where: { deletedAt: old }, select: { person: { select: { userId: true } } } }),
  ]);
  const recount = new Set([...gonePeople.map((p) => p.userId), ...goneChats.map((c) => c.person.userId)]);

  const [facts, threads, analyses, chats, people, traits] = await db.$transaction([
    db.personFact.deleteMany({ where: { deletedAt: old } }),
    db.coachThread.deleteMany({ where: { deletedAt: old } }), // messages cascade
    db.analysis.deleteMany({ where: { deletedAt: old } }),
    db.chatUpload.deleteMany({ where: { deletedAt: old } }),
    db.person.deleteMany({ where: { deletedAt: old } }), // children cascade, the evidence of the user's traits too
    db.selfTrait.deleteMany({ where: { deletedAt: old } }), // traits the user hid
  ]);
  // Evidence-less relation traits go; global ones stay as plain text, flagged (lib/self/traits.ts rescope).
  for (const userId of recount) await recountTraits(userId).catch((e) => console.error("purge: traits not recounted", userId, (e as Error).message));

  // Nodes nothing stands behind any more (lib/graph.ts ungrounded); the two hubs always stay.
  let nodes = 0;
  for (const { personId } of losing) nodes += await pruneGraph(personId).catch(() => 0); // the person may have been purged too

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
  return { facts: facts.count, threads: threads.count, analyses: analyses.count, chats: chats.count, people: people.count, traits: traits.count, nodes, users, failed };
}
