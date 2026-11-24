import type { Msg } from "./parsers/types";
import { toLocal } from "./stats";
import { COMMON, NEW_CONVO_GAP, NOT_TYPED } from "./voice";

/**
 * What to send next, the exact part: where the conversation stands and what the user already asked (for the prompt),
 * and a guard that drops suggestions the user has just sent. The model reads the moment (mood, tone, what's needed)
 * from this; code keeps it from repeating. Pure and client-safe (lib/ai/prompt.ts is imported by the person form).
 */

const DAY = 24 * 3600_000;
const ASKED_DAYS = 60;
const ASKED_MAX = 15;
/** Shared topic words, over the larger side's count, that make a suggestion a repeat of one sent message. */
const SAME = 0.6;

/** English wh-words: a question only with "?" or a question-shaped next word ("what did", "how r"), not "what a day". */
const WH_EN = new Set("what wht wat how when where who whom which".split(" "));
/** Always a question at the start: "whats up", "why not", and the Hinglish ones ("kya kar rahi ho"). */
const WH_ALWAYS = new Set("whats wats why kya kaise kaisa kaisi kab kahan kaha kidhar kyu kyun kyon kaun kon kitna kitni kitne".split(" "));
const WH = new Set([...WH_EN, ...WH_ALWAYS]);
const AUX = new Set("do did does are is was were can could will would have has should shall r".split(" "));
/** After an English wh-word, besides AUX and YOU: still a question ("how much", "what else", "how come"). */
const WH_NEXT = new Set("about abt else much many long often come time kind".split(" "));
/** "kya baat hai", "kya scene hai yaar" can be either; "kya baat" is an exclamation. */
const EXCLAIM_AFTER = new Set("baat".split(" "));
const YOU = new Set("you u ya ur tu tum tume tumhe aap".split(" "));
/** Hinglish fillers, pronouns and advice verbs ("ask her…") that say nothing about the topic (COMMON has the English ones). */
const FILLER = new Set("fav favourite favorite ur hai hain ho tha thi the na ki ka ke ko se mai main mera meri tera teri tu tum tumhe aap bhi toh to kya kaise kab kyu kyun haan ha nhi nahi nai ya yaar re hmm acha accha ok okk does your yours ask tell say send text most more much very really".split(" "));

const typed = (m: Msg) => !!m.text.trim() && !NOT_TYPED.test(m.text.trim());

function words(text: string) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * A word's stem, so "likes", "liked", "liking" and "like" meet ("lik"), and "missed" and "miss", but "goodnight"
 * stays apart from "good" and "today" from "day". English endings only; Hinglish words pass through.
 */
export function stem(w: string) {
  if (w.length < 4) return w;
  const s = w.replace(/(ing|ed|es|e|(?<!s)s)$/, "");
  return s.length >= 3 ? s : w;
}

/** Topic words, stemmed: no common words, fillers or question words. */
export function contentWords(text: string) {
  return new Set(words(text).filter((w) => w.length >= 2 && !COMMON.has(w) && !FILLER.has(w) && !WH.has(w)).map(stem));
}

/**
 * How alike `line` and one sent message are in topic, 0..1: shared topic words over the larger side's count, so a
 * one-word suggestion ("miss u") isn't a repeat of a longer message that merely shares the word ("missed the bus").
 * A line with no topic words matches nothing.
 */
export function overlap(line: string, sent: string) {
  const a = contentWords(line);
  if (!a.size) return 0;
  const b = contentWords(sent);
  return [...a].filter((w) => b.has(w)).length / Math.max(a.size, b.size);
}

export function isQuestion(text: string) {
  const t = text.trim();
  if (/\?\s*\p{Extended_Pictographic}*\s*$/u.test(t)) return true;
  const [first, second] = words(t);
  if (WH_ALWAYS.has(first)) return !EXCLAIM_AFTER.has(second);
  if (WH_EN.has(first)) return !!second && (AUX.has(second) || YOU.has(second) || WH_NEXT.has(second));
  return AUX.has(first) && YOU.has(second);
}

/** Start of the conversation the chat ends in: back from the last message until a 6h gap. */
function conversationStart(msgs: Msg[]) {
  let i = msgs.length - 1;
  while (i > 0 && msgs[i].ts - msgs[i - 1].ts < NEW_CONVO_GAP) i--;
  return msgs[i]?.ts ?? 0;
}

const stamp = (ts: number, tz: number) => toLocal(ts, tz).toISOString().slice(0, 16).replace("T", " ");
const localDay = (ts: number, tz: number) => toLocal(ts, tz).toISOString().slice(0, 10);

