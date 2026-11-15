import { describe, expect, it } from "vitest";
import { parseWhatsApp } from "./whatsapp";
import { parseInstagram, fixMojibake } from "./instagram";
import { activityWindows, computeStats } from "../stats";
import { fitToBudget } from "../ai/prompt";

describe("whatsapp", () => {
  it("parses android 12h export with multiline + media + system lines", () => {
    const raw = [
      "12/31/23, 9:41 PM - Messages and calls are end-to-end encrypted.",
      "12/31/23, 9:41 PM - Riya: hey you",
      "second line",
      "12/31/23, 9:45 PM - Aman: <Media omitted>",
      "1/1/24, 12:05 AM - Riya: happy new year!",
    ].join("\n");
    const c = parseWhatsApp(raw);
    expect(c.messages).toHaveLength(3);
    expect(c.messages[0]).toMatchObject({ sender: "Riya", text: "hey you\nsecond line" });
    expect(c.messages[1].text).toBe("[media]");
    expect(new Date(c.messages[0].ts).getMonth()).toBe(11); // MM/DD detected from "31"
    expect(new Date(c.messages[2].ts).getHours()).toBe(0);
    expect(c.senders).toEqual(["Riya", "Aman"]);
  });

  it("keeps a continuation line that starts with a date", () => {
    const raw = "25/12/2024, 18:00 - Aman: plans?\n26/12/2024, 7:30 dinner?\nor lunch\n25/12/2024, 18:05 - Riya: dinner";
    const c = parseWhatsApp(raw);
    expect(c.messages.map((m) => m.text)).toEqual(["plans?\n26/12/2024, 7:30 dinner?\nor lunch", "dinner"]);
  });

  it("parses iOS bracket 24h day-first export", () => {
    const raw = "‎[25/03/2024, 18:02:11] Aman: hi\n[25/03/2024, 18:03:00] Riya: ‎image omitted";
    const c = parseWhatsApp(raw);
    expect(c.messages).toHaveLength(2);
    const d = new Date(c.messages[0].ts);
    expect([d.getDate(), d.getMonth(), d.getHours(), d.getSeconds()]).toEqual([25, 2, 18, 11]);
    expect(c.messages[1].text).toBe("[media]");
  });
});

describe("whatsapp copied messages (no year)", () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  const at = (ts: number) => { const d = new Date(ts); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]; };

  it("parses a block copied inside WhatsApp, multi-line included", () => {
    const c = parseWhatsApp("[14/11, 9:41 pm] Riya: hey\nyou there\n[14/11, 9:45 pm] Aman: ok", now);
    expect(c.messages.map((m) => [m.sender, m.text])).toEqual([["Riya", "hey\nyou there"], ["Aman", "ok"]]);
    expect(at(c.messages[0].ts)).toEqual([2026, 11, 14, 21]);
  });

  it("detects month-first, and puts a December message pasted in January in last year", () => {
    expect(at(parseWhatsApp("[11/14, 9:41 PM] Riya: hey", now).messages[0].ts)).toEqual([2026, 11, 14, 21]);
    expect(at(parseWhatsApp("[31/12, 11:50 pm] Riya: hny", new Date(2027, 0, 2).getTime()).messages[0].ts)).toEqual([2026, 12, 31, 23]);
  });

  it("with every day 12 or lower: forward in time first, then the device's date order", () => {
    const short = "[5/11, 9:00 am] Riya: a\n[6/11, 9:00 am] Aman: b";
    expect(at(parseWhatsApp(short, now, false).messages[1].ts)).toEqual([2026, 11, 6, 9]);
    expect(at(parseWhatsApp(short, now, true).messages[1].ts)).toEqual([2026, 6, 11, 9]);
    // A day-first chat from 11 Oct, pasted on 15 Nov, is not re-read as 10 Nov.
    expect(at(parseWhatsApp("11/10/26, 9:00 pm - Riya: a\n11/10/26, 9:05 pm - Aman: b", now, false).messages[0].ts)).toEqual([2026, 10, 11, 21]);
    // 3 Feb then 1 Mar as DD/MM runs forward; as MM/DD (2 Mar, then 3 Jan) it jumps back: DD/MM even on a month-first device.
    expect(at(parseWhatsApp("03/02/2024, 10:00 - A: x\n01/03/2024, 10:00 - B: y", now, true).messages[0].ts)).toEqual([2024, 2, 3, 10]);
  });

  it("a year-less date without brackets inside a message stays text", () => {
    const c = parseWhatsApp("[14/11, 9:41 pm] Riya: when?\n12/5, 10:00 - works for me", now);
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].text).toBe("when?\n12/5, 10:00 - works for me");
  });
});

