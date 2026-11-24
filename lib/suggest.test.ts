import { expect, it } from "vitest";
import { dropRepeats, isQuestion, overlap, sentSince, stem, whereItStands } from "./suggest";

const M = 60_000, H = 60 * M;
const now = Date.UTC(2026, 10, 24, 12);
const chat = [
  { sender: "Riya", text: "hii", ts: now - 30 * H },
  { sender: "Me", text: "what did you do today?", ts: now - 29.5 * H },
  { sender: "Riya", text: "office and gym, tired", ts: now - 29 * H },
  { sender: "Me", text: "whats ur favourite food", ts: now - 28 * H },
  { sender: "Riya", text: "biryani obviously", ts: now - 27.9 * H },
  { sender: "Me", text: "hey", ts: now - 20 * M },
  { sender: "Me", text: "what did you like?", ts: now - 10 * M },
];

it("spots questions in English and Hinglish", () => {
  expect(isQuestion("what did you like")).toBe(true);
  expect(isQuestion("kya kar rahi ho")).toBe(true);
  expect(isQuestion("do u want to go")).toBe(true);
  expect(isQuestion("done for today?")).toBe(true);
  expect(isQuestion("do it now")).toBe(false);
  expect(isQuestion("good night")).toBe(false);
});

it("says who is waiting and lists asked questions with answers", () => {
  const s = whereItStands(chat, "Me", 0, now);
  expect(s).toContain("the user sent the last 2 messages".replace("the user", "The user"));
  expect(s).toMatch(/"what did you like\?" \(no reply to it yet\)/);
  expect(s).toMatch(/"whats ur favourite food" \(answered\)/);
  expect(s).toMatch(/"what did you do today\?" \(answered\)/);
  expect(s.indexOf("what did you like")).toBeLessThan(s.indexOf("favourite food"));
});

it("drops what was just sent, keeps the rest", () => {
  expect(overlap("what do u like", "what did you like?")).toBe(1);
  expect(dropRepeats(["what do u like", "how was ur day", "hope work wasnt too much"], chat, "Me", 0, now)).toEqual(["how was ur day", "hope work wasnt too much"]);
  // Multi-line: one repeated line is enough.
  expect(dropRepeats(["ok\nwhat do u like", "sleep early tonight"], chat, "Me", 0, now)).toEqual(["sleep early tonight"]);
});

it("lets a daily check-in repeat on a new day, not the same day", () => {
  const yesterday = chat.slice(0, 5);
  expect(dropRepeats(["what did you do today"], [...yesterday, { sender: "Riya", text: "morning", ts: now - 5 * M }], "Me", 0, now)).toEqual(["what did you do today"]);
  const today = [...chat, { sender: "Me", text: "what did u do today", ts: now - 2 * M }];
  expect(dropRepeats(["what did you do today", "miss u"], today, "Me", 0, now)).toEqual(["miss u"]);
});

it("never returns empty", () => {
  expect(dropRepeats(["what do u like", "you like what"], chat, "Me", 0, now)).toHaveLength(1);
});

it("marks last time's suggestions the user has since sent", () => {
  expect(sentSince(["ask what she liked most", "plan a biryani date"], chat, "Me", now - H)).toEqual(["ask what she liked most"]);
  expect(sentSince(["ask what she liked most"], chat, "Me", now)).toEqual([]);
});

it("stems English endings so forms meet, and keeps different words apart", () => {
  expect(new Set(["like", "likes", "liked", "liking"].map(stem))).toEqual(new Set(["lik"]));
  expect(stem("missed")).toBe(stem("miss"));
  expect(stem("goodnight")).not.toBe(stem("good"));
  expect(stem("today")).not.toBe(stem("day"));
  expect(stem("bus")).toBe("bus"); // short words untouched
});

it("never drops a one-word suggestion because a longer message shares its word", () => {
  const day = [
    { sender: "Riya", text: "hi", ts: now - 3 * H },
    { sender: "Me", text: "missed the bus today", ts: now - 2 * H },
    { sender: "Me", text: "good morning", ts: now - H },
  ];
  expect(dropRepeats(["miss u", "goodnight", "kal milte hai?"], day, "Me", 0, now)).toEqual(["miss u", "goodnight", "kal milte hai?"]);
  // The same thing said again still goes, however it's typed.
  expect(dropRepeats(["good morning!!", "gm baby"], day, "Me", 0, now)).toEqual(["gm baby"]);
  expect(dropRepeats(["plan a biryani date this weekend", "sleep early"], [...day, { sender: "Me", text: "biryani date this weekend?", ts: now - 5 * M }], "Me", 0, now)).toEqual(["sleep early"]);
});

