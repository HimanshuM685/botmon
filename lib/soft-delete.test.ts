import { expect, it } from "vitest";
import { addTrashFilter } from "./soft-delete";

it("hides trashed rows by default and respects explicit opt-outs", () => {
  expect(addTrashFilter("Person", "findMany", { where: { userId: "u" } }).where).toEqual({ userId: "u", deletedAt: null });
  expect(addTrashFilter("Analysis", "count", {}).where).toEqual({ deletedAt: null });
  expect(addTrashFilter("Person", "findMany", { where: { userId: "u", deletedAt: undefined } }).where).toEqual({ userId: "u", deletedAt: undefined });
  expect(addTrashFilter("Person", "findMany", { where: { deletedAt: { not: null } } }).where).toEqual({ deletedAt: { not: null } });
  expect(addTrashFilter("Person", "update", { where: { id: "x" } }).where).toEqual({ id: "x" });
  expect(addTrashFilter("ApiKey", "findMany", {}).where).toBeUndefined();
});
