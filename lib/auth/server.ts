import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});

/** Signed-in Neon Auth user id, or null. Use in route handlers (return 401 on null). */
export async function getUserId(): Promise<string | null> {
  const { data } = await auth.getSession();
  return data?.user?.id ?? null;
}

/**
 * Data access gate for pages and server actions. Redirects signed-out users home and
 * mirrors the Neon Auth user into our `User` table (app data hangs off it with cascades).
 */
export async function requireUser() {
  const { data } = await auth.getSession();
  const u = data?.user;
  if (!u) redirect("/");
  const profile = { email: u.email, name: u.name ?? null, image: u.image ?? null };
  await db.user.upsert({ where: { id: u.id }, create: { id: u.id, ...profile }, update: profile });
  return { id: u.id, name: u.name ?? "", email: u.email, image: u.image ?? null };
}
