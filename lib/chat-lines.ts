import type { Msg } from "@/lib/parsers/types";
import { toLocal } from "@/lib/stats";

/** Indexes of the messages containing any of the query's words, best first: more words matched, then newer. */
export function rankMessages(msgs: Msg[], query: string) {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  const hits: { i: number; score: number }[] = [];
  msgs.forEach((m, i) => {
    const t = m.text.toLowerCase();
    const score = words.filter((w) => t.includes(w)).length;
    if (score) hits.push({ i, score });
  });
  return hits.sort((a, b) => b.score - a.score || b.i - a.i).map((h) => h.i);
}

export const chatLine = (m: Msg, tz: number) => `[${toLocal(m.ts, tz).toISOString().slice(0, 16).replace("T", " ")}] ${m.sender}: ${m.text}`;
