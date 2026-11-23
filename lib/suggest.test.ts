import { expect, it } from "vitest";
import { dropRepeats, isQuestion, overlap, sentSince, whereItStands } from "./suggest";

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
