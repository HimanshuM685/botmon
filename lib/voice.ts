import type { Msg } from "./parsers/types";

/** Not typing: media placeholders, deleted-message stubs, bare links. */
const NOT_TYPED =
  /^(\[media\]|<media omitted>|<attached: .*>|(image|video|audio|sticker|gif|document) omitted|.*\(file attached\)|this message was deleted\.?|you deleted this message\.?|null|https?:\/\/\S+)$/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_ALL = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;
const GREETING = /^(he+y+|hi+|hello+|hell+o+)\b[!,.\s]*/i;
const NEW_CONVO_GAP = 6 * 3600_000;
/** Ordinary words that say nothing about how someone spells. */
const COMMON = new Set("the a an to is are was i you and of in it for on me my so but ok okay yes no not do did be at this that with have has we he she they what when where how why can will just if or as up out".split(" "));

export type Voice = {
  /** How many of the user's own typed messages this was measured from. */
  count: number;
  medianWords: number;
  /** Shares are 0..1 of the user's messages. */
  shortShare: number;
  lowerStart: number;
  allLower: number;
  endPeriod: number;
  endBang: number;
  questionMark: number;
  ellipsis: number;
  emojiShare: number;
  greetShare: number;
  topEmoji: string[];
  /** Their most used words outside common ones: where personal spellings show ("nhi", "kr", "gng"). */
  words: string[];
  stretches: boolean;
  /** Average messages sent in a row before the other person replies. */
  burst: number;
  /** How their conversation-starting messages begin. */
  openers: string[];
  samples: string[];
};

