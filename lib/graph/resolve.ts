import type { GNode } from "../graph";

/**
 * Entity resolution: is this new name a node the graph already has, spelled differently?
 * Pure (keys in, a node out), so the server store and the coach's in-turn graph decide the same way.
 * Keys are already normalised (lib/facts.ts normalizeEntity): lowercase words separated by single spaces.
 */

/** A new name scoring at least this against an existing node is that node. */
export const MATCH_MIN = 0.6;

/** Trigrams the way pg_trgm cuts them: per word, padded with two spaces in front and one behind. */
function grams(key: string) {
  const out = new Set<string>();
  for (const w of key.split(" ")) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm similarity(): shared trigrams over all trigrams, 0..1. */
export function similarity(a: string, b: string) {
  const x = grams(a), y = grams(b);
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return shared / (x.size + y.size - shared || 1);
}

/** Romanised Hindi spells one sound several ways: long vowels doubled or not, consonants doubled or not. */
const roman = (key: string) => key.replace(/ee/g, "i").replace(/oo/g, "u").replace(/aa/g, "a").replace(/(.)\1+/g, "$1");

/** At most one letter changed, added or dropped. */
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i + (s.length === l.length ? 1 : 0)) === l.slice(i + 1);
}

/**
 * How likely two keys name the same thing, 0..1. The best of:
 * - trigram similarity (typos, plurals: "samosa" / "samosas")
 * - one name sitting inside the other as whole words at its start or end ("paneer" / "paneer cubes"): 1
 * - the same romanised word, give or take one letter (Hinglish spellings: "paneer" / "panir", "doodh" / "dudh"): 0.7
 * ponytail: spelling only, so "dahi" and "curd" stay apart. Embeddings (lib/graph/vectors.ts) or a sameAs merge
 * (lib/graph/categories.ts) join those. A trailing s is not identity: "day" is not "days".
 */
export function nameScore(a: string, b: string) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`))) return 1;
  return spellScore(a, b);
}

/** nameScore without the one-inside-the-other rule: the same word spelled differently, nothing more. */
export function spellScore(a: string, b: string) {
  if (a === b) return 1;
  const sim = similarity(a, b);
  const [x, y] = [roman(a), roman(b)];
  // ponytail: one edit on words of 5+ letters also joins "sister" and "sitter"; raise the length if that bites.
  if (x === y || (Math.min(x.length, y.length) >= 5 && oneEdit(x, y))) return Math.max(sim, 0.7);
  return sim;
}

/**
 * The existing node a new key belongs to, or undefined when it is new. `candidates` are the nodes a fuzzy match
 * may land on: the caller leaves out the hubs and categories (a node other things belong under), because
 * "milk" must never be folded into "milk product". Ties go to the earlier node.
 */
export function matchNode(key: string, candidates: GNode[], min = MATCH_MIN): GNode | undefined {
  let best: GNode | undefined, top = 0;
  for (const n of candidates) {
    const score = Math.max(nameScore(key, n.key), ...n.aliases.map((a) => nameScore(key, a)));
    if (score >= min && score > top) [best, top] = [n, score];
  }
  return best;
}

/** Two labels whose embeddings are at least this close (cosine) name the same thing. */
export const COSINE_MIN = 0.85;

export function cosine(a: number[], b: number[]) {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return x && y ? dot / Math.sqrt(x * y) : 0;
}

/** The closest candidate at or over the bar. What the database does with pgvector (lib/graph/vectors.ts), in plain code. */
export function nearest<T extends { vector: number[] }>(vector: number[], candidates: T[], min = COSINE_MIN): T | undefined {
  let best: T | undefined, top = min;
  for (const c of candidates) {
    const score = cosine(vector, c.vector);
    if (score >= top) [best, top] = [c, score];
  }
  return best;
}

const COMMON = new Set("that this with have from what when where should would could about there their them they then than your yours will just like want been into some more also very really maybe think know going tell does did were here which because while after before again still even much many".split(" "));

/** Words of a message worth an embedding lookup: not short, not everyday, not already matched to a node by spelling. */
export function contentWords(text: string, matched: string[], max = 8) {
  const taken = new Set(matched.flatMap((k) => k.split(" ")));
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter((w) => w.length >= 4 && !COMMON.has(w) && !taken.has(w) && !/^\d+$/.test(w)).slice(0, max);
}
