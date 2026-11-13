// Permanently erase everything that has been in the trash for more than 30 days.
//   npm run purge              erase
//   npm run purge -- --dry-run count what would be erased, change nothing
import "dotenv/config";
import { db } from "@/lib/db";
import { purgeExpired } from "@/lib/purge";
import { purgeCutoff } from "@/lib/trash";

const cutoff = purgeCutoff();
console.log(`Trash older than ${cutoff.toISOString()}`);

if (process.argv.includes("--dry-run")) {
  const old = { deletedAt: { lt: cutoff } };
  const [people, chats, analyses, threads, facts, users] = await Promise.all([
    db.person.count({ where: old }),
    db.chatUpload.count({ where: old }),
    db.analysis.count({ where: old }),
    db.coachThread.count({ where: old }),
    db.personFact.count({ where: old }),
    db.user.count({ where: old }),
  ]);
  console.log("Would erase:", JSON.stringify({ people, chats, analyses, threads, facts, users }));
  process.exit(0);
}

const result = await purgeExpired();
console.log("Erased:", JSON.stringify(result));
process.exit(result.failed.length ? 1 : 0);
