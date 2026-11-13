import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { loadChat } from "@/lib/data";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const people = await db.person.findMany({ where: { userId }, include: { chats: true, analyses: true } });
  const data = await Promise.all(
    people.map(async ({ chats, ...p }) => ({
      ...p,
      chats: await Promise.all(chats.map(async ({ cipher, ...c }) => ({ ...c, messages: await loadChat(cipher) }))),
    })),
  );
  return new Response(JSON.stringify({ exportedAt: new Date(), people: data }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="botmon-export.json"' },
  });
}
