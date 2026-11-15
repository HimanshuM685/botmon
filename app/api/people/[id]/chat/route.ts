import { gunzipSync, gzipSync } from "node:zlib";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { chatPayloadSchema, getChat, getPerson, loadChat } from "@/lib/data";
import { mergeChats } from "@/lib/merge";
import { computeStats } from "@/lib/stats";

const MAX_COMPRESSED = 4 * 1024 * 1024; // Vercel request body cap is 4.5MB
const MAX_RAW = 60 * 1024 * 1024;

// Body: gzip(JSON chatPayload). Client parses the export; server validates, re-compresses and encrypts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const person = await getPerson(userId, (await params).id);
  if (!person) return Response.json({ error: "Not found" }, { status: 404 });

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_COMPRESSED) return Response.json({ error: "Chat too large. Export a shorter range." }, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(gunzipSync(body, { maxOutputLength: MAX_RAW }).toString("utf8"));
  } catch {
    return Response.json({ error: "Could not read upload" }, { status: 400 });
  }
  const parsed = chatPayloadSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid chat" }, { status: 400 });

  const { source, myName, theirName, tzOffset } = parsed.data;
  const incoming = parsed.data.messages.sort((a, b) => a.ts - b.ts);
  const existing = await getChat(person.id);

  // Same two people as the stored chat: merge, keeping only messages we don't have yet.
  if (existing && existing.myName === myName && existing.theirName === theirName) {
    const { messages, added } = mergeChats(await loadChat(existing.cipher), incoming);
    if (!added.length) return Response.json({ ok: true, mode: "merged", added: 0, msgCount: existing.msgCount });
    await db.chatUpload.update({
      where: { id: existing.id },
      data: {
        cipher: encrypt(gzipSync(JSON.stringify({ messages }))),
        stats: computeStats(messages, myName, tzOffset),
        tzOffset,
        msgCount: messages.length,
        firstAt: new Date(messages[0].ts),
        lastAt: new Date(messages[messages.length - 1].ts),
      },
    });
    return Response.json({ ok: true, mode: "merged", added: added.length, msgCount: messages.length, from: added[0].ts, to: added.at(-1)!.ts });
  }

  // New chat (or a different pair of names): replace. The old one goes to the trash, restorable for 30 days.
  if (incoming.length < 10) return Response.json({ error: "Need at least 10 messages for a useful analysis" }, { status: 400 });
  // One timestamp for both: "the chat this one replaced" is the one trashed at this chat's createdAt (removeChat in app/actions.ts).
  const now = new Date();
  const [, created] = await db.$transaction([
    db.chatUpload.updateMany({ where: { personId: person.id, deletedAt: null }, data: { deletedAt: now } }),
    db.chatUpload.create({
      select: { id: true },
      data: {
        personId: person.id, source, myName, theirName, tzOffset, createdAt: now,
        cipher: encrypt(gzipSync(JSON.stringify({ messages: incoming }))),
        stats: computeStats(incoming, myName, tzOffset),
        msgCount: incoming.length,
        firstAt: new Date(incoming[0].ts),
        lastAt: new Date(incoming[incoming.length - 1].ts),
      },
    }),
  ]);
  return Response.json({ ok: true, id: created.id, mode: existing ? "replaced" : "created", added: incoming.length, msgCount: incoming.length });
}
