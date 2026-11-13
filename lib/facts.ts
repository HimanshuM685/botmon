import type { DeepPartial } from "ai";
import type { Analysis } from "./ai/schema";

export type FactInput = { kind: "FACT" | "EVENT" | "DATE" | "PREFERENCE"; text: string; happenedAt: Date | null; entities: string[] };

/** One spelling per entity so memories connect: "Sister Riya!" and "sister  riya" are the same node. */
export const normalizeEntity = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 40);

/**
 * Clean tag list for a memory: normalised, de-duplicated, at most 6.
 * ponytail: exact match after normalising ("sis riya" and "sister riya" stay separate); embeddings would merge those.
 */
export function toEntities(tags: (string | undefined)[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => normalizeEntity(t ?? "")).filter((t) => t.length > 1))].slice(0, 6);
}

/** Same fact said slightly differently ("Loves  coffee." vs "loves coffee") counts as one. */
export const normalizeFact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Full dates only ("YYYY-MM-DD", optionally followed by a time); "March" or "next week" stay in the text instead. */
export function toDate(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function factsFromAnalysis(a: DeepPartial<Analysis>): FactInput[] {
  const out: FactInput[] = [];
  for (const f of a.keyFacts ?? []) {
    if (!f?.fact) continue;
    const date = toDate(f.when);
    const kind = f.category === "preference" ? "PREFERENCE" : f.category === "event" || f.category === "plan" ? "EVENT" : "FACT";
    out.push({ kind, text: !date && f.when ? `${f.fact} (${f.when})` : f.fact, happenedAt: date, entities: toEntities(f.about) });
  }
  for (const d of a.importantDates ?? []) {
    if (!d?.what) continue;
    const date = toDate(d.date);
    out.push({ kind: "DATE", text: date ? d.what : `${d.what} (${d.date ?? "date unknown"})`, happenedAt: date, entities: [] });
  }
  return out;
}

/** Drop candidates already stored (or repeated within the batch). */
export function newFacts(existing: string[], candidates: FactInput[]): FactInput[] {
  const seen = new Set(existing.map(normalizeFact));
  return candidates.filter((c) => {
    const k = normalizeFact(c.text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type PromptFact = { kind: string; text: string; happenedAt: Date | null; entities?: string[] };

/** Compact one-line-per-fact rendering for prompts. Tags show which memories belong together. */
export function factsForPrompt(facts: PromptFact[]) {
  return facts
    .map((f) => `- [${f.kind.toLowerCase()}${f.happenedAt ? ` ${f.happenedAt.toISOString().slice(0, 10)}` : ""}] ${f.text}${f.entities?.length ? ` {about: ${f.entities.join(", ")}}` : ""}`)
    .join("\n");
}

/**
 * Keep the facts that fit in `maxChars` of prompt, so a timeline that grows with every read never pushes
 * the prompt past the model's limit. When not everything fits, memories connected to `focus` (entities the
 * current conversation or update is about) are kept first, then the latest ones.
 */
export function factsWithinBudget<T extends PromptFact>(facts: T[], maxChars: number, focus: string[] = []) {
  const size = (f: T) => f.text.length + 24 + (f.entities?.length ? f.entities.join(", ").length + 10 : 0); // prefix "- [preference 2026-01-01] " + tags
  const wanted = new Set(focus);
  const connected = (f: T) => !!f.entities?.some((e) => wanted.has(e));
  // Newest first (the list is oldest first), connected ones ahead of the rest.
  const order = facts.map((_, i) => i).reverse();
  if (wanted.size) order.sort((a, b) => Number(connected(facts[b])) - Number(connected(facts[a])));
  const keep = new Set<number>();
  let used = 0;
  for (const i of order) {
    const len = size(facts[i]);
    if (used + len > maxChars) {
      if (!wanted.size) break; // plain tail cut: stop at the first one that doesn't fit
      continue;
    }
    keep.add(i);
    used += len;
  }
  return { facts: facts.filter((_, i) => keep.has(i)), chars: used };
}

/** Entities named in a piece of text (a user message, a new memory), to focus memory selection on. */
export function entitiesIn(text: string, known: Iterable<string>) {
  const t = ` ${normalizeEntity(text)} `;
  return [...new Set(known)].filter((e) => t.includes(` ${e} `));
}

/** Share of a provider's prompt budget the timeline may use. */
export const FACTS_SHARE = 0.15;
