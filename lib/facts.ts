import type { DeepPartial } from "ai";
import type { Analysis } from "./ai/schema";

export type FactInput = { kind: "FACT" | "EVENT" | "DATE" | "PREFERENCE"; text: string; happenedAt: Date | null };

/** Same fact said slightly differently ("Loves  coffee." vs "loves coffee") counts as one. */
export const normalizeFact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Full dates only; "March" or "next week" stay in the text instead. */
function toDate(s: string | undefined): Date | null {
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
    out.push({ kind, text: !date && f.when ? `${f.fact} (${f.when})` : f.fact, happenedAt: date });
  }
  for (const d of a.importantDates ?? []) {
    if (!d?.what) continue;
    const date = toDate(d.date);
    out.push({ kind: "DATE", text: date ? d.what : `${d.what} (${d.date ?? "date unknown"})`, happenedAt: date });
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

/** Compact one-line-per-fact rendering for prompts. */
export function factsForPrompt(facts: { kind: string; text: string; happenedAt: Date | null }[]) {
  return facts.map((f) => `- [${f.kind.toLowerCase()}${f.happenedAt ? ` ${f.happenedAt.toISOString().slice(0, 10)}` : ""}] ${f.text}`).join("\n");
}
