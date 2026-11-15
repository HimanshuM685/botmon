# The "Me" profile

One profile of the user, learned only from their own side of every chat (and what they tell the coach), shared by every person's coach. It survives deleting a person. It never holds the other person's traits.

## What shipped

| Phase | What | Where |
|---|---|---|
| 1 | Both sides' voices stored at upload (encrypted), backfilled lazily; no route measures a voice per request. `User.selfNames` grows with each upload and preselects "me" in the uploader. Merged voice in `SelfProfile`. | `lib/data.ts` `getVoices`, `lib/self/voice.ts` `mergeVoices`, `lib/self/store.ts`, chat route |
| 2 | `SelfTrait` / `SelfEvidence`. `aboutUser` (max 8) on reads and chapters; kept only when the quote is one of the user's own messages; names stripped. The user's own graph edges (`me LIKES x`) promoted. `rememberMe` coach tool (off in debriefs). | `lib/self/traits.ts`, `lib/self/store.ts`, analyze + history routes, `lib/graph/job.ts`, `lib/ai/coach.ts` |
| 3 | Consolidation: near-duplicates merged (over 60 traits) and a summary, on the cheap model, behind a per-user lock and hourly cap. Runs after every graph job. Never touches edited, pinned or user-written traits. | `lib/self/consolidate.ts`, `lib/self/job.ts` |
| 4 | `<about_user>` (4% of the budget) in the coach, debriefs, reads and model updates; `<common_ground>` in the coach: the user's interests set against what the person likes, with cautions where it touches what they avoid. Drafts for a person with no chat use the merged voice. The rehearsal persona never gets any of it (tested). | `lib/self/prompt.ts`, coach / analyze / model routes, `lib/ai/prompt.ts` |
| 5 | `/me`: traits by kind with scope, evidence count and confidence; edit, pin, hide, add; voice habits (no sample messages shown). "Coach me" at `/me/coach`: threads owned by the user with no person. Traits in the trash, purge and export. | `app/(app)/me/*`, `components/self-profile.tsx`, `app/api/me/coach/route.ts`, `lib/self/coach.ts` |
| 6 | Trashed person: their evidence stops counting, restore brings it back. Purge: evidence cascades, then relation traits with none left are deleted and global ones kept, flagged. Removing or moving a chat deletes its evidence. "Also forget what this chat taught about me" when deleting a person. | `lib/self/traits.ts` `rescope`, `app/actions.ts`, `lib/purge.ts` |

Migrations (written, not applied): `20261119090000_self_voice`, `20261119100000_self_traits`, `20261119110000_self_threads`.

## Where the code differs from the spec

1. **Voices are encrypted, not `Json`.** A voice holds up to 40 of the user's real messages, so `ChatUpload.voiceCipher` / `SelfProfile.voiceCipher` hold `encrypt()`ed JSON. The export decrypts them.
2. **One row per trait: `@@unique([userId, kind, key])`.** Scope and relation are recomputed from evidence instead of being part of the key, so a trait doesn't change rows when it goes from RELATION to GLOBAL.
3. **Evidence is repeat-safe** with `@@unique([traitId, personId, quoteTs])`. `chatId` and `chapterId` are cascading foreign keys; `analysisId` is deleted explicitly with a removed chat's reads.
4. **Trashed evidence isn't deleted.** A trait whose only people are in the trash gets support 0 and confidence 0, and is not shown. Restoring the person brings it back.
5. **Traits the user writes are kept whatever happens to evidence.** That covers traits added on `/me`, edited, or pinned, and things told in "Coach me" (stored with source USER).
6. **Self threads.**
   - `CoachThread.personId` is nullable, plus `userId`, with a CHECK that exactly one is set. Every thread ownership query accepts `person.userId` or `userId`.
   - "Coach me" has one tool (`rememberMe`) and its own route. It reuses compaction but not the person coach's tools, graph, or trace.
7. **"Opposite traits show as 'varies'"** is simplified: a relation-scoped trait only shows to the coach of that relationship type, so "fast with crush" and "slow with friends" never contradict each other in one prompt. `/me` shows both, each with its relationship.

## Deferred

- **Re-learning on chat restore.** A restored or moved-back chat brings its memories back, but not its evidence about the user. The next read or chapter re-learns it.
- **GRAPH evidence from a removed chat's memories** has no chat id, so it stays until that person is purged.
- **Embedding-based trait merging.** The cheap-model consolidation covers near-duplicates.
- **"Why?" traces for Coach me replies.**

## Not verified

- Migrations against Neon, and every SQL path (consolidation lock, `array_append`, trait upserts).
- Real reads producing good `aboutUser` items.
- The `/me` pages in a signed-in browser.
