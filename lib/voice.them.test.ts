import { expect, it } from "vitest";
import { applyVoice, voiceForPrompt, voiceProfile, type Voice } from "./voice";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** voiceForPrompt exactly as it was before it took `who`, kept here to prove existing callers get the same bytes. */
function legacy(v: Voice) {
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


const H = 3_600_000;
const chat = Array.from({ length: 90 }, (_, i) => {
  const mine = i % 3 !== 0;
  return { sender: mine ? "Me" : "Riya", text: mine ? (i % 2 ? `kya kr rhi h ${i}` : "acha thik h 😂") : i % 2 ? "hmm" : i % 4 ? "nahi yaar kal baat karte hain" : "ok", ts: Date.UTC(2026, 10, 1) + i * (i % 7 ? 0.1 : 9) * H };
});
const formal = Array.from({ length: 40 }, (_, i) => ({ sender: i % 2 ? "Riya" : "Me", text: i % 3 ? "Hey, how was your day?" : "That sounds great! See you soon.", ts: Date.UTC(2026, 10, 1) + i * H }));

it("existing callers get byte-identical output: no argument and 'user' both equal the old function", () => {
  for (const [msgs, who] of [[chat, "Me"], [chat, "Riya"], [formal, "Me"], [formal, "Riya"], [chat.slice(0, 7), "Me"]] as const) {
    const v = voiceProfile(msgs, who)!;
    expect(voiceForPrompt(v)).toBe(legacy(v));
    expect(voiceForPrompt(v, "user")).toBe(legacy(v));
  }
});

it("her voice: measured from her messages, worded for writing as her, and enforced on a reply", () => {
  const her = voiceProfile(chat, "Riya")!;
  expect(her.count).toBe(30);
  expect(her.allLower).toBe(1);
  const p = voiceForPrompt(her, "them");
  expect(p).toContain("How they type, measured from 30 of their own messages");
  expect(p).toContain("<their_voice>\n");
  expect(p).toContain("nahi yaar kal baat karte hain");
  expect(p).not.toContain("kya kr rhi h"); // my lines are not her voice
  expect(p).not.toMatch(/the user|suggestion/);
  expect(p).toContain("Every reply you write as them must look like they typed it");
  // The same hard rules that hold my drafts hold her simulated replies: lowercase, no full stop, no greeting, no "!".
  expect(applyVoice("Hey! That sounds great. Let's talk tomorrow.", her)).toBe("that sounds great. let's talk tomorrow");
});
