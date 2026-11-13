import { expect, it } from "vitest";
import { applyVoice, voiceForPrompt, voiceProfile } from "./voice";

const M = 60_000, H = 60 * M;
let t = Date.UTC(2026, 10, 1);
const say = (sender: string, text: string, gap = M) => ({ sender, text, ts: (t += gap) });

// A lowercase, no-punctuation Hinglish texter who sends bursts.
const casual = [
  say("Me", "kya kr rhi h"), say("Me", "soyi nhi abhi tak"), say("Her", "Nahi yaar. Flight hai 1 baje!"),
  say("Me", "acha"), say("Me", "airport pahuch gyi"), say("Me", "<Media omitted>"), say("Me", "https://example.com/x"),
  say("Her", "Haan pahuch gayi 😭"), say("Me", "sahi h"), say("Me", "flight miss hui to paise nhi dunga 😂"),
  say("Me", "gng sushi kab khila rhi h", 8 * H), say("Her", "Tu khilayega"), say("Me", "nhi"), say("Me", "tu hi khila"),
  ...Array.from({ length: 12 }, (_, i) => say("Me", `thik h ${i} nhi pata`)),
];

it("measures the user's typing from their own messages only", () => {
  const v = voiceProfile(casual, "Me")!;
  expect(v.count).toBe(21); // media and bare link skipped, her messages ignored
  expect(v.lowerStart).toBe(1);
  expect(v.allLower).toBe(1);
  expect(v.endPeriod).toBe(0);
  expect(v.endBang).toBe(0);
  expect(v.questionMark).toBe(0);
  expect(v.greetShare).toBe(0);
  expect(v.topEmoji).toEqual(["😂"]);
  expect(v.words.slice(0, 2)).toEqual(["h", "nhi"]);
  expect(v.words).not.toContain("nahi"); // her spelling, not his
  expect(v.openers).toContain("gng sushi");
  expect(v.burst).toBeGreaterThan(1.8);
  expect(v.samples).toContain("kya kr rhi h");
  expect(v.samples.join("\n")).not.toMatch(/Media omitted|https:|Flight hai/);
  expect(voiceProfile(casual, "Nobody")).toBeNull();
});

it("renders samples and habits as rules", () => {
  const p = voiceForPrompt(voiceProfile(casual, "Me")!);
  expect(p).toContain("<user_voice>");
  expect(p).toContain("do not capitalise the first word");
  expect(p).toContain("leave it off");
  expect(p).toContain('Never opens with "Hey"');
  expect(p).toMatch(/most used first: h, nhi/);
});

it("holds suggestions to near-absolute habits, and only those", () => {
  const v = voiceProfile(casual, "Me")!;
  expect(applyVoice("Hey! Kolkata wapas aake settle ho gayi? Sushi ka plan banayein?", v)).toBe("kolkata wapas aake settle ho gayi? sushi ka plan banayein?");
  expect(applyVoice("Hope travel smooth raha! Batao kab free hai.", v)).toBe("hope travel smooth raha batao kab free hai");
  expect(applyVoice("Sab set?\nSushi pending hai 😂", v)).toBe("sab set?\nsushi pending hai 😂"); // his emoji stays, lines stay separate
  expect(applyVoice("wait...", v)).toBe("wait...");

  const formal = Array.from({ length: 30 }, (_, i) => say(i % 2 ? "Her" : "Me", i % 3 ? "Hey, how was your day?" : "That sounds great! See you soon."));
  const f = voiceProfile(formal, "Me")!;
  const text = "Hey! Are you free on Saturday? It would be great to catch up.";
  expect(applyVoice(text, f)).toBe(text);
  expect(applyVoice(text, null)).toBe(text);
  expect(applyVoice("Hey! Fine.", voiceProfile(casual.slice(0, 5), "Me"))).toBe("Hey! Fine."); // too few messages to make rules
});
