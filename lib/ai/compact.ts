import { COACH_HISTORY } from "./coach";

/**
 * Compaction: a long coach conversation keeps its older part as a running summary, so turn 5's decision is still
 * known at turn 200 without sending 200 messages. Stored messages are never deleted; only what is sent changes.
 * Pure: when to compact, where to cut, what to show the summariser. The model call is the caller's (lib/ai/cheap.ts).
 */

type Row = { id: string; role: string; parts: unknown };

/** Messages kept word for word after a compaction. */
export const KEEP_RECENT = 20;
/** Share of the provider's budget the conversation may take before it is compacted. */
export const HISTORY_SHARE = 0.4;

const size = (r: Row) => JSON.stringify(r.parts).length;

/** `rows`: the messages after the current summary, oldest first. */
export function needsCompaction(rows: Row[], budget: number) {
  return rows.length > KEEP_RECENT && (rows.length > COACH_HISTORY || rows.reduce((n, r) => n + size(r), 0) > budget * HISTORY_SHARE);
}

/** Where to cut: everything but the last KEEP_RECENT messages, moved so the kept part starts with the user speaking. */
export function splitForSummary<T extends Row>(rows: T[]): { older: T[]; recent: T[] } {
  let cut = Math.max(0, rows.length - KEEP_RECENT);
  while (cut < rows.length && rows[cut].role !== "user") cut++;
  if (cut >= rows.length) cut = Math.max(0, rows.length - KEEP_RECENT);
  return { older: rows.slice(0, cut), recent: rows.slice(cut) };
}

type Part = { type?: string; text?: string; state?: string; input?: unknown; output?: unknown };

/** A message as the summariser sees it: what was said, and what the coach saved or corrected (not raw tool output). */
export function renderForSummary(rows: Row[]) {
  return rows
    .map((r) => {
      const parts = (Array.isArray(r.parts) ? r.parts : []) as Part[];
      const text = parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n");
      const saved = parts.flatMap((p) => {
        const out = p.output as { saved?: boolean | string; text?: string; updated?: boolean; retired?: string } | undefined;
        if (p.type === "tool-remember" && out?.saved) return [`[saved to memory: ${out.text}]`];
        if (p.type === "tool-correct" && out?.updated) return [`[corrected memory: ${typeof out.saved === "string" ? out.saved : `removed "${out.retired}"`}]`];
        return [];
      });
      return text || saved.length ? `${r.role === "user" ? "User" : "Coach"}: ${[text, ...saved].filter(Boolean).join(" ").slice(0, 2_000)}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function summaryPrompt(previous: string | null, older: string, personName: string) {
  return `Summarise the earlier part of a conversation between a user and their relationship coach about ${personName}, so the coach can carry on without re-reading it. Keep, as short bullet points under these four headings and leaving a heading out when it has nothing:
- Decisions: what the user decided to do or not do, with the date or turn when known
- What the user wants: their goals, worries and limits
- Open threads: questions still unanswered, things the user said they would report back on
- Coach promised: anything the coach said it would do, check or come back to
Use the user's own wording for decisions. No advice, no new conclusions, nothing that is not in the text. At most 250 words.
${previous ? `\nSummary so far (fold it in; drop nothing that is still true):\n${previous}\n` : ""}
Conversation:
${older}`;
}
