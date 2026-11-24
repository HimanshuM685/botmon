/**
 * What a provider's rate-limit answer says: how long to wait, and whether one call was simply too big for the key's
 * tokens-per-minute limit (then waiting never helps; the call has to get smaller). Null when it isn't a rate limit.
 */
export type Limit = { waitMs: number; tooBigFor?: number };

type ErrLike = { statusCode?: number; message?: string; responseHeaders?: Record<string, string>; responseBody?: string; lastError?: unknown };

const MINUTE = 60_000, HOUR = 3_600_000;

/** "1m2.5s", "6.2s", "350ms", "37s" → ms. */
function duration(s: string): number | undefined {
  let ms = 0, any = false;
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    any = true;
    ms += Number(n) * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? MINUTE : HOUR);
  }
  return any ? Math.ceil(ms) : undefined;
}

/** The AI SDK wraps the last attempt in a RetryError. */
export const unwrap = (e: unknown) => ((e as ErrLike)?.lastError ?? e) as ErrLike & { name?: string; isRetryable?: boolean; cause?: { name?: string } };
export const textOf = (err: ErrLike, e: unknown) => `${err?.message ?? e} ${err?.responseBody ?? ""}`;

/** How long the provider's headers say to wait, in ms, if they say. */
function headerWait(err: ErrLike, now = Date.now()): number | undefined {
  const h = Object.fromEntries(Object.entries(err?.responseHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const ms = Number(h["retry-after-ms"]);
  if (ms > 0) return ms;
  const s = Number(h["retry-after"]);
  if (s > 0) return s * 1000;
  // OpenRouter: when the limit resets, as epoch ms (or seconds).
  const reset = Number(h["x-ratelimit-reset"]);
  if (reset > 1e9) {
    const wait = (reset > 1e12 ? reset : reset * 1000) - now;
    if (wait > 0 && wait < 2 * 24 * HOUR) return wait;
  }
  return undefined;
}

/** A key with no money or quota at all: a 429 that waiting never lifts. */
// Not "check your plan and billing details": Gemini says that on every ordinary per-minute limit too. OpenAI's real
// no-quota error carries the insufficient_quota code in its body.
export const NO_QUOTA = /insufficient_quota|out of credits|insufficient credits|credit balance/i;

export function rateLimit(e: unknown): Limit | null {
  const err = unwrap(e);
  const text = textOf(err, e);
  const status = err?.statusCode;
  const perMinute = /tokens per min(?:ute)?|\bTPM\b/i.test(text);
  if (NO_QUOTA.test(text)) return null;
  if (!(status === 429 || (status === 413 && perMinute) || /quota|rate.?limit|resource.?exhausted/i.test(text))) return null;

  // "Limit 30000, Used 25000, Requested 8000": only too big when the request alone is over the limit.
  const m = perMinute ? text.match(/Limit:?\s*(\d+)[^.]*?Requested:?\s*(\d+)/i) : null;
  const tooBigFor = m && Number(m[2]) > Number(m[1]) ? Number(m[1]) : undefined;

  // Daily caps (tokens or requests per day) don't lift in a minute.
  // OpenRouter says "free-models-per-day".
  const daily = /per.?day|daily|\bTPD\b|\bRPD\b/i.test(text);
  // Gemini's retryDelay on a daily cap is seconds, though the cap lifts hours later: waited at least an hour.
  const retryDelay = duration(text.match(/"retryDelay":\s*"([\d.]+s)"/)?.[1] ?? "");
  const hinted =
    headerWait(err) ||
    duration(text.match(/try again in\s*([\d.hms]+)/i)?.[1] ?? "") ||
    (retryDelay && daily ? Math.max(retryDelay, HOUR) : retryDelay);
  const waitMs = hinted && Number.isFinite(hinted) ? Math.max(1000, hinted) : daily ? HOUR : MINUTE;
  return { waitMs, tooBigFor };
}

/** Chars per call that fit `tokens` per minute, with room for the answer and the token estimate being off. */
export const charsFor = (tokens: number) => Math.floor(tokens * 4 * 0.6);

/**
 * Any failure worth trying again, and what kind:
 * - rate: the key's rate limit or quota (waits as long as the provider says; can take a day on free tiers).
 * - busy: the provider is overloaded, down for a moment, or the network dropped (5xx, timeouts, "high demand").
 * - output: the model answered, but not in the shape asked for (broken or incomplete JSON); weak models do this.
 * Null: a real error that waiting won't fix (bad key, unknown model, chat too long).
 */
export type Failure = Limit & { kind: "rate" | "busy" | "slow" | "output" };

const OUTPUT_ERRORS = /^AI_(NoObjectGenerated|NoOutputGenerated|NoContentGenerated|JSONParse|TypeValidation|EmptyResponseBody|InvalidResponseData)Error$/;
const BUSY = /overloaded|high demand|unavailable|temporar|capacity|try again|timed? ?out|fetch failed|network|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|terminated|bad gateway|gateway/i;

export function retryable(e: unknown): Failure | null {
  const err = unwrap(e);
  const status = err?.statusCode;
  const rate = rateLimit(e);
  if (rate) return { ...rate, kind: "rate" };
  // Our own time limit on the call ran out: the call is too big or the model too slow for one step.
  if (err?.name === "TimeoutError") return { waitMs: 0, kind: "slow" };
  // Any other 4xx is a real answer about the request (bad key, unknown model, no credits, too long): waiting won't fix it,
  // whatever its text says ("unavailable", "try again with another model").
  if (status && status >= 400 && status < 500 && status !== 408) return null;
  if (OUTPUT_ERRORS.test(err?.name ?? "") || OUTPUT_ERRORS.test(err?.cause?.name ?? "")) return { waitMs: 5_000, kind: "output" };
  if ((status && (status >= 500 || status === 408)) || err?.isRetryable || BUSY.test(textOf(err, e))) return { waitMs: headerWait(err) ?? 0, kind: "busy" };
  return null;
}

/**
 * A step that saved some work while other calls failed: wait before the rest, at least 5s and what a rate limit asks,
 * without spending tries (progress was made). Shown as a rate limit only when it was one.
 */
export function afterPartial(failure: unknown): { waitMs: number; wait: "rate" | "busy" } {
  const f = retryable(failure);
  return { waitMs: Math.max(5_000, f?.waitMs ?? 0), wait: f?.kind === "rate" ? "rate" : "busy" };
}

/** Growing waits for an overloaded model: 30s, 1m, 2m, 4m, 8m, then every 15m. At least what the provider asked. */
export const backoffMs = (tries: number, hintMs = 0) => Math.max(hintMs, Math.min(30_000 * 2 ** tries, 15 * MINUTE));

/** About 6 hours of growing waits (backoffMs) before an overloaded model counts as unusable. */
export const BUSY_TRIES = 28;
/** A model that answers broken JSON this many times in a row won't get better by itself. */
export const OUTPUT_TRIES = 4;
/**
 * Rate limits in a row, with no step getting through, before the limit counts as one that won't lift (a quota
 * without the words that say so). Waits follow the provider: an hour each for daily caps, so this is about two days.
 */
export const RATE_TRIES = 48;

/** Failures in a row, counted apart: an overloaded model, unreadable answers and rate limits each have their own limit. */
export type Tries = { busy: number; bad: number; rate?: number };
export type Wait = "rate" | "busy" | "slow" | "output";

/** What to do after a failed step: wait (and why) and try again, or stop. */
export function afterFailure(f: Failure, tries: Tries): { waitMs: number; tries: Tries; reason: Wait } | { fail: string } {
  // Counted on their own: a long wait for a daily cap must not use up the overload tries or stretch their backoff.
  if (f.kind === "rate")
    return (tries.rate ?? 0) + 1 > RATE_TRIES
      ? { fail: "Your AI provider's rate limit or quota hasn't lifted for days. Check your plan or switch provider in Settings. Everything read so far is kept." }
      : { waitMs: f.waitMs, tries: { ...tries, rate: (tries.rate ?? 0) + 1 }, reason: "rate" };
  if (f.kind === "output")
    return tries.bad + 1 >= OUTPUT_TRIES
      ? { fail: "Your model keeps returning answers that can't be read. Pick a stronger model in Settings and try again. Everything read so far is kept." }
      : { waitMs: f.waitMs, tries: { ...tries, bad: tries.bad + 1 }, reason: "output" };
  return tries.busy + 1 > BUSY_TRIES
    ? { fail: f.kind === "slow"
        ? "Your model is too slow to read this chat in time. Pick a faster model in Settings and try again. Everything read so far is kept."
        : "Your model has been overloaded for hours. Pick another model in Settings and try again. Everything read so far is kept." }
    : { waitMs: f.kind === "slow" ? 5_000 : backoffMs(tries.busy, f.waitMs), tries: { ...tries, busy: tries.busy + 1 }, reason: f.kind === "slow" ? "slow" : "busy" };
}
