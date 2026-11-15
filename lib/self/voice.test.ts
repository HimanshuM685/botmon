import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { voiceProfile } from "../voice";
import { mergeVoices } from "./voice";

const H = 3_600_000;
const chat = (me: string, texts: string[], start: number) => texts.map((text, i) => ({ sender: i % 3 === 2 ? "Her" : me, text, ts: start + i * H }));
const casual = chat("Me", Array.from({ length: 60 }, (_, i) => (i % 2 ? `kya kr rhi h ${i}` : "acha thik h 😂")), Date.UTC(2026, 9, 1));
const formal = chat("Me", Array.from({ length: 30 }, (_, i) => (i % 2 ? `How was your day ${i}?` : "That sounds great! See you soon.")), Date.UTC(2026, 10, 1));

it("a stored voice is exactly what voiceProfile measures: it survives the JSON round trip unchanged", () => {
  const v = voiceProfile(casual, "Me")!;
  expect(JSON.parse(JSON.stringify({ me: v, them: voiceProfile(casual, "Her") })).me).toEqual(v);
});

it("merging: one chat merges to itself; several are weighted by how many messages each was measured from", () => {
  const a = voiceProfile(casual, "Me")!, b = voiceProfile(formal, "Me")!;
  expect(mergeVoices([a])).toBe(a);
  expect(mergeVoices([null, undefined])).toBeNull();
  const m = mergeVoices([b, a])!;
  expect(m.count).toBe(a.count + b.count);
  expect(m.allLower).toBeCloseTo((a.allLower * a.count + b.allLower * b.count) / m.count);
  expect(m.allLower).toBeGreaterThan(0.6); // the bigger, all-lowercase chat leads
  expect(m.topEmoji[0]).toBe("😂");
  expect(m.samples.length).toBeLessThanOrEqual(40);
  expect(m.samples.some((s) => s.startsWith("kya kr"))).toBe(true); // both chats are represented
  expect(m.samples.some((s) => s.startsWith("How was"))).toBe(true);
  expect(new Set(m.samples).size).toBe(m.samples.length);
});

it("no route measures a voice per request any more: they read the one stored at upload", () => {
  for (const r of ["analyze", "model", "coach", "rehearse"]) {
    const src = readFileSync(new URL(`../../app/api/people/[id]/${r}/route.ts`, import.meta.url), "utf8");
    expect(src, r).not.toContain("voiceProfile(");
    expect(src, r).toContain("getVoices(chat, msgs)");
  }
  const upload = readFileSync(new URL("../../app/api/people/[id]/chat/route.ts", import.meta.url), "utf8");
  expect(upload.match(/voiceCipher: sealVoices\(measureVoices\(/g)).toHaveLength(2); // on create and on merge
  expect(upload).toContain("rememberSelfName(userId, myName)");
});
