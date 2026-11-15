import { expect, it } from "vitest";
import { afterFailure, backoffMs, BUSY_TRIES, charsFor, OUTPUT_TRIES, rateLimit, retryable } from "./limits";

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

it("retries an overloaded model, through a RetryError", () => {
  const e = { name: "AI_RetryError", message: "Failed after 2 attempts. Last error: AI_APICallError: This model is currently experiencing high demand.", lastError: { name: "AI_APICallError", statusCode: 503, message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." } };
  expect(retryable(e)).toEqual({ waitMs: 0, kind: "busy" });
  expect(retryable(new TypeError("fetch failed"))?.kind).toBe("busy");
  expect(retryable(new DOMException("The operation was aborted due to timeout", "TimeoutError"))?.kind).toBe("busy");
  expect(retryable({ name: "AI_NoObjectGeneratedError", message: "No object generated: could not parse the response." })?.kind).toBe("output");
  expect(retryable({ statusCode: 401, message: "Invalid API key" })).toBeNull();
  expect(retryable({ statusCode: 404, message: "model not found" })).toBeNull();
  expect(retryable({ statusCode: 429, message: "Rate limit reached" })?.kind).toBe("rate");
  expect(retryable(new Error("This chat is too long for the context window"))).toBeNull();
});

it("backs off, then gives up", () => {
  expect([0, 1, 2, 3, 4, 5, 9].map((t) => backoffMs(t) / 1000)).toEqual([30, 60, 120, 240, 480, 900, 900]);
  expect(backoffMs(0, 90_000)).toBe(90_000);
  expect(afterFailure({ kind: "busy", waitMs: 0 }, 0)).toEqual({ waitMs: 30_000, tries: 1 });
  expect(afterFailure({ kind: "busy", waitMs: 0 }, BUSY_TRIES)).toHaveProperty("fail");
  expect(afterFailure({ kind: "output", waitMs: 5_000 }, OUTPUT_TRIES - 1)).toHaveProperty("fail");
  expect(afterFailure({ kind: "rate", waitMs: 3_600_000 }, 50)).toEqual({ waitMs: 3_600_000, tries: 50 });
  // Total wait before giving up on a busy model: about 6 hours.
  const total = Array.from({ length: BUSY_TRIES }, (_, t) => backoffMs(t)).reduce((a, b) => a + b, 0);
  expect(total / 3_600_000).toBeGreaterThan(5.5);
  expect(total / 3_600_000).toBeLessThan(7);
});
