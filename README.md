# botmon

Upload a WhatsApp or Instagram chat with someone you care about (crush, girlfriend, favorite person) and get an honest AI read: where things stand, what they like, red/green flags, next moves and ready-to-send messages.

- Google sign-in via Neon Auth, up to 3 people per user
- Bring your own key: Gemini (free from AI Studio), OpenAI or NVIDIA NIM
- Chats are parsed in the browser, then stored gzipped + AES-256-GCM encrypted in Postgres
- Analysis streams in live; history kept per person
- Export / delete everything from Settings

> Google AI Pro / Gemini app subscriptions can't be used by third-party apps (Google offers no OAuth path for that quota), so users bring an API key.

## Stack

Next.js 16 (App Router) · Neon Postgres + Neon Auth (Managed Better Auth) · Prisma 7 (node-postgres) · Vercel AI SDK 7 · Tailwind 4

## Local setup

```bash
npm install
neon login                          # once
neon deploy                         # provisions Postgres + Auth from neon.ts, writes DATABASE_URL* and NEON_AUTH_* to .env
echo "NEON_AUTH_COOKIE_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
npx prisma migrate deploy
npm run dev
```

Google sign-in uses Neon's shared development credentials out of the box; localhost is a trusted domain by default.

## Production

1. Your own Google OAuth app (required for production): create an OAuth client in Google Cloud with redirect URI
   `<NEON_AUTH_BASE_URL>/callback/google`, then
   `neon neon-auth oauth-provider add google --oauth-client-id ... --oauth-client-secret ...`
2. Trust your domain: `neon neon-auth domain add https://<your-domain>`
3. Vercel env vars: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ENCRYPTION_KEY`.
   Migrations run on deploy (`vercel-build` runs `prisma migrate deploy`).
4. Custom SMTP for auth emails if you add email sign-in later: https://neon.com/docs/auth/production-checklist.md

**Never change or lose `ENCRYPTION_KEY`** — stored chats and API keys become unreadable.

## Scripts

- `npm test` — parser, stats and crypto tests
- `npm run lint`, `npm run build`
