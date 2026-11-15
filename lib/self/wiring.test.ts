import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { exportEdge } from "../graph/export";
import { SOFT_DELETE_MODELS } from "../soft-delete";
import { rescope, type Ev } from "./traits";
import { selfTools } from "./coach";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

it("export: a trait's evidence carries the user's line decrypted and no BigInt", () => {
  expect(exportEdge({ id: "e", traitId: "t", quoteCipher: "c1", quoteTs: BigInt(1763114640000) }, (b) => `line:${b}`)).toEqual({ id: "e", traitId: "t", quoteTs: 1763114640000, quote: "line:c1" });
  expect(exportEdge({ quoteCipher: null, quoteTs: BigInt(5) }, String)).toEqual({ quoteTs: 5, quote: null });
  const route = src("app/api/export/route.ts");
  expect(route).toContain("you,");
  expect(route).toContain("voices: voiceCipher ? JSON.parse(decrypt(voiceCipher)) : null"); // never an encrypted blob in the export
});

it("hidden traits use the 30-day trash and purge; user-owned traits survive re-reads and consolidation", () => {
  expect(SOFT_DELETE_MODELS.has("SelfTrait")).toBe(true);
  expect(src("lib/purge.ts")).toContain("db.selfTrait.deleteMany({ where: { deletedAt: old } })");
  const store = src("lib/self/store.ts");
  // A re-read finds the trait by key and leaves its text alone: an edit by the user stands.
  expect(store).toMatch(/create: \{ userId, kind: it\.kind, key: it\.key, text: it\.text, source \},\s*update: \{\},/);
  expect(store).toContain("skipDuplicates: true"); // the same line twice is one piece of evidence
});

it("every thread lookup accepts a person's thread or the user's own, never someone else's", () => {
  const actions = src("app/actions.ts");
  expect(actions).toContain("OR: [{ person: { userId } }, { userId }]"); // trash and restore
  expect(actions).toContain("OR: [{ person: { userId: user.id } }, { userId: user.id }]"); // rename
  expect(actions).toContain("OR: [{ person: { userId: user.id, ...alive } }, { userId: user.id }]"); // trace
  expect(src("lib/ai/turn.ts")).toContain("thread: { OR: [{ person: { userId } }, { userId }] }"); // hourly cap
  const me = src("app/api/me/coach/route.ts");
  expect(me).toContain('where: { id: parsed.data.threadId, userId, mode: "self", deletedAt: null }');
  expect(me).not.toMatch(/saveMemories|coachTools|loadGraph/); // a self thread touches no person's memory
});

it("Coach me saves only through rememberMe, which needs something to save", async () => {
  const saved: string[] = [];
  const t = selfTools(async (k, x) => (saved.push(`${k}:${x}`), true));
  const run = (i: object) => (t.rememberMe.execute as unknown as (i: object, o: object) => Promise<unknown>)(i, {});
  expect(await run({ kind: "VALUE", text: "Family comes first" })).toEqual({ saved: true, text: "Family comes first" });
  expect(await run({})).toEqual({ saved: false });
  expect(saved).toEqual(["VALUE:Family comes first"]);
});

const now = Date.UTC(2026, 10, 15);
const ev = (personId: string, hidden = false): Ev => ({ personId, relation: personId === "p1" ? "CRUSH" : "FRIEND", at: new Date(now - 86_400_000), hidden });
const t = { source: "ANALYSIS", scope: "GLOBAL" as const, edited: false, pinned: false, confidence: 0.7, noEvidence: false };

it("deletion: trash, restore, purge, forget, remove and move, seen from the evidence that is left", () => {
  const both = [ev("p1"), ev("p2")];
  expect(rescope(t, both, now)).toMatchObject({ data: { scope: "GLOBAL", people: 2 } });
  // p1 in the trash: only p2 counts, so the trait narrows to p2's relationship.
  expect(rescope(t, [ev("p1", true), ev("p2")], now)).toMatchObject({ data: { scope: "RELATION", relation: "FRIEND", people: 1 } });
  // Restored: both count again.
  expect(rescope(t, both, now)).toMatchObject({ data: { people: 2 } });
  // p1 purged, or forgotten, or its chat removed or moved away: its evidence rows are gone.
  expect(rescope({ ...t, scope: "RELATION" }, [ev("p2")], now)).toMatchObject({ data: { relation: "FRIEND", support: 1 } });
  // Both gone: a global trait stays as plain text, flagged; a relation trait is deleted.
  expect(rescope(t, [], now)).toMatchObject({ action: "update", data: { noEvidence: true } });
  expect(rescope({ ...t, scope: "RELATION" }, [], now)).toEqual({ action: "delete" });
  const actions = src("app/actions.ts");
  expect(actions).toContain("db.selfEvidence.deleteMany({ where: { personId: chat.personId, OR: [{ chatId: chat.id }, { analysisId: { in: reads } }] } })");
  expect(actions).toContain("if (opts.forgetMe) await db.selfEvidence.deleteMany");
});