it("does not read exclamations as questions", () => {
  for (const t of ["what a day", "how cute 😭", "who cares", "kya baat hai", "how sweet of you", "what"]) expect(isQuestion(t), t).toBe(false);
  for (const t of ["whats up", "why not", "how r u", "what did you eat", "how much was it", "where are you", "kaisa laga", "kya scene hai"]) expect(isQuestion(t), t).toBe(true);
  // "how cute" is not an unanswered question the user is waiting on.
  const s = whereItStands([{ sender: "Riya", text: "pic", ts: now - 2 * M }, { sender: "Me", text: "how cute", ts: now - M }], "Me", 0, now);
  expect(s).not.toContain("Questions the user already asked");
});

it("counts days by the calendar in the chat's time zone", () => {
  const at = (iso: string) => [{ sender: "Riya", text: "gn", ts: Date.parse(iso) }];
  const morning = Date.parse("2026-11-24T04:00:00Z");
  // 23:00 the day before is yesterday, not "today", even though it's under 24h ago.
  expect(whereItStands(at("2026-11-23T23:00:00Z"), "Me", 0, Date.parse("2026-11-24T10:00:00Z"))).toContain("1 day before today");
  // India (UTC+5:30, tzOffset -330): 17:00Z is 22:30 on the 23rd, 04:00Z is 09:30 on the 24th.
  expect(whereItStands(at("2026-11-23T17:00:00Z"), "Me", -330, morning)).toContain("1 day before today");
  // 20:00Z on the 23rd is 01:30 on the 24th in India: today there, yesterday in UTC.
  expect(whereItStands(at("2026-11-23T20:00:00Z"), "Me", -330, Date.parse("2026-11-24T06:00:00Z"))).toContain(", today");
  expect(whereItStands(at("2026-11-23T20:00:00Z"), "Me", 0, Date.parse("2026-11-24T06:00:00Z"))).toContain("1 day before today");
  expect(whereItStands(at("2026-11-20T20:00:00Z"), "Me", 0, Date.parse("2026-11-24T06:00:00Z"))).toContain("4 days before today");
});

it("says who owes the reply, and stays empty when nothing was typed", () => {
  expect(whereItStands([{ sender: "Me", text: "hi", ts: now - H }, { sender: "Riya", text: "heyy", ts: now - M }], "Me", 0, now)).toContain("They sent the last message: the user owes the reply");
  expect(whereItStands([], "Me", 0, now)).toBe("");
  expect(whereItStands([{ sender: "Riya", text: "<Media omitted>", ts: now }, { sender: "Me", text: "image omitted", ts: now }], "Me", 0, now)).toBe("");
  // Media after a typed line doesn't count as the last message.
  expect(whereItStands([{ sender: "Riya", text: "hii", ts: now - H }, { sender: "Me", text: "<Media omitted>", ts: now }], "Me", 0, now)).toContain("from them");
});

it("lists a question once, newest first, and only from the last 60 days", () => {
  const chat2 = [
    { sender: "Me", text: "what do you study?", ts: now - 90 * 24 * H },
    { sender: "Me", text: "whats ur fav movie?", ts: now - 3 * H },
    { sender: "Riya", text: "dil chahta hai", ts: now - 2.9 * H },
    { sender: "Me", text: "whats your favourite movie??", ts: now - H },
  ];
  const s = whereItStands(chat2, "Me", 0, now);
  expect(s.match(/movie/g)).toHaveLength(1);
  // Asked again with no reply, but she answered the first time: the model must know the answer exists.
  expect(s).toContain('"whats your favourite movie??" (no reply this time, answered when asked before)');
  expect(s).not.toContain("study");
});

it("leaves suggestions alone when there's nothing of the user's to compare", () => {
  expect(dropRepeats(["hi"], [], "Me", 0, now)).toEqual(["hi"]);
  expect(dropRepeats([], chat, "Me", 0, now)).toEqual([]);
  expect(dropRepeats(["😂"], chat, "Me", 0, now)).toEqual(["😂"]); // no topic words: never a repeat
});
