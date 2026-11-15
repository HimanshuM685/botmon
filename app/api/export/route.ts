import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { loadChat } from "@/lib/data";
import { decrypt } from "@/lib/crypto";
import { exportEdge } from "@/lib/graph/export";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } })))
    return Response.json({ error: "Account is scheduled for deletion. Restore it to export." }, { status: 403 });
  // Everything, including items in the trash (they carry deletedAt).
  const people = await db.person.findMany({
    where: { userId, deletedAt: undefined }, // trashed people too
    include: {
      chats: { include: { chapters: { orderBy: [{ level: "asc" }, { fromTs: "asc" }] } } },
      analyses: { orderBy: { createdAt: "asc" } },
      facts: { orderBy: { createdAt: "asc" }, include: { linksFrom: { select: { toId: true, kind: true } } } },
      threads: { orderBy: { createdAt: "asc" }, include: { messages: { orderBy: { createdAt: "asc" } } } },
      // The memory graph: every node and edge (edges of trashed memories included; their memory carries deletedAt).
      nodes: { orderBy: { createdAt: "asc" } },
      edges: { orderBy: { createdAt: "asc" } },
      findings: { orderBy: { firstSeenAt: "asc" } },
      goals: { orderBy: { createdAt: "asc" } },
    },
  });
  // The user's own profile: traits (hidden ones too, with deletedAt), the lines behind them, and "Coach me" threads.
  const [self, traits, selfThreads] = await Promise.all([
    db.selfProfile.findUnique({ where: { userId }, select: { summary: true, voiceCipher: true, updatedAt: true } }),
    db.selfTrait.findMany({ where: { userId, deletedAt: undefined }, orderBy: { firstSeenAt: "asc" }, include: { evidence: { orderBy: { at: "asc" } } } }),
    db.coachThread.findMany({ where: { userId, deletedAt: undefined }, orderBy: { createdAt: "asc" }, include: { messages: { orderBy: { createdAt: "asc" } } } }),
  ]);
  const data = await Promise.all(
    people.map(async ({ chats, edges, ...p }) => ({
      ...p,
      edges: edges.map((e) => exportEdge(e, decrypt)),
      chats: await Promise.all(chats.map(async ({ cipher, chapters, voiceCipher, ...c }) => ({
        ...c,
        voices: voiceCipher ? JSON.parse(decrypt(voiceCipher)) : null,
        messages: await loadChat(cipher),
        // What each period of a long chat held, as read (lib/history.ts).
        history: chapters.map(({ cipher: h, ...ch }) => ({ ...ch, result: JSON.parse(decrypt(h)) })),
      }))),
    })),
  );
  const you = {
    summary: self?.summary ?? null,
    voice: self?.voiceCipher ? JSON.parse(decrypt(self.voiceCipher)) : null,
    traits: traits.map(({ evidence, ...t }) => ({ ...t, evidence: evidence.map((e) => exportEdge(e, decrypt)) })),
    threads: selfThreads,
  };
  return new Response(JSON.stringify({ exportedAt: new Date(), you, people: data }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="botmon-export.json"' },
  });
}
