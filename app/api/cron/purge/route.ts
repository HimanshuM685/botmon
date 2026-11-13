import { timingSafeEqual } from "node:crypto";
import { purgeExpired } from "@/lib/purge";

export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Daily: permanently erase anything in the trash for more than 30 days. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const purged = await purgeExpired();
  console.log("purge", purged);
  return Response.json({ ok: true, purged });
}
