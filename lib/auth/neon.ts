import { createNeonAuth } from "@neon/auth/next/server";

/** Kept free of DB imports: proxy.ts runs this on Netlify's Deno edge runtime, where Prisma can't load. */
/** The one place Neon Auth is configured; lib/auth/server.ts builds its page-safe reader from this too. */
export const NEON_AUTH = { baseUrl: process.env.NEON_AUTH_BASE_URL!, cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET! };

export const auth = createNeonAuth({ baseUrl: NEON_AUTH.baseUrl, cookies: { secret: NEON_AUTH.cookieSecret } });
