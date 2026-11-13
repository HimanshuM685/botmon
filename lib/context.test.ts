import { expect, it } from "vitest";
import { adviceStale, contextHash } from "./context";

const person = { notes: "met twice", relation: "FRIEND", gender: "FEMALE" };
const t = new Date("2026-11-14T00:00:00Z");
const facts = [{ id: "a", updatedAt: t }, { id: "b", updatedAt: t }];

it("fingerprint is stable and changes with notes or timeline", () => {
  const h = contextHash(person, facts);
  expect(contextHash(person, [...facts].reverse())).toBe(h);
  expect(contextHash({ ...person, notes: "we had a fight" }, facts)).not.toBe(h);
  expect(contextHash(person, [...facts, { id: "c", updatedAt: t }])).not.toBe(h); // added
  expect(contextHash(person, facts.slice(1))).not.toBe(h); // trashed
  expect(contextHash(person, [{ id: "a", updatedAt: new Date(t.getTime() + 1) }, facts[1]])).not.toBe(h); // edited
});

it("advice is stale on a new fingerprint or after 3 days", () => {
  const now = t.getTime();
  expect(adviceStale({ contextHash: "x", adviceAt: t }, "x", now)).toBe(false);
  expect(adviceStale({ contextHash: "x", adviceAt: t }, "y", now)).toBe(true);
  expect(adviceStale({ contextHash: null, adviceAt: null }, "x", now)).toBe(true);
  expect(adviceStale({ contextHash: "x", adviceAt: t }, "x", now + 4 * 86_400_000)).toBe(true);
});
