import type { DeepPartial } from "ai";
import type { Analysis } from "./ai/schema";
import type { Triple } from "./graph";

export type FactInput = {
  kind: "FACT" | "EVENT" | "DATE" | "PREFERENCE";
  text: string;
  happenedAt: Date | null;
  entities: string[];
  /** How the person felt about it ("hurt", "excited"), and how good or bad it was for them: -2..2. */
  feeling: string | null;
  valence: number | null;
  /** Graph edges this memory states ("them AVOIDS milk"); stored as MemoryEdge rows, not on the fact (lib/graph-store.ts). */
  triples?: Triple[];
};

const toTriples = (list: (Partial<Triple> | undefined)[] | undefined): Triple[] =>
  (list ?? []).flatMap((t) => (t?.from && t.rel && t.to ? [{ from: t.from, rel: t.rel, to: t.to, label: t.label ?? "" }] : [])).slice(0, 8);

/** One short lowercase feeling, or null when none was given. */
export const toFeeling = (s: string | null | undefined) => s?.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 24) || null;

/** -2 (very bad for them) .. 2 (very good). Only kept next to a feeling; unknown counts as neutral. */
export const toValence = (n: unknown, feeling: string | null) => (feeling ? Math.max(-2, Math.min(2, Math.round(Number(n)) || 0)) : null);

const felt = (feeling: string | null | undefined, valence: unknown) => {
  const f = toFeeling(feeling);
  return { feeling: f, valence: toValence(valence, f) };
};

/**
 * Most tags a memory carries. One number for what a form or model may give (toEntities) and what the graph caches
 * on the fact (planMemory): if the cache held more than an edit can send back, saving an edit would drop links.
 */
export const MAX_TAGS = 8;

/** One spelling per entity so memories connect: "Sister Riya!" and "sister  riya" are the same node. */
export const normalizeEntity = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 40);

/**
 * Clean tag list for a memory: normalised, de-duplicated, at most MAX_TAGS.
 * ponytail: exact match after normalising ("sis riya" and "sister riya" stay separate); embeddings would merge those.
 */
export function toEntities(tags: (string | undefined)[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => normalizeEntity(t ?? "")).filter((t) => t.length > 1))].slice(0, MAX_TAGS);
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
    out.push({ kind, text: !date && f.when ? `${f.fact} (${f.when})` : f.fact, happenedAt: date, entities: toEntities(f.about), ...felt(f.feeling, f.valence), triples: toTriples(f.triples) });
  }
  for (const d of a.importantDates ?? []) {
    if (!d?.what) continue;
    const date = toDate(d.date);
    out.push({ kind: "DATE", text: date ? d.what : `${d.what} (${d.date ?? "date unknown"})`, happenedAt: date, entities: toEntities(d.about), feeling: null, valence: null });
  }
  return out;
}

/** Never edited by the user since it was saved. Background work only fills in memories like this: an edit is a choice that stands. */
export const untouched = (f: { createdAt: Date; updatedAt: Date }) => f.updatedAt.getTime() - f.createdAt.getTime() < 1000;

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

type PromptFact = { kind: string; text: string; happenedAt: Date | null; entities?: string[]; feeling?: string | null; valence?: number | null };

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Compact one-line-per-fact rendering for prompts. Tags show which memories belong together, `felt` how it landed for them. */
export function factsForPrompt(facts: PromptFact[]) {
  return facts
    .map((f) => {
      const tags = [f.entities?.length ? `about: ${f.entities.join(", ")}` : "", f.feeling ? `felt: ${f.feeling}${f.valence ? ` ${signed(f.valence)}` : ""}` : ""].filter(Boolean);
      return `- [${f.kind.toLowerCase()}${f.happenedAt ? ` ${day(f.happenedAt)}` : ""}] ${f.text}${tags.length ? ` {${tags.join("; ")}}` : ""}`;
    })
    .join("\n");
}

/** Does this memory share a tag with the given set? The edge of the memory graph. */
export const sharesTag = (f: { entities?: string[] }, tags: Set<string>) => !!f.entities?.some((e) => tags.has(e));

const MAP_TOPICS = 12, MAP_RECENT = 8;

/**
 * The emotion graph as a prompt block: how each person, place or topic tends to make them feel (from the
 * feelings on the memories tagged with it), and their latest dated feelings in order. "" when nothing is felt yet.
 * ponytail: plain averages over tags; no decay with age, no cause links. Add weighting if old feelings start to mislead.
 */
export function emotionMap(facts: PromptFact[]) {
  const withFeeling = facts.filter((f) => f.feeling);
  const topics = new Map<string, { sum: number; n: number; feelings: Map<string, number> }>();
  for (const f of withFeeling)
    for (const e of f.entities ?? []) {
      const t = topics.get(e) ?? { sum: 0, n: 0, feelings: new Map<string, number>() };
      t.sum += f.valence ?? 0;
      t.n++;
      t.feelings.set(f.feeling!, (t.feelings.get(f.feeling!) ?? 0) + 1);
      topics.set(e, t);
    }
  const lean = (avg: number) => (avg <= -1 ? "mostly bad for them" : avg < -0.25 ? "leans bad" : avg >= 1 ? "mostly good for them" : avg > 0.25 ? "leans good" : "mixed");
  const byTopic = [...topics.entries()]
    .filter(([, t]) => t.n >= 2)
    .sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum) || a[0].localeCompare(b[0]))
    .slice(0, MAP_TOPICS)
    .map(([e, t]) => `- ${e}: ${lean(t.sum / t.n)} (${[...t.feelings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w, c]) => (c > 1 ? `${w} x${c}` : w)).join(", ")})`);
  const recent = withFeeling
    .filter((f) => f.happenedAt)
    .sort((a, b) => a.happenedAt!.getTime() - b.happenedAt!.getTime())
    .slice(-MAP_RECENT)
    .map((f) => `- ${day(f.happenedAt!)} ${f.feeling}${f.valence ? ` ${signed(f.valence)}` : ""}: ${f.text.slice(0, 90)}`);
  return [
    byTopic.length ? `How each person, place or topic has made them feel so far:\n${byTopic.join("\n")}` : "",
    recent.length ? `Their feelings over time, oldest first:\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Keep the facts that fit in `maxChars` of prompt, so a timeline that grows with every read never pushes
 * the prompt past the model's limit. When not everything fits, memories connected to `focus` (entities the
 * current conversation or update is about) are kept first, then the latest ones.
 */
export function factsWithinBudget<T extends PromptFact>(facts: T[], maxChars: number, focus: string[] = []) {
  const size = (f: T) => f.text.length + 24 + (f.entities?.length ? f.entities.join(", ").length + 10 : 0) + (f.feeling ? f.feeling.length + 12 : 0); // prefix "- [preference 2026-01-01] " + tags
  const wanted = new Set(focus);
  // One hop out: what the focused memories are also about ("wedding" pulls in "sister riya").
  const near = new Set(facts.filter((f) => sharesTag(f, wanted)).flatMap((f) => f.entities ?? []));
  const rank = (f: T) => (sharesTag(f, wanted) ? 2 : sharesTag(f, near) ? 1 : 0);
  // Newest first (the list is oldest first), connected ones ahead of the rest.
  const order = facts.map((_, i) => i).reverse();
  if (wanted.size) order.sort((a, b) => rank(facts[b]) - rank(facts[a]));
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
