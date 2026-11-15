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
      chats: true,
      analyses: { orderBy: { createdAt: "asc" } },
      facts: { orderBy: { createdAt: "asc" }, include: { linksFrom: { select: { toId: true, kind: true } } } },
      threads: { orderBy: { createdAt: "asc" }, include: { messages: { orderBy: { createdAt: "asc" } } } },
      // The memory graph: every node and edge (edges of trashed memories included; their memory carries deletedAt).
      nodes: { orderBy: { createdAt: "asc" } },
      edges: { orderBy: { createdAt: "asc" } },
      findings: { orderBy: { firstSeenAt: "asc" } },
    },
  });
  const data = await Promise.all(
    people.map(async ({ chats, edges, ...p }) => ({
      ...p,
      edges: edges.map((e) => exportEdge(e, decrypt)),
      chats: await Promise.all(chats.map(async ({ cipher, ...c }) => ({ ...c, messages: await loadChat(cipher) }))),
    })),
  );
  return new Response(JSON.stringify({ exportedAt: new Date(), people: data }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="botmon-export.json"' },
  });
}
