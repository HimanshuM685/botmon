import type { Analysis, ModelPatch } from "./ai/schema";
import { ADVICE_KEYS, PATCH_SECTIONS } from "./ai/schema";
import { computeScore, type ChatStats } from "./stats";

/** A person needs this much told about them (memories, plus notes) before a read can be built without a chat. */
export const enoughMemory = (facts: number, notes: string | null) => facts + (notes?.trim() ? 1 : 0) >= 3;

/**
 * Merge a model update into the saved read: advice is always replaced, judgement sections only when the
 * update re-wrote them (null = unchanged). The score is recomputed from the merged signals.
 */
export function applyPatch(read: Analysis, patch: ModelPatch, stats: ChatStats | null, now = Date.now()): Analysis {
  const next = { ...read } as Record<string, unknown>;
  for (const k of ADVICE_KEYS) next[k] = patch[k];
  for (const k of PATCH_SECTIONS) if (patch[k] != null) next[k] = patch[k];
  const out = next as unknown as Analysis;
  // Older reads have no signals: their stored score stays unless the update rated them.
  const score = out.signals ? computeScore(out.signals, stats, now) : read.status?.score;
  return { ...out, status: { ...out.status, score } };
}

type Dated = { updatedAt: Date; deletedAt: Date | null };

/** What the read has not seen yet: memories added or edited, and memories removed, since its last update. */
export function changedSince<T extends Dated>(facts: T[], since: Date | null) {
  if (!since) return { added: [] as T[], removed: [] as T[] };
  return {
    added: facts.filter((f) => !f.deletedAt && f.updatedAt > since),
    removed: facts.filter((f) => f.deletedAt && f.deletedAt > since),
  };
}
