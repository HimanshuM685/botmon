import { z } from "zod";
import { tripleSchema } from "../ai/schema";
import { untouched } from "../facts";
import type { GEdge, Triple } from "../graph";

/**
 * Triple backfill: memories saved before the graph had typed edges only say "them MENTIONS x". A cheap model
 * reads each one again and states its edges. Pure: which memories, the prompt, which answers to accept.
 */

type Fact = { id: string; text: string; entities: string[]; createdAt: Date; updatedAt: Date };

export const backfillAnswerSchema = z.object({
  items: z.array(z.object({ n: z.number().describe("The memory's number in the list"), triples: z.array(tripleSchema).describe("0-4 edges this memory states. Empty when it states none.") })),
});
export type BackfillAnswer = z.infer<typeof backfillAnswerSchema>["items"];

/**
 * Memories with no typed edge yet. Never ones the user edited (their tags are a choice that stands), and the
 * caller only passes alive ones, so nothing trashed is touched or brought back.
 */
export function needsTriples<T extends Fact>(facts: T[], edges: GEdge[]): T[] {
  const typed = new Set(edges.filter((e) => e.factId && e.rel !== "MENTIONS").map((e) => e.factId));
  return facts.filter((f) => untouched(f) && !typed.has(f.id));
}

export function backfillPrompt(facts: { text: string }[], personName: string, known: string[]) {
  return `These are memories about ${personName}, someone in the user's life. For each one, give the graph edges it states: who feels or did what towards what. Use 'them' for ${personName} and 'me' for the user. Only edges the memory itself states; an empty list is a fine answer. Link a thing to what it is a kind of or made from when that is certain (cheese IS_A milk product).

Known names (reuse them exactly when you mean the same thing): ${known.join(", ") || "none"}

Memories:
${facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n")}`;
}

/** The answers as link items, for memories that were asked about and got at least one edge. Tags stay as they are. */
export function acceptTriples(answer: BackfillAnswer, asked: Fact[]): { factId: string; tags: string[]; triples: Triple[] }[] {
  const seen = new Set<number>();
  return answer.flatMap((a) => {
    const f = asked[a.n - 1];
    if (!f || seen.has(a.n) || !a.triples?.length) return [];
    seen.add(a.n);
    return [{ factId: f.id, tags: f.entities, triples: a.triples.slice(0, 4) }];
  });
}
