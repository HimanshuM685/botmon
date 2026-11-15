# Botmon: finish the coach's brain

## Context

Commit `5143147` left a typed memory graph (`MemoryNode`/`MemoryEdge`, `planMemory`, `buildGraph`, three findings: cost / mixed / risk) and a coach with `recall`/`connect`. Seven gaps remain: aliases never written, categories only when a model states them, edges carry no tone/date/quote, no supersede, old facts have only `MENTIONS`, export/purge ignore the graph, findings are not persisted. Goal: a coach that reasons over evidence (quote + tone + date), plus a rehearsal persona. Canonical test: the cheese scenario (cost finding, warm quote cited with date, no cheese date, thank-you in the user's voice).

Baseline verified: `npm test` 63/63 green. Lint/build get run at step 0 (not run in plan mode: build writes `.next`).

## Decisions already made (your answers)

- Branch `feat/coach-brain` off main; first commit there = the already-staged model-listing work (actions.ts, key-form.tsx, models.ts, models.test.ts) on its own.
- Migrations: files only + `prisma generate`. You apply them to Neon. Nothing in `npm test` needs the DB.
- Run all 8 phases straight; tests + lint + build green at every commit; no push.

## Where the code contradicts the prompt (code wins)

1. **Migration dates.** Newest migration is `20261116110000_memory_nodes` (dated tomorrow). New ones are named `20261117…` onward so they sort after it.
2. **Trigram ≥ 0.6 does not merge "Paneer" / "paneer cubes".** pg_trgm `similarity` gives 7/13 = 0.54. Acceptance requires one node, so scoring is `max(similarity, word_similarity)` (whole-word containment scores 1.0). That alone would merge "milk" into "milk product" and break the cheese test, so: a category endpoint (the `to` of `IS_A`/`PART_OF`) and any node that already has children resolve by exact key / alias only, and two endpoints of one triple never resolve to each other.
3. **Trigram runs in JS, not `pg_trgm`.** The person's nodes are already loaded in memory for every write; a pure JS trigram (same algorithm) is unit-testable and needs no extension. pgvector stays in SQL as asked.
4. **`detachChat` hard-deletes ANALYSIS facts** (not trash), so their edges cascade away. Findings are derived, so detach/reattach/trash/restore just re-run `syncFindings` after their transaction: evidence gone means `retiredAt` set, evidence back means revived. No finding rows inside those transactions.
5. **`quoteTs BigInt`** breaks `JSON.stringify` and RSC props. Converted to `Number` at the store boundary (`loadGraphRows`, export).
6. **`after()` shares the calling route's `maxDuration`** (coach 120s, analyze/model 300s) and is "platform-specific" on adapters (Netlify). The graph job is time-boxed (deadline ~45s, resumable from `graphThroughAt`), so a cut-off run loses nothing; the lock expires by itself like `modelLockUntil`.
7. **"Living read excludes rehearsal threads"**: the `/model` route never reads coach threads today, so nothing to exclude; a test pins that rehearsal messages are not in its inputs.
8. **Debrief needs a guard the prompt does not name.** A debrief is a normal coach thread that sees simulated words, so `remember`/`correct` are switched off (`activeTools`) in debrief threads; otherwise simulated lines could become facts.
9. **`applyVoice` on a streamed persona reply** would rewrite text already shown. Persona replies are short: generated with `generateText`, passed through `applyVoice`, then sent as one UI message.
10. **`mentioned()` with vectors** cannot live in pure `lib/graph.ts`. The route calls an async `focusNodes()` (`lib/graph/resolve.ts`): exact/alias/trigram in memory, then embeds only the unmatched content words of the user's message (never chat lines) and looks up nodes by cosine.
11. **Tool names.** Existing tools are camelCase (`searchChat`); the new ones are kept exactly as you named them (`search_history`, `check_draft`).
12. **Cheap models.** `CHEAP_MODEL` picks from each provider's listed models; a key may not have that model, so a 404 falls back to the user's own model.

## Step 0

Branch, commit staged work, run `npm run lint` + `npm run build`, write `docs/brain-plan.md` (what exists, changes per phase, the list above). README + `docs/brain-plan.md` updated after every phase with what changed and what was deferred.

## Schema (additive migrations, one per phase that needs it)

- P1: none.
- P2 `node_categorized`: `MemoryNode.categorizedAt DateTime?`.
- P3 `edge_evidence`: `MemoryEdge.at, tone, polarity, quoteCipher, quoteTs BigInt, quoteSender, supersededById, confidence Float default 1`; `Person.graphLockUntil, graphRuns, graphRunsSince, graphThroughAt`.
- P4 `memory_finding`: `MemoryFinding(id, personId, kind, key, text, edgeIds[], confidence, firstSeenAt, lastSeenAt, retiredAt?)`, `@@unique([personId, key])`, cascade from Person.
- P5 `coach_threads`: `CoachThread.mode default 'coach', summary, summaryThroughId`; `CoachMessage.trace Json?`.
- P6 `node_embedding`: `CREATE EXTENSION IF NOT EXISTS vector`; `MemoryNode.embedding Unsupported("vector")?` (no fixed dimension, no ANN index), `embedModel`.

## Phases

### 1. Export/purge + entity resolution
- `app/api/export/route.ts`: include nodes, edges, (later) findings; shaping in a pure `exportGraph()` (quotes decrypted, BigInt to number) so it is testable.
- `lib/purge.ts` + `scripts/purge.mts`: after the fact purge, delete nodes with no edge in or out, except `them`/`me`.
- New `lib/graph/resolve.ts` (pure): `trigram()`, `matchNode(key, nodes, {category})` in order exact, alias, trigram ≥ 0.6, with rule 2 above. `planMemory` gets `opts.resolve` and returns `aliases: {nodeId, alias}[]`; `linkMemories` writes them. Coach's in-turn `join` uses the same resolver.
- Tests: Paneer/paneer cubes one node + alias; milk vs milk product stay two; Hinglish spellings (paneer/panner/panir, nhi/nahi); orphan-node selection; export shape.

### 2. Categories + triple backfill
- `CHEAP_MODEL` in `lib/ai/models.ts`; `cheapModel(key)` in `lib/ai/provider.ts`.
- `lib/graph/categories.ts`: pure `needsCategory(nodes, edges)` and `acceptParents()` (drops broad parents: fixed stoplist + any existing node with > `NARROW` children; max 2; prefers `known()` names; optional `sameAs` existing name becomes an alias, which is how "doodh" joins "milk"). Model call injected, so tests mock it. Cache = one nullable column, `MemoryNode.categorizedAt` (small P2 migration): set once a node has been asked about, whether or not a parent was accepted, so the same thing is never asked twice.
- `lib/graph/job.ts`: `claimGraphRun`/`releaseGraphRun` (copy of `claimModelRun` on the graph columns, `GRAPH_RUNS_PER_HOUR`), `runGraphJob(person, key)` with a deadline. Steps this phase: categories, then triple backfill: alive facts whose only edges are `MENTIONS`, `untouched` (same rule as the analyze route, moved to `lib/facts.ts`), cheap model returns `tripleSchema[]` per fact, `linkMemories`. Trashed facts are never loaded.
- Triggered with `after()` from analyze `onDone`, coach `onEnd`, `/model`, and `saveFact`.
- Tests: paneer tikka fact gets `paneer IS_A milk product` (mocked) and `risk` fires against the milk allergy; broad parent rejected; edited fact skipped.

### 3. Evidence, tone, supersede
- `GEdge` gains optional `at, tone, polarity, quote (bool), quoteSender, supersededById, confidence`.
- `lib/graph/evidence.ts`: pure `candidates(edge, nodes, msgs)` (reuses `searchMessages` over labels + aliases, newest first), `chunk()` to `CHAR_BUDGET` (small for GROQ), `acceptPick()` validating the model's pick against the candidate list (the stored quote is always an exact chat line). Job stores `quoteCipher = encrypt(line)`, `quoteTs`, `quoteSender`, `at`, `tone`, `polarity`, `confidence`; advances `graphThroughAt`.
- Supersede: pure `superseded(edges, facts)` in `lib/graph.ts` (same from/to, LIKES/WANTS vs DISLIKES/AVOIDS/FEARS, ordered by `at ?? fact date`); store writes `supersededById` after each link. `buildGraph` skips superseded edges, exposes `history(nodeId)`, and `mixed` becomes "changed on <date>" when order is known.
- Tone weighting: `cost`/`risk` get a confidence; warm/sincere raise it, sarcastic/reluctant/cold drop it; a `cost` under the threshold is not emitted. `renderEdge` shows tone, date and `[q:<edgeId>]`.
- Tests: cheese edges carry quote/date/warm (fixture), sarcastic fixture gives no cost, changed preference superseded with date. Existing cheese test untouched.

### 4. New findings + persistence
- `tensions()` adds `attention` (her quoted edge on a node whose earliest edge is from my line, ≥ 7 days later), `drift` (her mean polarity on a node or on `me`, last 30 days vs before, differs ≥ 1), `open_promise` (DID_FOR/WANTS labelled promised/plans, nothing later on that node after N=14 days). `Tension` gains `key`, `edgeIds`, `confidence`; `now` is a parameter.
- `lib/graph/findings.ts`: pure `diffFindings(stored, current, now)`; store `syncFindings(person)` upserts by key, retires missing ones. Called after every graph write, the job, trash/restore of a fact, detach/reattach.
- `brief(focus, {stored, since})`: findings first seen after the thread's last turn come first, marked new.
- `contextHash(person, facts, findingKeys = [])`: empty list hashes exactly as today (existing reads stay fresh; test pins it). `/model` prompt lists new findings under `<new_information>`.

### 5. Coach tools, compaction, tracing
- `recall`/`connect` output: tone, date, `[q:id]`; all tool results capped (`capResult`, ~6k chars; GROQ less). Then `COACH_STEPS = 12`.
- New tools in `lib/ai/coach.ts` with injected deps: `quote(edgeId)` (decrypt, find line by `quoteTs`+sender, ±2 lines), `findings(kind?)`, `history(about)`, `search_history(query)` (Postgres FTS `to_tsvector('simple', parts::text)` + thread summaries, `mode = 'coach'` only, merged with `searchMessages`, labelled by source), `check_draft(text)` (risk over `mentioned()` nodes + `applyVoice` diff).
- `COACH_SYSTEM`: the quote-marker rule; `check_draft` before any message to send.
- `lib/ai/compact.ts`: pure `needsCompaction(rows, budget)` (> `COACH_HISTORY` or ~40% of budget) and `splitForSummary()`; cheap-model summary into `CoachThread.summary` + `summaryThroughId` in `after()`; route sends summary ahead of messages after `summaryThroughId`. Rows never deleted.
- `CoachMessage.trace` written in `onEnd` (focus node ids, edge/finding ids in context, tools + result sizes, chars vs budget, provider, model, steps); small "why?" toggle in `components/coach-chat.tsx`.
- Tests: tool schemas accept old stored calls, seafood draft caught by `check_draft`, compaction keeps a turn-5 decision in a 200-message fixture, context stays inside budget.

### 6. Embeddings
- `lib/ai/embed.ts`: `embedModel(key)` for GEMINI (`gemini-embedding-001`, 768 dims), OPENAI (`text-embedding-3-small`), NIM (model id confirmed against NVIDIA docs at implementation); null for GROK/GROQ.
- Store: embed new node labels in the job, `$executeRaw` write; `nearestNode(personId, embedModel, vector)` with exact cosine ≥ 0.85. Feeds resolution (step 4 of the order) and `focusNodes()`.
- Tests: scoring/threshold pure with fixture vectors; every earlier flow re-run with embeddings off (the Groq path).

### 7. Rehearsal persona
- `voiceForPrompt(v, who = "user")`: `"user"` output byte-identical (snapshot test against today's string); `"them"` wording for her.
- `lib/ai/persona.ts`: `PERSONA_SYSTEM` (no warmer than evidence, real boundaries and habits, vague where the graph is empty, no sexual roleplay, reacts to pressure like someone setting a boundary), `exchangePairs(msgs, me, query, n)` (my line then her reply, ranked like `searchMessages`), `buildPersonaContext()`.
- `app/api/people/[id]/rehearse/route.ts`: no tools, `generateText`, `applyVoice` with her profile, thread `mode = "rehearsal"`; without a chat only if `enoughMemory()`, with an up-front "style is guessed" line. Thread create/save helpers shared with the coach route.
- UI: fourth tab in `components/person-tabs.tsx`, `app/(app)/people/[id]/rehearse/page.tsx`, `CoachChat` gets `mode` (endpoint, permanent banner "Simulation, not {name}. Nothing is sent to anyone.", different bubble style, "How did I do?").
- Debrief: opens a coach thread whose first message carries `metadata.debriefOf`; the coach route loads that transcript as `<rehearsal_transcript simulated>` and disables `remember`/`correct`.
- Coach page and `search_history` filter `mode = 'coach'`. Trash/purge/export already cover threads.
- Tests: persona context from a fixture profile (short replies, delays), rehearsal threads absent from search/extraction inputs.

### 8. Memory map
- `layout()` stays pure: adds typed edges between hubs with rel + tone colour, findings as badges. Click an edge with a quote calls a server action `edgeQuote(edgeId)` (owner-scoped through `getPerson`, decrypts server-side).

## Evals

- `tests/fixtures/scenarios/*.json`, 10 scenarios as listed; one pure test file runs each through `planMemory` + `buildGraph` and asserts expected edges and findings.
- `scripts/eval.mts` + `npm run eval`: skipped without `EVAL_PROVIDER`/`EVAL_API_KEY`; fully in memory (real extraction with `analysisSchema`, evidence picks, coach with tools); pass = expected finding + exact quote in the answer; prints pass rate per scenario.

## Not broken (checked per phase)

AES-GCM + `ENCRYPTION_KEY`, BYOK via `getActiveKey`, `CHAR_BUDGET`, model lock and hourly caps, incremental reads and `contextHash`, 30-day trash / purge / export, every query scoped by the `personId` from `getPerson(userId, …)`.

## Verification

- Every commit: `npm test`, `npm run lint`, `npm run build`.
- Per phase: its acceptance criteria as pure tests (listed above).
- Not verifiable by me without your DB and a key: migrations applying on Neon, `npm run eval` on Gemini Flash, live coach/rehearsal turns. I will say so per phase rather than claim them.

## Status

Updated after every phase: what changed, what was deferred.

- Step 0 done: branch `feat/coach-brain`, baseline green (63 tests, lint, build).
- Phase 1 done. `lib/graph/resolve.ts` (pure): exact, alias, then spelling score >= 0.6 (trigram, one name inside another, romanised Hindi within one edit). `planMemory` returns `aliases`; `linkMemories` stores them; `retagMemory` keeps edges to aliased tags; `resolve()` and `mentioned()` forgive spelling. Export includes `nodes` and `edges`. Purge prunes each affected person's graph.
  - Changed from the plan: purge reuses the existing `ungrounded()` / `pruneGraph()` (added in `ba4dac0`) instead of a new "no edge references it" query. It is stricter in the right direction: a category chain with no memory behind it goes too.
  - Changed from the plan: Hinglish spellings do not reach 0.6 on trigrams (paneer/panir is 0.3), so a romanisation rule was added (ee=i, oo=u, aa=a, doubles collapsed, one edit on words of 5+ letters).
  - New since the plan was written: provider `OPENROUTER` exists (`ba4dac0`). It gets a `CHEAP_MODEL`, and is treated as a no-embedding provider (trigram path).
  - Deferred: vector step of resolution (phase 6); the orphan-node purge has no unit test of its own beyond `ungrounded` (it is one SQL-backed call).
- Phase 2 done. `CHEAP_MODEL` per provider; `lib/graph/categories.ts` and `lib/graph/backfill.ts` (pure, model call injected); `lib/graph/job.ts` (`claimGraphRun`, `runGraphJob`, `scheduleGraphJob` via `after()`), triggered from the analyze route, the coach route and `saveFact`. Migration `20261117090000_graph_job` (not applied by me).
  - `sameAs` against a known name is an alias, as the plan said: the asked node is folded into that one (`applyMerges` in memory, `mergeNodes` in the job), its edges move, and "doodh" joins "milk". It is not a separate IS_A edge.
  - Changed from the plan: the job columns on `Person` moved from the phase 3 migration to this one, plus `graphFactsAt` (how far the triple backfill has got), so a memory with no edges to state is asked once, not every run.
  - Changed from the plan: `/model` does not schedule the job. It writes nothing to the graph; every path that does (analyze, coach, saveFact) schedules it.
  - A category that already has `NARROW` (6) children takes no more: a seventh would make `family()` stop relating all of them.
  - Not verified: the job against a real provider and database (`after()` timing on Netlify included).
- Phase 3 done. Migration `20261117100000_edge_evidence` (not applied by me). `lib/graph/evidence.ts` (pure: candidates, prompt, `acceptEvidence`, `chunk`), mining step in the job, `superseded()` + `history()` + "Changed on <date>" in `lib/graph.ts`, tone-weighted confidence on `cost`/`risk`, `[q:<edgeId>]` markers, `syncGraph()` in the store, `exportEdge()` (quote decrypted, no BigInt).
  - Changed from the plan: `quoteSender` holds "them" or "me", not the chat's sender name. It finds the line again just as well (with `quoteTs`) and lets the pure graph tell her lines from mine without knowing chat names.
  - Changed from the plan: extra column `MemoryEdge.minedAt`, so an edge the chat has no line for is searched once, then only in messages newer than `graphThroughAt`.
  - Changed from the prompt: a newer LIKES/WANTS does not supersede AVOIDS/FEARS (an allergy is not cancelled by enjoying something once); that pair stays a `mixed` finding. Everything else supersedes as asked.
  - Changed from the plan: `buildGraph` computes supersede itself from dates on every load (always right, also inside a coach turn); `supersededById` is the stored copy, kept in line by `syncGraph`.
  - `risk` is always reported whatever the tone; tone only moves its confidence. `cost` under 0.35 (sarcastic, cold, annoyed) is dropped.
  - Not verified: mining against a real chat and provider.
- Phase 4 done. Migration `20261117110000_memory_finding` (not applied by me). `tensions()` adds `attention`, `drift`, `open_promise`, each with a stable `key`, `edgeIds` and `confidence`. `lib/graph/findings.ts` (`diffFindings`, `newSince`); `syncGraph()` stores, updates, retires and revives; `brief(focus, fresh)` leads with findings new since the conversation's last turn; `contextHash` folds in finding keys; the `/model` prompt lists findings newer than the read's last update. Export includes findings.
  - `risk` is not stored: it depends on what is being discussed.
  - `drift` needs at least 2 of her quoted lines in each window (one line is not a baseline). `open_promise` needs a date and N = 14 days.
  - `lastSeenAt` is written when a finding changes, not on every sync (a write per graph change would be noise). It reads as "last changed".
  - detach/reattach: `pruneGraph()` now ends with `syncGraph()`, so removing or moving a chat retires what rested on it, and `rebuildMemories` (through `linkMemories`) brings it back.
  - One-time effect on existing people: the first sync stores their findings, which changes the fingerprint and refreshes the advice once.
- Phase 5 done. Migration `20261117120000_coach_threads` (not applied by me). New coach tools `quote`, `findings`, `history`, `search_history`, `check_draft`; every tool result capped (`capFor`: 6k chars, 4k on Groq); `COACH_STEPS = 12`; prompt rules for quote markers and `check_draft`. `lib/ai/compact.ts` (pure) + `lib/ai/thread.ts` (`recentMessages`, `compactThread` in `after()`); `lib/ai/cheap.ts` (`cheapAsk`, `cheapText`). `CoachMessage.trace` written at the end of each reply; "why?" toggle loads it on demand (`loadTrace`).
  - Changed from the plan: the trace is not shipped with every message; the toggle fetches it when opened.
  - The history window is now "messages after the summary, at most 80" instead of "the last 60". Without a summary (compaction failing) it degrades to the latest 80.
  - `search_history` uses `jsonb_to_tsvector('simple', parts, '["string"]')` with no index (fine for hundreds of messages; marked `ponytail:` with the upgrade).
  - Not verified: the cheese eval on a real model, `search_history` SQL against Postgres, live compaction.
- Phase 6 done. Migration `20261117130000_node_embedding` (`CREATE EXTENSION vector`; not applied by me). `EMBED_MODEL` in `lib/ai/models.ts`; `lib/graph/vectors.ts` (`embed`, `nearestNodes` with exact cosine in SQL, `resolveByMeaning`, `embedMissing`, `focusNodes`); `planMemory` takes `same` and reports `fresh` nodes; `linkMemories`/`saveMemories` take the user's key; the job backfills missing embeddings.
  - NIM model is `baai/bge-m3`, called with a direct request carrying `input_type`. I could not confirm from NVIDIA's docs whether `input_type` is required for that model; sending it is the safe side. Not tested against the live API.
  - `OPENROUTER` is treated as unable to embed.
  - Embedding is best-effort everywhere: a failed call logs and the write or reply goes on by spelling.
  - `rebuildMemories` (a chat moved back) has no key in hand, so it resolves by spelling only; the job embeds those nodes later.
  - Not verified: any SQL in `vectors.ts` against a database with pgvector.
- Phase 7 done. `voiceForPrompt(v, who)` ("user" output proven byte-identical against the old function in `lib/voice.them.test.ts`). `lib/ai/persona.ts` (pure: `personaSystem`, `exchangePairs`, `buildPersonaContext`, `rehearsalTranscript`, `DEBRIEF_SYSTEM`). `app/api/people/[id]/rehearse/route.ts` (no tools, `generateText`, `applyVoice` with her profile, `mode: "rehearsal"`). Fourth tab "Practise", `CoachChat mode="rehearsal"` with the permanent banner, dashed amber "Simulated <name>" bubbles and "How did I do?". Debrief: a new coach thread stores `CoachThread.debriefOfId` (the rehearsal it is about; migration `20261117140000_thread_debrief`, not applied by me). Later turns read that column, the transcript is loaded each turn, and `remember`/`correct` are removed.
  - Isolation is by construction and pinned by a test that reads the route sources: the rehearse route imports no memory, graph or tool code; `search_history`, the coach page and coach thread lookup all filter `mode = 'coach'`.
  - The reply is sent whole (not streamed) so it can be corrected to her typing first.
  - Rehearsal threads share the coach's hourly message limit, the 30-day trash, purge and export (unchanged code paths; the export now shows `mode`).
  - Rehearsal threads are not compacted: the last 40 turns are sent.
  - Not verified: a live persona turn, the cheese consistency check (offered cheese, she declines for herself) on a real model. The prompt and the `<boundaries>` section carry it; the eval covers the coach, not the persona.
- Phase 8 done. `layout(facts, edges, findings)` stays pure and now returns `marks` (typed person-to-topic edges placed along the topic's spoke) and `flags` (findings per topic); `edgeColor` (tone over relation). Clicking a mark opens its detail and, when a line is stored, fetches it with the `edgeQuote` server action (owner-scoped, decrypted on demand; the cipher never reaches the client).
  - At most 4 marks per topic (the latest); superseded edges are not drawn.
  - Not verified in a browser: I could not sign in to the app (Google sign-in, your database), so the map, the Practise tab and the "why?" toggle are checked by types, lint, build and unit tests only.