describe("instagram", () => {
  it("fixes mojibake, sorts ascending, merges files", () => {
    const enc = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));
    const f1 = JSON.stringify({ messages: [{ sender_name: "Riya", timestamp_ms: 2000, content: enc("ok 😊") }] });
    const f2 = JSON.stringify({ messages: [{ sender_name: "Aman", timestamp_ms: 1000, photos: [{}] }] });
    const c = parseInstagram([f1, f2]);
    expect(c.messages.map((m) => m.text)).toEqual(["[media]", "ok 😊"]);
    expect(fixMojibake("plain")).toBe("plain");
  });
});

describe("stats", () => {
  it("counts initiations and replies", () => {
    const h = 3600_000;
    const msgs = [
      { sender: "Riya", text: "hi", ts: 0 },
      { sender: "me", text: "hey!", ts: 10 * 60_000 },
      { sender: "me", text: "morning", ts: 24 * h },
      { sender: "Riya", text: "gm", ts: 24 * h + 30 * 60_000 },
    ];
    const s = computeStats(msgs, "me");
    expect(s.theyInitiatePct).toBe(50);
    expect(s.myMedianReplyMin).toBe(10);
    expect(s.theirMedianReplyMin).toBe(30);
    expect(s.lastSender).toBe("them");
  });

  it("uses the chat's local hours, not the server's", () => {
    // 22:00 IST = 16:30 UTC; IST offset is -330
    const ts = Date.UTC(2024, 0, 1, 16, 30);
    const s = computeStats([{ sender: "Riya", text: "hi", ts }, { sender: "me", text: "yo", ts: ts + 60_000 }], "me", -330);
    expect(s.theirTopHours).toEqual([22]);
    expect(fitToBudget([{ sender: "Riya", text: "hi", ts }], 1000, -330).lines[0]).toContain("2024-01-01 22:00");
  });

  it("measures activity windows from now, not from the last message", () => {
    const day = 86_400_000, now = Date.UTC(2024, 5, 1);
    const msgs = Array.from({ length: 20 }, (_, i) => ({ sender: i % 2 ? "me" : "Riya", text: "x", ts: now - 120 * day + i * 3600_000 }));
    const w = activityWindows(computeStats(msgs, "me"), now);
    expect(w.last30).toBe(0);
    expect(w.daysSinceLast).toBe(119);
  });
});

it("ambiguous day/month: the order that lands in the future loses, whatever the device's order", async () => {
  const { parseWhatsApp } = await import("./whatsapp");
  const now = new Date(2026, 10, 15).getTime(); // 15 Nov 2026
  // 05/11/26 is 5 Nov (past) day-first, 11 May... also past: still the device's call.
  // 10/12/26 is 10 Dec (future) day-first, 12 Oct (past) month-first: month-first wins even on a day-first device.
  const text = Array.from({ length: 3 }, (_, i) => `10/12/26, 9:4${i} pm - Riya: hi ${i}`).join("\n");
  expect(new Date(parseWhatsApp(text, now, false).messages[0].ts).getMonth()).toBe(9);
  const past = Array.from({ length: 3 }, (_, i) => `05/11/26, 9:4${i} pm - Riya: hi ${i}`).join("\n");
  expect(new Date(parseWhatsApp(past, now, false).messages[0].ts).getMonth()).toBe(10);
  expect(new Date(parseWhatsApp(past, now, true).messages[0].ts).getMonth()).toBe(4);
});

it("a key fact without feeling, valence or triples still parses", async () => {
  const { analysisSchema } = await import("../ai/schema");
  const fact = analysisSchema.shape.keyFacts.element;
  const r = fact.safeParse({ fact: "Has a sister", category: "family", when: "", about: ["sister"], triples: [{ from: "them" }] });
  expect(r.success && r.data).toMatchObject({ feeling: "", valence: 0, triples: [] });
});
