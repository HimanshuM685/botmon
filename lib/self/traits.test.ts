import { expect, it } from "vitest";
import { meEdgeItem, rescope, stripNames, toldItem, traitKey, verifyItems, visible, type Ev } from "./traits";

const H = 3_600_000;
const msgs = [
  ["Me", "played football again today, my knees are done"],
  ["Riya", "i go to the gym every morning at 6"],
  ["Me", "sorry, i overreacted earlier. you were right"],
  ["Riya", "it's fine"],
  ["Me", "Riya you should come see my band play on friday"],
].map(([sender, text], i) => ({ sender, text, ts: Date.UTC(2026, 10, 1) + i * H }));

it("only the user's own lines prove a trait: hers never get in, whatever the model says", () => {
  const out = verifyItems(
    [
      { kind: "HOBBY", text: "Plays football", quote: "played football again today" },
      { kind: "HABIT", text: "Goes to the gym every morning", quote: "i go to the gym every morning at 6" }, // her line
      { kind: "PATTERN", text: "Apologises quickly after a fight", quote: "Sorry, I overreacted earlier.  You were right" }, // reflowed
      { kind: "HOBBY", text: "Plays in a band", quote: "made up line that is nowhere" },
      { kind: "NONSENSE", text: "x", quote: "played football again today" },
      { kind: "HOBBY", text: "plays football!", quote: "played football again today" }, // same trait again
    ],
    msgs, "Me", ["Riya"],
  );
  expect(out.map((v) => [v.kind, v.text])).toEqual([["HOBBY", "Plays football"], ["PATTERN", "Apologises quickly after a fight"]]);
  expect(out[0]).toMatchObject({ line: "played football again today, my knees are done", ts: msgs[0].ts, key: "plays football" });
  expect(verifyItems([{ kind: "HOBBY", text: "Plays football", quote: "played football again today" }], [], "Me", [])).toEqual([]); // nothing to check against
});

it("names never reach a trait", () => {
  expect(stripNames("Invites Riya Sharma to his band's gigs", ["Riya Sharma"])).toBe("Invites them to his band's gigs");
  expect(stripNames("Calls riya every night; Riya's favourite", ["Riya"])).toBe("Calls them every night; them's favourite");
  expect(stripNames("Loves Mariya's cooking", ["Riya"])).toBe("Loves Mariya's cooking"); // whole words only
  const v = verifyItems([{ kind: "HOBBY", text: "Plays in a band, invites Riya", quote: "you should come see my band play" }, { kind: "FACT", text: "Riya", quote: "you should come see my band play" }], msgs, "Me", ["Riya"]);
  expect(v.map((x) => x.text)).toEqual(["Plays in a band, invites them"]);
  expect(toldItem("HOBBY", "Riya", ["Riya"])).toBeNull();
  expect(toldItem("VALUE", "Family comes first", [])).toMatchObject({ kind: "VALUE", key: "family comes first", line: null });
  expect(traitKey("Plays Football!!")).toBe("plays football");
});

const now = Date.UTC(2026, 10, 15);
const ev = (personId: string, relation: string, daysAgo = 1, hidden = false): Ev => ({ personId, relation, at: new Date(now - daysAgo * 86_400_000), hidden });
const base = { source: "ANALYSIS", scope: "RELATION" as const, edited: false, pinned: false, confidence: 0.5, noEvidence: false };

it("scope: two people make a trait global; one keeps it to that kind of relationship, never a name", () => {
  expect(rescope(base, [ev("p1", "CRUSH"), ev("p1", "CRUSH", 3)], now)).toMatchObject({ action: "update", data: { scope: "RELATION", relation: "CRUSH", support: 2, people: 1 } });
  const g = rescope(base, [ev("p1", "CRUSH"), ev("p2", "FRIEND")], now);
  expect(g).toMatchObject({ data: { scope: "GLOBAL", relation: null, people: 2 } });
  const one = rescope(base, [ev("p1", "CRUSH")], now);
  expect((g as { data: { confidence: number } }).data.confidence).toBeGreaterThan((one as { data: { confidence: number } }).data.confidence);
  // Not seen for over 90 days: counts for less.
  const old = rescope(base, [ev("p1", "CRUSH", 120)], now) as { data: { confidence: number } };
  expect(old.data.confidence).toBeLessThan((one as { data: { confidence: number } }).data.confidence);
});

it("trash hides, restore brings back, purge removes: a relation trait goes, a global one stays flagged", () => {
  const trashed = rescope(base, [ev("p1", "CRUSH", 1, true)], now);
  expect(trashed).toMatchObject({ action: "update", data: { support: 0, people: 0, confidence: 0 } });
  expect(visible({ ...base, ...(trashed as { data: { support: number } }).data })).toBe(false); // hidden, not deleted
  expect(rescope(base, [ev("p1", "CRUSH")], now)).toMatchObject({ data: { support: 1 } }); // restored
  expect(rescope(base, [], now)).toEqual({ action: "delete" }); // purged, relation trait
  const kept = rescope({ ...base, scope: "GLOBAL", confidence: 0.8 }, [], now);
  expect(kept).toMatchObject({ action: "update", data: { scope: "GLOBAL", noEvidence: true, confidence: 0.3 } });
  expect(visible({ ...base, ...(kept as { data: { support: number; noEvidence: boolean } }).data })).toBe(true);
  for (const own of [{ source: "USER" }, { edited: true }, { pinned: true }]) expect(rescope({ ...base, ...own }, [], now).action).toBe("update"); // the user's own word stays
});

it("the user's own graph edges become traits; a person is never one", () => {
  expect(meEdgeItem("LIKES", "Cheese")).toMatchObject({ kind: "INTEREST", text: "Likes Cheese", key: "likes cheese" });
  expect(meEdgeItem("FEARS", "dogs")).toMatchObject({ kind: "FACT", text: "Is afraid of dogs" });
  expect(meEdgeItem("KNOWS", "Meera")).toBeNull();
  expect(meEdgeItem("LIKES", " ")).toBeNull();
});
