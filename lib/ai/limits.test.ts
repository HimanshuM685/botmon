import { expect, it } from "vitest";
import { charsFor, rateLimit } from "./limits";

it("reads an OpenAI request too big for the key's TPM", () => {
  const e = { statusCode: 429, message: "Request too large for gpt-5.5 in organization org-x on tokens per min (TPM): Limit 30000, Requested 52000. The input or output tokens must be reduced." };
  expect(rateLimit(e)).toEqual({ waitMs: 60_000, tooBigFor: 30000 });
  expect(charsFor(30000)).toBe(72000);
});

it("waits as long as the provider says, through a RetryError", () => {
  const groq = { lastError: { statusCode: 429, message: "Rate limit reached for model `llama-3.3-70b-versatile` on tokens per minute (TPM): Limit 12000, Used 9000, Requested 4000. Please try again in 1m2.5s." } };
  expect(rateLimit(groq)).toEqual({ waitMs: 62_500, tooBigFor: undefined });
  const gemini = { statusCode: 429, message: "Resource has been exhausted", responseBody: '{"error":{"details":[{"retryDelay": "37s"}]}}' };
  expect(rateLimit(gemini)?.waitMs).toBe(37_000);
  expect(rateLimit({ statusCode: 429, message: "x", responseHeaders: { "Retry-After": "20" } })?.waitMs).toBe(20_000);
});

it("waits an hour on daily caps, and ignores other errors", () => {
  expect(rateLimit({ statusCode: 429, message: "Rate limit reached on tokens per day (TPD): Limit 100000, Used 99000, Requested 4000." })?.waitMs).toBe(3_600_000);
  expect(rateLimit({ statusCode: 401, message: "Invalid API key" })).toBeNull();
  expect(rateLimit({ statusCode: 413, message: "Request too large on tokens per minute (TPM): Limit 6000, Requested 9000" })?.tooBigFor).toBe(6000);
});
