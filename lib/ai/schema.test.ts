import { expect, it } from "vitest";
import { ADVICE_KEYS, analysisSchema, modelPatchSchema } from "./schema";

const moment = analysisSchema.shape.moment;

it("reads a fumbled moment as neutral instead of failing the read", () => {
  expect(moment.parse({})).toEqual({ theirMood: "", tone: "neutral", waitingOn: "nobody", alreadyCovered: [], needs: "" });
  expect(moment.parse({ theirMood: "tired", tone: "sleepy", waitingOn: "her", alreadyCovered: "food", needs: 3 })).toEqual({ theirMood: "tired", tone: "neutral", waitingOn: "nobody", alreadyCovered: [], needs: "" });
  expect(moment.parse({ theirMood: "low (\"meh\")", tone: "low", waitingOn: "them", alreadyCovered: ["favourite food: biryani"], needs: "comfort" }).waitingOn).toBe("them");
});

it("writes the moment before the advice, and rewrites it on every update", () => {
  const keys = Object.keys(analysisSchema.shape);
  expect(keys.indexOf("moment")).toBeLessThan(keys.indexOf("nextMoves"));
  expect(keys.indexOf("moment")).toBeLessThan(keys.indexOf("messageSuggestions"));
  expect(ADVICE_KEYS).toContain("moment");
  const patchKeys = Object.keys(modelPatchSchema.shape);
  expect(patchKeys.indexOf("moment")).toBeLessThan(patchKeys.indexOf("messageSuggestions"));
});
