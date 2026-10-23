// IEM Stage IV radar rain per grid cell: which UTC days to fetch, URL
// building, response parsing into rain_hourly upsert rows, and the cache
// rule that keeps any completed day from ever being fetched twice.
//
// Day rule (spec §7.2): each visit to a cell fetches only TODAY (the UTC day
// keeps growing, and the (cell_id, ts_utc) primary key makes refetching it
// idempotent). During the first full chunk cycle after UTC midnight —
// MIDNIGHT_WINDOW_HOURS = NUM_CHUNKS runs — it also fetches YESTERDAY once,
// to capture that day's final hours. Older days are never requested; they
// are served from the rain_hourly cache.

import { HOUR_MS, utcDayOf } from "./time";
import { NUM_CHUNKS } from "./chunking";

export const STAGE4_SOURCE = "stage4";

/** One full chunk cycle: every cell is visited exactly once in this window,
 *  so each cell fetches yesterday exactly once after midnight. */
export const MIDNIGHT_WINDOW_HOURS = NUM_CHUNKS / 6; // 18 runs x 10 min = 3 h

/** UTC days a cell's own chunk run fetches at this time. */
export function daysToFetch(nowMs: number): string[] {
  const days = [utcDayOf(nowMs)];
  if (new Date(nowMs).getUTCHours() < MIDNIGHT_WINDOW_HOURS) {
    days.unshift(utcDayOf(nowMs - 24 * HOUR_MS));
  }
  return days;
}

/** How stale a cached cell may be before a cross-chunk (second-point) read
 *  refetches today instead of using the cache. A cell's own chunk refreshes
 *  it every MIDNIGHT_WINDOW_HOURS, so in steady state this never fires. */
export const CACHE_MAX_AGE_HOURS = 6;

/** True when a cell not in this run's chunk needs a fetch of today: no
 *  cached hour within CACHE_MAX_AGE_HOURS (stage4.py returns every hour of
 *  the day including zero-precip hours, so a fetched cell always has a
 *  recent row). */
export function cellNeedsFetch(
  latestCachedTsUtc: string | null,
  nowMs: number,
): boolean {
  if (latestCachedTsUtc === null) return true;
  const ageHours = (nowMs - Date.parse(latestCachedTsUtc)) / HOUR_MS;
  return ageHours > CACHE_MAX_AGE_HOURS;
}

/** One call = one representative point of the cell, one UTC calendar day
 *  (tz only selects which local day; end_valid stays UTC hour-ending). */
export function stage4Url(lat: number, lon: number, day: string): string {
  return (
    "https://mesonet.agron.iastate.edu/json/stage4.py" +
    `?lat=${lat}&lon=${lon}&valid=${day}&tz=UTC`
  );
}

export interface Stage4Response {
  gridi: number;
  gridj: number;
  data: { end_valid: string; precip_in: number }[];
}

export interface RainRow {
  cell_id: string;
  ts_utc: string;
  precip_in: number;
  source: string;
}

/** Upsert rows for rain_hourly. Zero-precip hours are kept: a Stage IV zero
 *  is truth and must win over the Open-Meteo gap-filler. */
export function rainRowsFromResponse(
  cellId: string,
  res: Stage4Response,
): RainRow[] {
  return res.data
    .filter((r) => typeof r.precip_in === "number" && Number.isFinite(r.precip_in))
    .map((r) => ({
      cell_id: cellId,
      ts_utc: r.end_valid,
      precip_in: r.precip_in,
      source: STAGE4_SOURCE,
    }));
}

/** D1 allows 100 bound parameters per statement; 4 per row. */
export const RAIN_ROWS_PER_STATEMENT = 25;

export interface SqlStatement {
  sql: string;
  params: (string | number)[];
}

/** Multi-row upsert statements for one db.batch() call. */
export function rainUpsertStatements(rows: readonly RainRow[]): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (let i = 0; i < rows.length; i += RAIN_ROWS_PER_STATEMENT) {
    const slice = rows.slice(i, i + RAIN_ROWS_PER_STATEMENT);
    const values = slice.map(() => "(?, ?, ?, ?)").join(", ");
    statements.push({
      sql:
        "INSERT INTO rain_hourly (cell_id, ts_utc, precip_in, source) VALUES " +
        values +
        " ON CONFLICT (cell_id, ts_utc) DO UPDATE SET" +
        " precip_in = excluded.precip_in, source = excluded.source",
      params: slice.flatMap((r) => [r.cell_id, r.ts_utc, r.precip_in, r.source]),
    });
  }
  return statements;
}
