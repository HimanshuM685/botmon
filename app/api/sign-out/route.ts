import { cookies } from "next/headers";
import { NEON_AUTH_COOKIE_PREFIX } from "@neon/auth/server";
import { auth } from "@/lib/auth/neon";

/**
 * Sign out, for certain. The session is ended on Neon Auth's side (best effort), then every Neon Auth cookie is
 * expired here whatever that answer was: signing out must never depend on the auth server's reply deleting them,
 * or the next page still finds a session (the signed session-data cookie is trusted without asking the server).
 */
export async function POST() {
  await auth.signOut().catch((e) => console.error("sign-out: auth server didn't end the session", (e as Error)?.message));
  const jar = await cookies();
  for (const { name } of jar.getAll())
    if (name.startsWith(NEON_AUTH_COOKIE_PREFIX)) jar.set(name, "", { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "lax" });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
