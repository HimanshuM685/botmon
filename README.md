# botmon

Upload a WhatsApp or Instagram chat with someone you care about (crush, girlfriend, favorite person) and get an honest AI read: where things stand, what they like, red/green flags, next moves and ready-to-send messages.

- Google sign-in via Neon Auth, up to 3 people per user
- Bring your own key: Gemini (free from AI Studio), OpenAI, xAI Grok, Groq or NVIDIA NIM
- Chats are parsed in the browser, then stored gzipped + AES-256-GCM encrypted in Postgres
- Re-upload a newer export of the same chat: only messages after what's stored are sent and added (exact de-dupe on the overlap)
- Re-analysis is incremental: the previous read plus only new messages go to the model; "Full re-read" redoes everything
- Detailed read: status + trend, personality with evidence, love languages, mood/triggers, interests, key facts, important dates, open threads, relationship phases, conflicts, your strengths/blind spots, next moves, messages to send
- Coach chat per person: "this happened, what now?" answered with the chat, latest read and timeline; it can search the full chat and saves new facts to the timeline. Every message is stored.
- Timeline (long-term memory) per person: filled by reads and the coach, editable by you, used in every read and chat
- 30-day trash for everything (people, chats, reads, coach conversations, timeline items, the account); restore any time, then erased when you run `npm run purge`
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

Trash purge: deleted items stay 30 days; nothing is erased automatically. Run `npm run purge` (uses `.env`, add `-- --dry-run` to preview) to permanently erase everything past the window, including Neon Auth identities of deleted accounts.

**Never change or lose `ENCRYPTION_KEY`** — stored chats and API keys become unreadable.

## Scripts

- `npm test` — parser, stats and crypto tests
- `npm run lint`, `npm run build`
