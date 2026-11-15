import { expect, it } from "vitest";
import { chatHeight } from "@/lib/chat-height";

it("chat card fills what is left of the screen, or the screen under the nav when little is left", () => {
  expect(chatHeight(900, 320)).toBe(540);
  expect(chatHeight(700, 430)).toBe(620); // phone: header and tabs leave under 420px
  expect(chatHeight(300, 430)).toBe(240); // keyboard open on a small phone: never collapses
});
