import { createNeonAuth } from "@neon/auth/next/server";

/** Kept free of DB imports: proxy.ts runs this on Netlify's Deno edge runtime, where Prisma can't load. */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});
