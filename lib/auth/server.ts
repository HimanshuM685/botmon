import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";

import { auth } from "./neon";

export { auth };

/** Signed-in Neon Auth user id, or null. Use in route handlers (return 401 on null). */
export async function getUserId(): Promise<string | null> {
  const { data } = await auth.getSession();
  const id = data?.user?.id;
  if (!id) return null;
  // Accounts pending deletion can't use the API until restored.
  const row = await db.user.findUnique({ where: { id }, select: { deletedAt: true } });
  return row?.deletedAt ? null : id;
}

/**
 * Data access gate for pages and server actions. Redirects signed-out users home and
 * mirrors the Neon Auth user into our `User` table (app data hangs off it with cascades).
 */
export const requireUser = cache(async () => {
  const { data } = await auth.getSession();
  const u = data?.user;
  if (!u) redirect("/");
  const profile = { email: u.email, name: u.name ?? null, image: u.image ?? null };
  // Write only when the mirror row is missing or the Google profile changed.
  const row = await db.user.findUnique({ where: { id: u.id }, select: { email: true, name: true, image: true, deletedAt: true } });
  if (row?.deletedAt) redirect("/restore-account");
  if (!row || row.email !== profile.email || row.name !== profile.name || row.image !== profile.image)
    await db.user.upsert({ where: { id: u.id }, create: { id: u.id, ...profile }, update: profile });
  return { id: u.id, name: u.name ?? "", email: u.email, image: u.image ?? null };
});
