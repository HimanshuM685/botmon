# botmon

Upload a WhatsApp or Instagram chat with someone you care about (crush, girlfriend, favorite person) and get an honest AI read: where things stand, what they like, red/green flags, next moves and ready-to-send messages.

- Google sign-in via Neon Auth, up to 3 people per user
- Bring your own key: Gemini (free from AI Studio), OpenAI, xAI Grok, Groq or NVIDIA NIM
- Chats are parsed in the browser, then stored gzipped + AES-256-GCM encrypted in Postgres
- Re-upload a newer export of the same chat: only messages after what's stored are sent and added (exact de-dupe on the overlap)
- Re-analysis is incremental: the previous read plus only new messages go to the model; "Full re-read" redoes everything
- Detailed read: status + trend, personality with evidence, love languages, mood/triggers, interests, key facts, important dates, open threads, relationship phases, conflicts, your strengths/blind spots, next moves, messages to send
- Coach chat per person: "this happened, what now?" answered with the chat, latest read and timeline; it can search the full chat and saves new facts to the timeline. Every message is stored.
- The coach investigates before it answers: it reads the exact quote behind a link and cites it with its date, lists stored findings, says what used to be true, searches earlier conversations, and checks every message it drafts against what the person avoids and against how you type. Long conversations keep a running summary of their older part (nothing is deleted). A "why?" under each reply shows what it was built from
- Memory graph per person: people, places and things linked by what they like, avoid, fear and did. Different spellings of one thing ("Paneer", "paneer cubes", "panir") resolve to one node and are kept as aliases
- The graph fills itself in after each reply, on your own key with the provider's cheapest model: a new thing ("paneer") is asked once what it belongs under ("milk product"), and older memories get typed links. Capped per person per hour
- Evidence on every link: the exact chat line it rests on (stored encrypted, like the chat), its date and how it was said (warm, sarcastic, reluctant…). A sarcastic offer is not read as care. A changed preference replaces the old one and keeps it as history
- Findings from the links, stored per person: effort at a cost, a changed mind, something they remembered weeks later, warming or cooling over a month, an open promise. A new finding refreshes the read's advice by itself
- With a Gemini, OpenAI or NVIDIA key, names are also matched by meaning ("curd" finds "dahi") using embeddings of node labels only, never chat lines. With Grok, Groq or OpenRouter the same flows run on spelling alone
- Practise tab: rehearse a conversation with a simulation of the person, grounded in their real replies, typing, boundaries and current mood. A permanent banner says it is a simulation; nothing it says is ever saved as memory. "How did I do?" opens a coach debrief that grades your lines and suggests better ones in your voice
- Memory map: typed links from the person to each topic, coloured by what they say and how it was said, findings flagged on the topics they rest on; click a link to read the exact line behind it
- Scores you can work on: each of the 7 scores on the read comes with one specific thing to try (tied to something real in your chat, never "talk more"). "Improve this" opens a coach conversation about that score and sets it as a goal; later reads show how each score moved since about a month ago (or since you started working on it) and mark a goal reached when it goes up a level
- Timeline (long-term memory) per person: filled by reads and the coach, editable by you, used in every read and chat
- 30-day trash for everything (people, chats, reads, coach conversations, timeline items, the account); restore any time, then erased when you run `npm run purge`
- Analysis streams in live; history kept per person
- Export / delete everything from Settings; the export includes the memory graph, and purge removes graph nodes nothing stands behind any more

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

- `npm test` — pure unit tests: parsers, stats, crypto, the memory graph, findings, coach tools, persona, and the ten scenario fixtures
- `npm run lint`, `npm run build`
- `npm run eval` — runs the scenario fixtures (`tests/fixtures/scenarios`) through a real model: extraction, categories, evidence, then the coach. Needs `EVAL_PROVIDER` and `EVAL_API_KEY` (optional `EVAL_MODEL`, `EVAL_RUNS`, `EVAL_ONLY`); skipped without them