/** The user's messages a suggestion must not repeat: the current conversation, and everything sent today. */
function recentlySent(msgs: Msg[], me: string, tz: number, now: number) {
  const today = localDay(now, tz);
  const since = conversationStart(msgs);
  return msgs.filter((m) => m.sender === me && typed(m) && (m.ts >= since || localDay(m.ts, tz) === today)).map((m) => m.text);
}

/** How close a suggestion (each of its lines) comes to something already sent: the worst line's best match. */
const closeness = (s: string, sent: string[]) => Math.max(0, ...s.split("\n").filter(Boolean).map((line) => Math.max(0, ...sent.map((t) => overlap(line, t)))));

/**
 * Drop suggestions the user has just sent (this conversation or today), keeping the order. Never empty: when every
 * one repeats, the least similar stays.
 * ponytail: topic-word overlap in a short window only; older repeats are left to the model with the asked-questions
 * list. Add embeddings if paraphrases slip through.
 */
export function dropRepeats(suggestions: string[], msgs: Msg[], me: string, tz: number, now = Date.now()) {
  const sent = recentlySent(msgs, me, tz, now);
  if (!sent.length || !suggestions.length) return suggestions;
  const scored = suggestions.map((s) => ({ s, c: closeness(s, sent) }));
  const kept = scored.filter((x) => x.c < SAME).map((x) => x.s);
  return kept.length ? kept : [scored.reduce((a, b) => (b.c < a.c ? b : a)).s];
}

/** Which of last time's suggestions the user has since sent (any message of theirs after `since`). */
export function sentSince(suggestions: string[], msgs: Msg[], me: string, since: number) {
  const sent = msgs.filter((m) => m.sender === me && m.ts > since && typed(m)).map((m) => m.text);
  return suggestions.filter((s) => sent.length && closeness(s, sent) >= SAME);
}

/**
 * Where the chat stands, computed: who spoke last, whether the user is waiting on a reply, and the questions the
 * user already asked (answered or not), so advice never asks them again.
 */
export function whereItStands(msgs: Msg[], me: string, tz: number, now = Date.now()) {
  // The tail is enough: questions older than ASKED_DAYS are dropped anyway, and a huge chat stays cheap.
  const said = msgs.slice(-5_000).filter(typed);
  const last = said.at(-1);
  if (!last) return "";
  // Calendar days in the chat's time zone, the same count as the stats line: 23:00 yesterday is "1 day", not "today".
  const days = Math.round((Date.parse(localDay(now, tz)) - Date.parse(localDay(last.ts, tz))) / DAY);
  let run = 0;
  for (let i = said.length - 1; i >= 0 && said[i].sender === me; i--) run++;
  // Newest first; the same question asked again (however worded) is listed once, and counts as answered if any copy was.
  const asked: { m: Msg; answered: boolean; before: boolean }[] = [];
  for (let i = said.length - 1; i >= 0; i--) {
    const m = said[i];
    if (m.ts < last.ts - ASKED_DAYS * DAY) break;
    if (m.sender !== me || !isQuestion(m.text)) continue;
    const reply = said.slice(i + 1, i + 200).find((x) => x.sender !== me);
    const answered = !!reply && reply.ts - m.ts < NEW_CONVO_GAP;
    const same = asked.find((a) => overlap(a.m.text, m.text) >= SAME || a.m.text.trim().toLowerCase() === m.text.trim().toLowerCase());
    if (same) {
      if (answered && !same.answered) same.before = true;
      continue;
    }
    if (asked.length >= ASKED_MAX) continue;
    asked.push({ m, answered, before: false });
  }
  const askedLines = asked.map((a) => `- [${stamp(a.m.ts, tz)}] "${a.m.text.trim().slice(0, 160)}" (${a.answered ? "answered" : a.before ? "no reply this time, answered when asked before" : "no reply to it yet"})`);
  return [
    `Where the chat stands (computed, exact):`,
    `- Last message: ${stamp(last.ts, tz)} from ${last.sender === me ? "the user" : "them"}${days ? `, ${days} day${days > 1 ? "s" : ""} before today` : ", today"}.`,
    run ? `- The user sent the last ${run} message${run > 1 ? "s" : ""} and has no reply yet: the user is waiting on them.` : `- They sent the last message: the user owes the reply.`,
    askedLines.length
      ? `Questions the user already asked, newest first. Never suggest asking any of these again, however it is worded. If answered, build on the answer; if not, don't repeat it:\n${askedLines.join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}
