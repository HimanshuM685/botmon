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
