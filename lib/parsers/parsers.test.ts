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
