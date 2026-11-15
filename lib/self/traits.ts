import { normalizeFact } from "../facts";
import { rankMessages } from "../chat-lines";
import type { Msg } from "../parsers/types";
import { SELF_KINDS } from "../ai/schema";

/**
 * The user's traits, pure: which proposed items are really about the user (proven by one of their own lines),
 * how a trait is keyed, and its scope and confidence from the evidence behind it.
 */

export type SelfKind = (typeof SELF_KINDS)[number];
export type Item = { kind: string; text: string; quote?: string; when?: string };
export type Verified = { kind: SelfKind; text: string; key: string; line: string | null; ts: number };

/** Same trait however it is worded in punctuation and case. Never longer than a row key needs. */
export const traitKey = (text: string) => normalizeFact(text).slice(0, 120);

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Remove every name of another person from a line about the user: whole words, any case, replaced by "them".
 * "Texts Riya good night every day" -> "Texts them good night every day".
 */
export function stripNames(text: string, names: string[]) {
  const words = [...new Set(names.flatMap((n) => [n, ...n.split(/\s+/)]).map((w) => w.trim()).filter((w) => w.length >= 2))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const w of words) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), "them");
  return out.replace(/\b(them)(\s+them)+\b/gi, "them").replace(/\s{2,}/g, " ").trim();
}

/**
 * Keep only items proven by one of the USER's own messages: the quote must be in a message sent by `myName`.
 * This is what keeps the other person's traits out. Names are stripped from the text; an item that is nothing
 * but a name is dropped. `msgs` absent: no chat to check against, so nothing with a quote can be kept.
 */
export function verifyItems(items: Item[], msgs: Msg[], myName: string, names: string[]): Verified[] {
  const out: Verified[] = [], seen = new Set<string>();
  for (const it of items) {
    if (!(SELF_KINDS as readonly string[]).includes(it.kind)) continue;
    const q = squash(it.quote ?? "");
    if (q.length < 3) continue;
    // The model may trim or reflow a quote: look among the messages sharing its words, then require containment.
    const i = rankMessages(msgs, q).slice(0, 30).find((j) => {
      const t = squash(msgs[j].text);
      return t.includes(q) || (q.includes(t) && t.length >= q.length * 0.7);
    });
    if (i === undefined || msgs[i].sender !== myName) continue;
    const text = stripNames(it.text.trim(), names).slice(0, 200);
    const key = traitKey(text);
    if (key.replace(/\bthem\b/g, "").trim().length < 3 || seen.has(`${it.kind}|${key}`)) continue;
    seen.add(`${it.kind}|${key}`);
    out.push({ kind: it.kind as SelfKind, text, key, line: msgs[i].text, ts: msgs[i].ts });
  }
  return out;
}

/** An item the user told the coach (no chat line): kept when its kind is known and it says something. */
export function toldItem(kind: string, text: string, names: string[]): Verified | null {
  if (!(SELF_KINDS as readonly string[]).includes(kind)) return null;
  const clean = stripNames(text.trim(), names).slice(0, 200);
  const key = traitKey(clean);
  return key.replace(/\bthem\b/g, "").trim().length < 3 ? null : { kind: kind as SelfKind, text: clean, key, line: null, ts: Date.now() };
}

export type Ev = { personId: string; relation: string; at: Date; /** the person is in the trash */ hidden: boolean };
export type TraitState = { source: string; scope: "GLOBAL" | "RELATION"; edited: boolean; pinned: boolean; confidence: number; noEvidence: boolean };
type Update = { scope: "GLOBAL" | "RELATION"; relation: string | null; support: number; people: number; confidence: number; lastSeenAt: Date | null; noEvidence: boolean };

const DAY = 86_400_000;
/** Unseen this long, a trait counts for less: people change. */
export const STALE_DAYS = 90;

/**
 * A trait's standing from its evidence. Only evidence of people not in the trash counts, so trashing a person
 * hides what they taught and restoring brings it back (nothing is deleted).
 * - 2+ people: GLOBAL. 1: RELATION, tagged with that relationship type (never a name).
 * - Confidence grows with evidence and people, and drops when the trait hasn't been seen for STALE_DAYS.
 * - No evidence at all (its people were purged): a GLOBAL trait stays as plain text, flagged and lowered; a
 *   RELATION one goes. What the user wrote, edited or pinned always stays.
 */
export function rescope(t: TraitState, evidence: Ev[], now = Date.now()): { action: "update"; data: Update } | { action: "delete" } {
  const live = evidence.filter((e) => !e.hidden);
  const userOwned = t.source === "USER" || t.edited || t.pinned;
  if (!evidence.length) {
    if (userOwned) return { action: "update", data: { scope: t.scope, relation: null, support: 0, people: 0, confidence: t.confidence, lastSeenAt: null, noEvidence: false } };
    if (t.scope === "GLOBAL" || t.noEvidence) return { action: "update", data: { scope: "GLOBAL", relation: null, support: 0, people: 0, confidence: Math.min(t.confidence, 0.3), lastSeenAt: null, noEvidence: true } };
    return { action: "delete" };
  }
  const people = new Set(live.map((e) => e.personId));
  const last = live.reduce<Date | null>((m, e) => (!m || e.at > m ? e.at : m), null);
  const scope = people.size >= 2 ? "GLOBAL" : people.size === 1 ? "RELATION" : t.scope;
  let confidence = Math.min(0.95, 0.35 + 0.08 * Math.min(live.length, 5) + 0.12 * Math.min(Math.max(people.size - 1, 0), 3));
  if (last && now - last.getTime() > STALE_DAYS * DAY) confidence *= 0.6;
  if (!live.length) confidence = 0; // every person behind it is in the trash: hidden until one comes back
  return {
    action: "update",
    data: { scope, relation: people.size === 1 ? live.find((e) => people.has(e.personId))!.relation : null, support: live.length, people: people.size, confidence: Math.round(confidence * 100) / 100, lastSeenAt: last, noEvidence: false },
  };
}

/** Shown to the user and to prompts: has live evidence, or is the user's own, or outlived its evidence. */
export const visible = (t: { support: number; source: string; edited: boolean; pinned: boolean; noEvidence: boolean }) =>
  t.support > 0 || t.source === "USER" || t.edited || t.pinned || t.noEvidence;

/** The user's own `me` edges in a person's graph as traits: what they like, want, dislike or fear. */
export const ME_EDGE: Record<string, { kind: SelfKind; verb: string }> = {
  LIKES: { kind: "INTEREST", verb: "Likes" }, WANTS: { kind: "VALUE", verb: "Wants" }, DISLIKES: { kind: "FACT", verb: "Dislikes" }, FEARS: { kind: "FACT", verb: "Is afraid of" },
};
export function meEdgeItem(rel: string, label: string): Verified | null {
  const m = ME_EDGE[rel];
  if (!m || label.trim().length < 2) return null;
  const text = `${m.verb} ${label.trim()}`;
  return { kind: m.kind, text, key: traitKey(text), line: null, ts: 0 };
}
