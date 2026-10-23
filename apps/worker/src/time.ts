// UTC hour-ending axis helpers, same convention as scripts/backtest.ts:
// a stamp "YYYY-MM-DDTHH:00:00Z" names the hour ending at that instant.

export const HOUR_MS = 3_600_000;

// Date#toISOString dominates the score job's CPU when called once per hour
// per point per day offset (~50k times per run), so stamps are memoized by
// their hour. A run touches ~300 distinct hours; the cap only guards a
// long-lived isolate.
const stampCache = new Map<number, string>();
const STAMP_CACHE_MAX = 10_000;

/** Truncate a ms timestamp to its UTC hour-ending stamp. */
export const stamp = (ms: number): string => {
  const hourMs = Math.floor(ms / HOUR_MS) * HOUR_MS;
  let s = stampCache.get(hourMs);
  if (s === undefined) {
    if (stampCache.size >= STAMP_CACHE_MAX) stampCache.clear();
    s = `${new Date(hourMs).toISOString().slice(0, 13)}:00:00Z`;
    stampCache.set(hourMs, s);
  }
  return s;
};

/** UTC calendar day of a ms timestamp, YYYY-MM-DD. */
export const utcDayOf = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);
