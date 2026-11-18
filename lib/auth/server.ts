import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";

import { cookies, headers } from "next/headers";
import { createAuthServer, extractNeonAuthCookies } from "@neon/auth/server";
import { auth } from "./neon";

export { auth };

/**
 * The signed-in session, safe to read while a page renders. Neon Auth's own `auth.getSession()` saves refreshed
 * cookies when its cached session has run out (a tab reopened later), and Next forbids setting cookies during a
 * page render: the page crashed with a server error. Here those writes are skipped where they aren't allowed; the
 * session still reads, and the auth middleware (proxy.ts) and the next server action or API call save the refresh.
 */
const pageSafe = createAuthServer({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET!,
  context: async () => {
    const [jar, h] = await Promise.all([cookies(), headers()]);
    return {
      getCookies: () => extractNeonAuthCookies(h),
      setCookie(name, value, options) {
        try {
          jar.set(name, value, options);
        } catch {
          // A page render: cookies are read-only here (see above).
        }
      },
      getHeader: (name) => h.get(name),
      getOrigin: () => h.get("origin") || h.get("referer")?.split("/").slice(0, 3).join("/") || "",
      getFramework: () => "nextjs",
    };
  },
});
export const getSession = () => pageSafe.getSession();

/** Signed-in Neon Auth user id, or null. Use in route handlers (return 401 on null). */
export async function getUserId(): Promise<string | null> {
  const { data } = await getSession();
  // Accounts pending deletion are filtered in the data queries themselves (getPerson, export), no extra lookup here.
  return data?.user?.id ?? null;
}

/**
 * Data access gate for pages and server actions. Redirects signed-out users home and
 * mirrors the Neon Auth user into our `User` table (app data hangs off it with cascades).
 */
export const requireUser = cache(async () => {
  const { data } = await getSession();
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
