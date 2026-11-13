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
