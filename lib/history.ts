import type { Msg } from "./parsers/types";
import type { ChapterResult, EraResult } from "./ai/schema";
import { toLocal } from "./stats";

/**
 * Long chats, read whole. The chat is cut into chapters that each fit one model call; each chapter is read once
 * and what it held is stored (app/api/people/[id]/history). A read then sees every chapter's summary plus the
 * messages after the last chapter word for word, so nothing is forgotten however old.
 */

/** A chapter is this share of the provider's budget: with memory, graph and history it still fits one call. */
export const CHAPTER_SHARE = 0.4;
/** The history block's share of a read or coach prompt. */
export const HISTORY_SHARE = 0.2;
/** A chat this size (share of the budget) or smaller is read directly, with no chapters. */
export const DIRECT_SHARE = 0.45;
/** Chapters condensed into one era when the history doesn't fit even as summaries. */
const ERA_MIN = 2;

export type Range = { fromTs: number; toTs: number; msgCount: number };
export type Unit = Range & { level: number; result: ChapterResult | EraResult };

const lineSize = (m: Msg) => m.text.length + m.sender.length + 22; // "[YYYY-MM-DD HH:MM] " + ": " + newline
const dayOf = (ts: number, tz: number) => toLocal(ts, tz).toISOString().slice(0, 10);

/**
 * Chapters for a chat, oldest first: whole days while they fit `chapterChars`, a day bigger than that split by
 * messages. Only full chapters: the rest after the last one is left for the read itself, and it is always smaller
 * than one chapter. Greedy from the start, so newer messages never move an earlier chapter.
 */
export function planChapters(msgs: Msg[], chapterChars: number, tz = 0): Range[] {
  const out: Range[] = [];
  let start = 0, size = 0;
  const close = (end: number) => {
    out.push({ fromTs: msgs[start].ts, toTs: msgs[end - 1].ts, msgCount: end - start });
    start = end;
    size = 0;
  };
  let i = 0;
  while (i < msgs.length) {
    // One local day.
    let j = i, day = 0;
    const d = dayOf(msgs[i].ts, tz);
    while (j < msgs.length && dayOf(msgs[j].ts, tz) === d) day += lineSize(msgs[j++]);
    if (size + day <= chapterChars) {
      size += day;
      i = j;
      continue;
    }
    if (size) {
      close(i); // the chapter ends before this day
      continue;
    }
    // This day alone is bigger than a chapter: cut it by messages.
    for (let k = i; k < j; k++) {
      if (size + lineSize(msgs[k]) > chapterChars && size) close(k);
      size += lineSize(msgs[k]);
    }
    i = j;
    if (j < msgs.length) close(j); // the day is done; a cut-up day never shares a chapter
  }
  return out;
}

const same = (a: Range, b: Range) => a.fromTs === b.fromTs && a.toTs === b.toTs && a.msgCount === b.msgCount;

