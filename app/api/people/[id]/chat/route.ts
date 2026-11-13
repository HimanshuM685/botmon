import { gunzipSync, gzipSync } from "node:zlib";
import { getUserId } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { chatPayloadSchema, getPerson } from "@/lib/data";
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

  const { messages, source, myName, theirName, tzOffset } = parsed.data;
  messages.sort((a, b) => a.ts - b.ts);
  const cipher = encrypt(gzipSync(JSON.stringify({ messages })));

  // One chat per person: a new upload replaces the old one.
  await db.$transaction([
    db.chatUpload.deleteMany({ where: { personId: person.id } }),
    db.chatUpload.create({
      data: {
        personId: person.id, source, cipher, myName, theirName, tzOffset,
        stats: computeStats(messages, myName, tzOffset),
        msgCount: messages.length,
        firstAt: new Date(messages[0].ts),
        lastAt: new Date(messages[messages.length - 1].ts),
      },
    }),
  ]);
  return Response.json({ ok: true, msgCount: messages.length });
}