const share = (n: number, total: number) => (total ? n / total : 0);
const top = (counts: Map<string, number>, n: number, min = 1) =>
  [...counts.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** How the user types, measured from their own messages. Null when there is nothing of theirs to measure. */
export function voiceProfile(msgs: Msg[], me: string): Voice | null {
  const mine: { text: string; opener: boolean }[] = [];
  let runs = 0, inRun = false;
  msgs.forEach((m, i) => {
    if (m.sender !== me) return void (inRun = false);
    if (!inRun) runs++;
    inRun = true;
    const text = m.text.trim();
    if (!text || NOT_TYPED.test(text)) return;
    mine.push({ text, opener: i === 0 || m.ts - msgs[i - 1].ts >= NEW_CONVO_GAP });
  });
  const n = mine.length;
  if (!n) return null;

  const wordCounts = mine.map((m) => m.text.split(/\s+/).length).sort((a, b) => a - b);
  const cased = mine.filter((m) => /^\p{L}/u.test(m.text) && m.text[0].toLowerCase() !== m.text[0].toUpperCase());
  const lettered = mine.filter((m) => /[a-z]/i.test(m.text));
  const emoji = new Map<string, number>(), words = new Map<string, number>(), openers = new Map<string, number>();
  for (const m of mine) {
    for (const e of m.text.match(new RegExp(EMOJI.source, "gu")) ?? []) bump(emoji, e);
    for (const w of m.text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w && w.length <= 12 && !COMMON.has(w)) bump(words, w);
    if (m.opener) bump(openers, m.text.toLowerCase().split(/\s+/).slice(0, 2).join(" "));
  }
  const myTotal = msgs.reduce((c, m) => c + Number(m.sender === me), 0);

  return {
    count: n,
    medianWords: wordCounts[Math.floor(n / 2)],
    shortShare: share(wordCounts.filter((w) => w <= 3).length, n),
    lowerStart: share(cased.filter((m) => m.text[0] === m.text[0].toLowerCase()).length, cased.length),
    allLower: share(lettered.filter((m) => m.text === m.text.toLowerCase()).length, lettered.length),
    endPeriod: share(mine.filter((m) => /[^.]\.$/.test(m.text)).length, n),
    endBang: share(mine.filter((m) => /!$/.test(m.text)).length, n),
    questionMark: share(mine.filter((m) => m.text.includes("?")).length, n),
    ellipsis: share(mine.filter((m) => /\.{2,}|…/.test(m.text)).length, n),
    emojiShare: share(mine.filter((m) => EMOJI.test(m.text)).length, n),
    greetShare: share(mine.filter((m) => GREETING.test(m.text)).length, n),
    topEmoji: top(emoji, 6),
    words: top(words, 30, n >= 60 ? 3 : 2),
    stretches: share(mine.filter((m) => /(\p{L})\1{2,}/u.test(m.text)).length, n) >= 0.03,
    burst: runs ? myTotal / runs : 1,
    openers: top(openers, 5),
    samples: pickSamples(mine),
  };
}

/** About 40 real messages with variety: the most recent, conversation openers, questions and a few long ones. */
function pickSamples(mine: { text: string; opener: boolean }[]) {
  const ok = mine.map((m, i) => ({ ...m, i })).filter((m) => m.text.length >= 2);
  const picked = new Map<number, string>();
  const take = (list: typeof ok, max: number) => {
    let taken = 0;
    for (const m of list) {
      if (taken >= max || picked.size >= 40) break;
      if (picked.has(m.i) || [...picked.values()].includes(m.text)) continue;
      picked.set(m.i, m.text.length > 200 ? m.text.slice(0, 200) : m.text);
      taken++;
    }
  };
  const newest = [...ok].reverse();
  take(newest, 20);
  take(newest.filter((m) => m.opener), 8);
  take(newest.filter((m) => m.text.includes("?")), 6);
  take([...ok].sort((a, b) => b.text.length - a.text.length), 6);
  return [...picked.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The voice as a prompt block: real samples first (the strongest signal), then the measured habits as rules. */
export function voiceForPrompt(v: Voice) {
  const habits = [
    `Length: usually about ${v.medianWords} word${v.medianWords === 1 ? "" : "s"} a message; ${pct(v.shortShare)} are 1-3 words. Stay near that.`,
    v.lowerStart >= 0.7 ? `Starts with a lowercase letter in ${pct(v.lowerStart)} of messages: do not capitalise the first word.` : v.lowerStart <= 0.3 ? `Starts with a capital in ${pct(1 - v.lowerStart)} of messages: do the same.` : `Mixes capital and lowercase starts (${pct(v.lowerStart)} lowercase).`,
    v.allLower >= 0.7 ? `Writes all in lowercase in ${pct(v.allLower)} of messages: no capitals anywhere, including names and "i".` : "",
    v.endPeriod < 0.05 ? "Almost never ends a message with a full stop: leave it off." : `Ends with a full stop in ${pct(v.endPeriod)} of messages.`,
    v.endBang < 0.05 ? "Almost never uses an exclamation mark: do not add one." : `Uses "!" at the end in ${pct(v.endBang)} of messages.`,
    v.questionMark < 0.03 ? 'Asks questions without a "?": leave it off.' : `Uses "?" in ${pct(v.questionMark)} of messages.`,
    v.ellipsis >= 0.05 ? `Uses ".." or "..." in ${pct(v.ellipsis)} of messages.` : "",
    v.emojiShare < 0.02 ? "Does not use emoji: none at all." : `Emoji in ${pct(v.emojiShare)} of messages${v.topEmoji.length ? `, mostly ${v.topEmoji.join(" ")}` : ""}. Use only these, about that often.`,
    v.greetShare === 0 ? 'Never opens with "Hey", "Hi" or "Hello": do not start a message that way.' : "",
    v.openers.length ? `Starts conversations like: ${v.openers.map((o) => `"${o}"`).join(", ")}.` : "",
    v.words.length ? `Their own words and spellings, most used first: ${v.words.join(", ")}. When one of these fits, use it spelled exactly like this, never a tidier spelling.` : "",
    v.stretches ? "Sometimes stretches letters (heyyy, okkk)." : "Does not stretch letters.",
    v.burst >= 1.8 ? `Often sends ${Math.round(v.burst)} short messages in a row instead of one long one: a suggestion may be 2-3 short lines (one message per line).` : "Usually sends one message at a time.",
  ].filter(Boolean);
  return `How the user types, measured from ${v.count} of their own messages. Real messages they sent:
<user_voice>
${v.samples.join("\n")}
</user_voice>
Their habits:
${habits.map((h) => `- ${h}`).join("\n")}
Every message you write for the user to send must look like they typed it on their own keyboard: copy the typing in the samples (casing, punctuation, spelling, emoji, length, language mix), not their content. If a message could have been written by anyone, or reads like an assistant wrote it, rewrite it.`;
}

/** Enough of the user's messages for a habit to count as a rule. */
const MIN_FOR_RULES = 20;

/**
 * Hold a suggested message to the user's hardest habits. Only acts where the habit is near-absolute,
 * so it never invents style. Lines are separate messages.
 * ponytail: four fixed rules and thresholds; spelling and word choice are left to the prompt.
 */
export function applyVoice(text: string, v: Voice | null): string {
  if (!v || v.count < MIN_FOR_RULES) return text;
  return text
    .split("\n")
    .map((raw) => {
      let line = raw.trim();
      if (v.emojiShare < 0.02) line = line.replace(EMOJI_ALL, "").replace(/\s{2,}/g, " ").trim();
      if (v.greetShare === 0) line = line.replace(GREETING, "") || line;
      if (v.endBang < 0.05) line = line.replace(/!+$/, "").replace(/!+(?=\s)/g, "");
      if (v.endPeriod < 0.05) line = line.replace(/([^.])\.$/, "$1");
      if (v.allLower > 0.9) line = line.toLowerCase();
      else if (v.lowerStart > 0.9) line = line.charAt(0).toLowerCase() + line.slice(1);
      return line.trim();
    })
    .filter(Boolean)
    .join("\n");
}