/** Messages after the last chapter: what a read sends in full. */
export const afterHistory = (msgs: Msg[], chapters: Range[]) => {
  const last = chapters.at(-1)?.toTs;
  return last == null ? msgs : msgs.filter((m) => m.ts > last);
};

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Full rendering of a unit: summary, mood, the telling moments, conflicts, what was left open. */
function renderFull(u: Unit) {
  const head = `## ${day(u.fromTs)} to ${day(u.toTs)}: ${u.result.phase} (${u.msgCount.toLocaleString("en")} messages)`;
  if (u.level > 0) {
    const e = u.result as EraResult;
    return [head, e.summary, e.turningPoints.length ? `Turning points:\n${e.turningPoints.map((t) => `- ${t}`).join("\n")}` : ""].filter(Boolean).join("\n");
  }
  const c = u.result as ChapterResult;
  return [
    head,
    c.summary,
    c.mood ? `Their mood: ${c.mood}` : "",
    c.moments.length ? `Moments:\n${c.moments.map((m) => `- [${m.when}] "${m.quote}": ${m.reading}`).join("\n")}` : "",
    c.conflicts.length ? `Conflicts:\n${c.conflicts.map((x) => `- ${x.when}: ${x.about} (${x.resolved ? "resolved" : "open"})${x.lesson ? `. ${x.lesson}` : ""}`).join("\n")}` : "",
    c.openAtEnd.length ? `Still open at the end: ${c.openAtEnd.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
const renderShort = (u: Unit) => `## ${day(u.fromTs)} to ${day(u.toTs)}: ${u.result.phase}\n${u.result.summary}`;

/**
 * The history as a prompt block within `maxChars`: newest units in full while they fit, older ones as summaries.
 * Never drops a unit while there is room for its summary; callers plan eras so the summaries fit (planEras).
 */
export function historyForPrompt(units: Unit[], maxChars: number): string {
  if (!units.length) return "";
  const short = units.map(renderShort);
  let used = short.reduce((n, s) => n + s.length + 1, 0);
  const shown = [...short];
  for (let i = units.length - 1; i >= 0; i--) {
    const full = renderFull(units[i]);
    if (used - short[i].length + full.length > maxChars) continue;
    used += full.length - short[i].length;
    shown[i] = full;
  }
  // Still too long (eras not built yet): keep the newest that fit, say what is missing.
  let out = shown;
  while (out.length > 1 && out.join("\n").length > maxChars) out = out.slice(1);
  const dropped = shown.length - out.length;
  return `${dropped ? `(${dropped} earliest periods not shown)\n` : ""}${out.join("\n\n")}`;
}

/** Estimated summary size of a unit before it exists, for planning eras. */
const SHORT_EST = 1_400;

/**
 * Which chapters to condense into eras so the history fits `maxChars` as summaries: consecutive groups from the
 * oldest, the same size, the newest chapters left alone while there is room. [] when everything fits.
 * ponytail: group size grows with the chat, which regroups old eras; each era is one small call, so it's cheap.
 */
export function planEras(chapters: Range[], maxChars: number): Range[][] {
  const room = Math.max(2, Math.floor(maxChars / SHORT_EST));
  if (chapters.length <= room) return [];
  // Keep `keep` newest chapters as they are; group the rest into eras of `g`.
  const g = Math.max(ERA_MIN, Math.ceil(chapters.length / room) + 1);
  const keep = Math.max(1, Math.floor(room / 2));
  const old = chapters.slice(0, chapters.length - keep);
  const groups: Range[][] = [];
  for (let i = 0; i < old.length; i += g) groups.push(old.slice(i, i + g));
  return groups;
}

export const eraRange = (group: Range[]): Range => ({ fromTs: group[0].fromTs, toTs: group.at(-1)!.toTs, msgCount: group.reduce((n, c) => n + c.msgCount, 0) });

/**
 * What a chat's history needs, given what is stored: chapters to read, eras to build, and the units a prompt
 * shows (eras where planned, chapters elsewhere). Stored rows that match nothing planned are stale.
 */
export function historyWork<U extends Unit>(msgs: Msg[], stored: U[], budget: number, tz = 0) {
  const total = msgs.reduce((n, m) => n + lineSize(m), 0);
  const plan = total <= budget * DIRECT_SHARE ? [] : planChapters(msgs, Math.floor(budget * CHAPTER_SHARE), tz);
  const chapters = stored.filter((u) => u.level === 0);
  const eras = stored.filter((u) => u.level > 0);
  const haveChapter = (r: Range) => chapters.find((c) => same(c, r));
  const todo = plan.filter((r) => !haveChapter(r));
  const groups = planEras(plan, Math.floor(budget * HISTORY_SHARE));
  const eraTodo = groups.filter((g) => !eras.find((e) => same(e, eraRange(g))));
  const grouped = new Set(groups.flat().map((r) => r.fromTs));
  const units: U[] = [
    ...groups.flatMap((g) => eras.find((e) => same(e, eraRange(g))) ?? []),
    ...plan.filter((r) => !grouped.has(r.fromTs)).flatMap((r) => haveChapter(r) ?? []),
  ].sort((a, b) => a.fromTs - b.fromTs);
  const stale = stored.filter((u) => (u.level === 0 ? !plan.find((r) => same(r, u)) : !groups.find((g) => same(eraRange(g), u))));
  return { plan, todo, groups, eraTodo, units, stale, ready: !todo.length && !eraTodo.length };
}
