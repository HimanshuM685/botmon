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

export function rateLimit(e: unknown): Limit | null {
  // The AI SDK wraps the last attempt in a RetryError.
  const err = ((e as ErrLike)?.lastError ?? e) as ErrLike;
  const text = `${err?.message ?? e} ${err?.responseBody ?? ""}`;
  const status = err?.statusCode;
  const perMinute = /tokens per min(?:ute)?|\bTPM\b/i.test(text);
  if (!(status === 429 || (status === 413 && perMinute) || /quota|rate.?limit|resource.?exhausted/i.test(text))) return null;

  // "Limit 30000, Used 25000, Requested 8000": only too big when the request alone is over the limit.
  const m = perMinute ? text.match(/Limit:?\s*(\d+)[^.]*?Requested:?\s*(\d+)/i) : null;
  const tooBigFor = m && Number(m[2]) > Number(m[1]) ? Number(m[1]) : undefined;

  const h = Object.fromEntries(Object.entries(err?.responseHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const hinted =
    (h["retry-after-ms"] && Number(h["retry-after-ms"])) ||
    (h["retry-after"] && Number(h["retry-after"]) * 1000) ||
    duration(text.match(/try again in\s*([\d.hms]+)/i)?.[1] ?? "") ||
    duration(text.match(/"retryDelay":\s*"([\d.]+s)"/)?.[1] ?? "");
  // Daily caps (tokens or requests per day) don't lift in a minute.
  const daily = /per day|\bTPD\b|\bRPD\b|PerDay/i.test(text);
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
export type Failure = Limit & { kind: "rate" | "busy" | "output" };

const OUTPUT_ERRORS = /^AI_(NoObjectGenerated|NoOutputGenerated|NoContentGenerated|JSONParse|TypeValidation|EmptyResponseBody|InvalidResponseData)Error$/;
const BUSY = /overloaded|high demand|unavailable|temporar|capacity|try again|timed? ?out|fetch failed|network|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|terminated|bad gateway|gateway/i;

export function retryable(e: unknown): Failure | null {
  const err = ((e as ErrLike)?.lastError ?? e) as ErrLike & { name?: string; isRetryable?: boolean; cause?: { name?: string } };
  const status = err?.statusCode;
  if (status === 401 || status === 403 || status === 404) return null;
  const rate = rateLimit(e);
  if (rate) return { ...rate, kind: "rate" };
  if (OUTPUT_ERRORS.test(err?.name ?? "") || OUTPUT_ERRORS.test(err?.cause?.name ?? "")) return { waitMs: 5_000, kind: "output" };
  if ((status && (status >= 500 || status === 408)) || err?.isRetryable || BUSY.test(`${err?.message ?? e} ${err?.responseBody ?? ""}`)) {
    const h = Object.fromEntries(Object.entries(err?.responseHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const hinted = Number(h["retry-after"]) * 1000;
    return { waitMs: Number.isFinite(hinted) && hinted > 0 ? hinted : 0, kind: "busy" };
  }
  return null;
}

/** Growing waits for an overloaded model: 30s, 1m, 2m, 4m, 8m, then every 15m. At least what the provider asked. */
export const backoffMs = (tries: number, hintMs = 0) => Math.max(hintMs, Math.min(30_000 * 2 ** tries, 15 * MINUTE));

/** About 6 hours of growing waits (backoffMs) before an overloaded model counts as unusable. */
export const BUSY_TRIES = 28;
/** A model that answers broken JSON this many times in a row won't get better by itself. */
export const OUTPUT_TRIES = 4;

/** What to do after a failed step that had already failed `tries` times in a row: wait and try again, or stop. */
export function afterFailure(f: Failure, tries: number): { waitMs: number; tries: number } | { fail: string } {
  if (f.kind === "rate") return { waitMs: f.waitMs, tries }; // not counted: a daily cap legitimately takes long
  if (f.kind === "output")
    return tries + 1 >= OUTPUT_TRIES
      ? { fail: "Your model keeps returning answers that can't be read. Pick a stronger model in Settings and try again. Everything read so far is kept." }
      : { waitMs: f.waitMs, tries: tries + 1 };
  return tries + 1 > BUSY_TRIES
    ? { fail: "Your model has been overloaded for hours. Pick another model in Settings and try again. Everything read so far is kept." }
    : { waitMs: backoffMs(tries, f.waitMs), tries: tries + 1 };
}
