// UTC hour-ending axis helpers, same convention as scripts/backtest.ts:
// a stamp "YYYY-MM-DDTHH:00:00Z" names the hour ending at that instant.

export const HOUR_MS = 3_600_000;

/** Truncate a ms timestamp to its UTC hour-ending stamp. */
export const stamp = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 13)}:00:00Z`;

/** UTC calendar day of a ms timestamp, YYYY-MM-DD. */
export const utcDayOf = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);
