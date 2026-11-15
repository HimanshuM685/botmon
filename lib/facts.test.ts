import { expect, it } from "vitest";
import { entitiesIn, factsForPrompt, factsFromAnalysis, factsWithinBudget as within, newFacts, toEntities } from "./facts";

it("turns keyFacts and importantDates into typed facts", () => {
  const facts = factsFromAnalysis({
    keyFacts: [
      { fact: "Has a younger brother, Kabir", category: "family", when: "" },
      { fact: "Loves filter coffee", category: "preference", when: "" },
      { fact: "Moved to Pune", category: "event", when: "2026-06-01" },
      { fact: "Exam season", category: "study", when: "March" },
    ],
    importantDates: [{ date: "2026-12-04", what: "Birthday" }, { date: "12-04", what: "Mom's birthday" }],
  });
  expect(facts.map((f) => f.kind)).toEqual(["FACT", "PREFERENCE", "EVENT", "FACT", "DATE", "DATE"]);
  expect(facts[2].happenedAt?.toISOString().slice(0, 10)).toBe("2026-06-01");
  expect(facts[3].text).toBe("Exam season (March)");
  expect(facts[5]).toMatchObject({ text: "Mom's birthday (12-04)", happenedAt: null });
});

it("de-dupes against stored facts and within the batch, ignoring case and punctuation", () => {
  const c = factsFromAnalysis({ keyFacts: [{ fact: "Loves filter coffee!", category: "preference", when: "" }, { fact: "loves  filter coffee", category: "preference", when: "" }, { fact: "Plays badminton", category: "other", when: "" }] });
  expect(newFacts(["loves filter coffee"], c).map((f) => f.text)).toEqual(["Plays badminton"]);
});

it("factsWithinBudget keeps the latest facts that fit", async () => {
  const { factsWithinBudget } = await import("./facts");
  const facts = Array.from({ length: 100 }, (_, i) => ({ kind: "FACT", text: `fact number ${i} padded to some length`, happenedAt: null }));
  const { facts: kept, chars } = factsWithinBudget(facts, 600);
  expect(chars).toBeLessThanOrEqual(600);
  expect(kept.at(-1)!.text).toContain("fact number 99");
  expect(kept.length).toBeLessThan(100);
});

it("normalises entity tags so related memories connect", () => {
  expect(toEntities(["Sister Riya!", "sister  riya", " ", "Job", "a", undefined])).toEqual(["sister riya", "job"]);
  const [f] = factsFromAnalysis({ keyFacts: [{ fact: "Her sister Riya is getting married", category: "family", when: "", about: ["Sister Riya", "wedding"] }] });
  expect(f.entities).toEqual(["sister riya", "wedding"]);
  expect(factsForPrompt([f])).toBe("- [fact] Her sister Riya is getting married {about: sister riya, wedding}");
  expect(entitiesIn("what should I get for Riya's wedding?", ["wedding", "sister riya", "job"])).toEqual(["wedding"]);
});

it("over budget, keeps memories connected to the focus before newer unrelated ones", () => {
  const facts = Array.from({ length: 50 }, (_, i) => ({ kind: "FACT", text: `fact number ${i} padded to some length`, happenedAt: null, entities: i === 2 || i === 5 ? ["wedding"] : ["misc"] }));
  const { facts: kept, chars } = within(facts, 400, ["wedding"]);
  expect(chars).toBeLessThanOrEqual(400);
  expect(kept.slice(0, 2).map((f) => f.text)).toEqual([facts[2].text, facts[5].text]); // old but connected, original order kept
  expect(kept.at(-1)!.text).toContain("fact number 49");
  expect(within(facts, 1e6, ["wedding"]).facts).toHaveLength(50);
});

it("toDate accepts a date with a time and rejects vague dates", async () => {
  const { toDate } = await import("./facts");
  expect(toDate("2026-11-10T00:00")?.toISOString().slice(0, 10)).toBe("2026-11-10");
  expect(toDate("2026-11-10")?.toISOString().slice(0, 10)).toBe("2026-11-10");
  expect(toDate("March")).toBeNull();
  expect(toDate("")).toBeNull();
});

it("feelings: cleaned, valence only kept next to one, carried from a read", async () => {
  const { toFeeling, toValence } = await import("./facts");
  expect(toFeeling("  Really  Hurt ")).toBe("really hurt");
  expect(toFeeling("")).toBeNull();
  expect(toValence(-7, "hurt")).toBe(-2);
  expect(toValence("1", "glad")).toBe(1);
  expect(toValence(undefined, "glad")).toBe(0);
  expect(toValence(2, null)).toBeNull();
  const [a, b, d] = factsFromAnalysis({
    keyFacts: [{ fact: "Lost her job", category: "work", when: "", about: ["job"], feeling: "Crushed", valence: -2 }, { fact: "Has a cat", category: "other", when: "", valence: 1 }],
    importantDates: [{ date: "2026-12-04", what: "Birthday", about: ["Birthday"] }],
  });
  expect(a).toMatchObject({ feeling: "crushed", valence: -2 });
  expect(b).toMatchObject({ feeling: null, valence: null });
  expect(d.entities).toEqual(["birthday"]);
  expect(factsForPrompt([a])).toBe("- [fact] Lost her job {about: job; felt: crushed -2}");
});

it("emotionMap sums feelings per topic and lists dated ones in order", async () => {
  const { emotionMap } = await import("./facts");
  const f = (text: string, entities: string[], feeling: string | null, valence: number | null, date?: string) => ({ kind: "EVENT", text, entities, feeling, valence, happenedAt: date ? new Date(date) : null });
  const map = emotionMap([
    f("Got promoted", ["job"], "proud", 2, "2026-11-09"),
    f("Boss shouted at her", ["job"], "stressed", -2, "2026-10-01"),
    f("Worked all weekend", ["job"], "stressed", -1),
    f("Dinner with sister", ["sister riya"], "happy", 1), // one felt memory: not a pattern yet
    f("Likes tea", ["tea"], null, null),
  ]);
  expect(map).toContain("- job: leans bad (stressed x2, proud)");
  expect(map).not.toContain("sister riya");
  expect(map.indexOf("2026-10-01 stressed -2: Boss shouted")).toBeLessThan(map.indexOf("2026-11-09 proud +2: Got promoted"));
  expect(emotionMap([f("Likes tea", ["tea"], null, null)])).toBe("");
});

it("over budget, memories one tag away from the focus beat unrelated ones", () => {
  const facts = [
    { kind: "FACT", text: "old: riya lives in pune padded padded", happenedAt: null, entities: ["sister riya"] },
    { kind: "FACT", text: "riya is getting married padded padded", happenedAt: null, entities: ["sister riya", "wedding"] },
    ...Array.from({ length: 20 }, (_, i) => ({ kind: "FACT", text: `unrelated fact number ${i} padded pad`, happenedAt: null, entities: ["misc"] })),
  ];
  expect(within(facts, 180, ["wedding"]).facts.map((f) => f.text)).toEqual([facts[0].text, facts[1].text]);
});
