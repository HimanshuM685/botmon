import type { Graph } from "../graph";
import { HUBS } from "../graph";
import { normalizeFact } from "../facts";

/**
 * The user's own profile as prompt text, and what they have in common with a person. Pure.
 * Never given to the rehearsal persona: a simulation of the other person must not know the user's profile.
 */

/** Share of a provider's budget the profile may take. */
export const SELF_SHARE = 0.04;

export type PTrait = { kind: string; text: string; scope: string; relation: string | null; people: number; support: number; confidence: number; noEvidence: boolean };

const KIND: Record<string, string> = { INTEREST: "interest", HOBBY: "hobby", VALUE: "value", HABIT: "habit", TEXTING: "texting", AFFECTION: "affection", STRENGTH: "strength", BLIND_SPOT: "blind spot", PATTERN: "pattern", FACT: "fact" };
/** What the coach most needs first: where the user tends to go wrong, then how they act, then the rest. */
const ORDER = ["BLIND_SPOT", "PATTERN", "STRENGTH", "AFFECTION", "TEXTING", "VALUE", "INTEREST", "HOBBY", "HABIT", "FACT"];

/**
 * The block for prompts, within `budget` characters: the summary, then traits seen with several people, then ones
 * seen only with this kind of relationship. A trait that differs by relationship shows where it was seen.
 */
export function selfForPrompt(p: { summary: string | null; traits: PTrait[]; relation?: string; budget: number }) {
  const fits = p.traits.filter((t) => t.scope === "GLOBAL" || !p.relation || t.relation === p.relation);
  const rank = (t: PTrait) => ORDER.indexOf(t.kind) * 10 - (t.scope === "GLOBAL" ? 5 : 0) - t.confidence;
  const lines = [...fits].sort((a, b) => rank(a) - rank(b)).map((t) => {
    const where = t.scope === "GLOBAL" ? (t.noEvidence ? "seen before" : `with ${t.people} people`) : `with this ${(t.relation ?? "").toLowerCase()}`;
    return `- [${KIND[t.kind] ?? t.kind.toLowerCase()}, ${where}] ${t.text}`;
  });
  const out: string[] = [];
  let used = 0;
  for (const line of [...(p.summary ? [p.summary] : []), ...lines]) {
    if (used + line.length + 1 > p.budget) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

const words = (s: string) => ` ${normalizeFact(s)} `;

/**
 * What the user has in common with the person, from the user's interests, hobbies and values against what the
 * person likes, wants or talks about in their graph; and where something the user loves touches what the person
 * avoids or fears. Lines for the coach to build suggestions on.
 */
export function commonGround(traits: PTrait[], graph: Graph, name: string, max = 8) {
  const them = graph.nodes.find((n) => n.key === "them");
  if (!them) return "";
  const theirs = graph.edges.filter((e) => e.fromId === them.id);
  const out: string[] = [], seen = new Set<string>();
  for (const t of traits.filter((x) => ["INTEREST", "HOBBY", "VALUE", "HABIT"].includes(x.kind))) {
    for (const n of graph.mentioned(t.text).filter((x) => !HUBS.has(x.key))) {
      const fam = graph.family(n.id);
      for (const e of theirs) {
        const how = fam.get(e.toId);
        if (!how || seen.has(`${t.text}|${e.id}`)) continue;
        seen.add(`${t.text}|${e.id}`);
        const what = graph.name(e.toId);
        if (["LIKES", "WANTS", "MENTIONS", "DID_FOR"].includes(e.rel))
          out.push(`+ You: ${t.text}. ${name} ${e.rel === "MENTIONS" ? "talks about" : e.rel === "DID_FOR" ? "did something with" : e.rel.toLowerCase()} ${what}${how === "itself" ? "" : ` (${how === "kind" ? "same kind of thing" : "related"})`}.`);
        else if (["AVOIDS", "FEARS", "DISLIKES"].includes(e.rel))
          out.push(`! You: ${t.text}. But ${name} ${e.rel.toLowerCase()} ${what}${e.label ? ` (${e.label})` : ""}: don't build a plan on it.`);
      }
    }
  }
  // Common ground first, cautions after.
  return [...out.filter((l) => l.startsWith("+")), ...out.filter((l) => l.startsWith("!"))].slice(0, max).join("\n");
}

/** True when a text mentions any of the traits (used by tests to prove the persona never sees the profile). */
export const mentionsAny = (text: string, traits: { text: string }[]) => traits.some((t) => words(text).includes(words(t.text).trim()));
