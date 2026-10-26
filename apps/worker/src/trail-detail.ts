// GET /api/trails/:id — trail details with the "why" factors (spec §9).
// The response shape is defined here (M4):
//
// {
//   "id": "...", "name": "...", "county": string | null,
//   "drying_hours": number | null,            // tau_base_h * tau_mult
//   "soil": "sandy" | "clay" | "loam" | null, // null = no SDA soil data
//   "days": ScoredDay[],                      // [] until the trail is scored
//   "scored_utc": string | null,
//   "last_rain": { "ts_utc": "...", "precip_in": n } | null,
//     // most recent cached rain_hourly hour > CONFIDENCE.rainEventMinIn
//     // across the trail's cells; null = no recent rain in the cache
//   "reports_since_rain": number,             // 0 until M5 ships reports
//   "points": { "label", "lat", "lon" }[]     // map pins, Trailhead first
// }

import { CONFIDENCE, REPORTS, TAU, WETNESS } from "@trail-conditions/model";
import type { Env } from "./score-job";
import { trailPins, type ScoredDay, type Snapshot, type TrailPin } from "./snapshot";
import { HOUR_MS, stamp } from "./time";

export type SoilLabel = "sandy" | "clay" | "loam";

export interface SoilRow {
  sand: number | null;
  clay: number | null;
}

export interface RainEventRow {
  ts_utc: string;
  precip_in: number;
}

export interface TrailDetail {
  id: string;
  name: string;
  county: string | null;
  drying_hours: number | null;
  soil: SoilLabel | null;
  days: ScoredDay[];
  scored_utc: string | null;
  last_rain: RainEventRow | null;
  reports_since_rain: number;
  points: TrailPin[];
}

/** Display label from the first point that has soil data, classified with
 *  TAU's own thresholds (never redefined here). Null = SDA had no data. */
export function soilLabel(rows: readonly SoilRow[]): SoilLabel | null {
  const row = rows.find((r) => r.sand !== null || r.clay !== null);
  if (!row) return null;
  if (row.sand !== null && row.sand >= TAU.sandPctMin) return "sandy";
  if (row.clay !== null && row.clay >= TAU.clayPctMin) return "clay";
  return "loam";
}

/** Most recent hour strictly above CONFIDENCE.rainEventMinIn (spec §6.3's
 *  "> 0.1 in"; decision 5a) across the trail's cells; the heavier cell wins a
 *  same-hour tie. Null = no recent rain in the cache (the normal dry-spell
 *  state, not an error). */
export function lastRainEvent(rows: readonly RainEventRow[]): RainEventRow | null {
  let last: RainEventRow | null = null;
  for (const row of rows) {
    if (row.precip_in <= CONFIDENCE.rainEventMinIn) continue;
    if (
      !last ||
      row.ts_utc > last.ts_utc ||
      (row.ts_utc === last.ts_utc && row.precip_in > last.precip_in)
    ) {
      last = row;
    }
  }
  return last;
}

interface PointDetailRow extends SoilRow {
  id: string;
  label: string | null;
  lat: number;
  lon: number;
  cell_id: string;
}

interface TrailDetailRow {
  id: string;
  name: string | null;
  county: string | null;
  tau_base_h: number | null;
  tau_mult: number | null;
}

/** Same 5-minute cache as /api/scores. */
const DETAIL_CACHE_CONTROL = "public, max-age=300";

export async function getTrailDetail(
  env: Env,
  id: string,
  nowMs: number,
): Promise<Response> {
  const trail = await env.DB.prepare(
    "SELECT id, name, county, tau_base_h, tau_mult FROM trails WHERE id = ?",
  )
    .bind(id)
    .first<TrailDetailRow>();
  if (!trail) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const points = (
    await env.DB.prepare(
      "SELECT id, label, lat, lon, sand, clay, cell_id FROM trail_points WHERE trail_id = ? ORDER BY id",
    )
      .bind(id)
      .all<PointDetailRow>()
  ).results;

  const snapshotRow = await env.DB.prepare(
    "SELECT json FROM scores_latest WHERE id = 1",
  ).first<{ json: string }>();
  const snapshot: Snapshot | null = snapshotRow
    ? (JSON.parse(snapshotRow.json) as Snapshot)
    : null;
  const score = snapshot?.trails[id] ?? null;

  // Rain as far back as the wetness walk looks — older rain no longer moves
  // the score, so "no recent rain" is the honest answer beyond that.
  const cells = [...new Set(points.map((p) => p.cell_id))].sort();
  let rainRows: RainEventRow[] = [];
  if (cells.length > 0) {
    const sinceTs = stamp(nowMs - WETNESS.windowHours * HOUR_MS);
    rainRows = (
      await env.DB.prepare(
        "SELECT ts_utc, precip_in FROM rain_hourly WHERE ts_utc >= ?" +
          ` AND cell_id IN (${cells.map(() => "?").join(", ")})`,
      )
        .bind(sinceTs, ...cells)
        .all<RainEventRow>()
    ).results;
  }
  const lastRain = lastRainEvent(rainRows);

  // "Since the last rain", and only reports that still count (§6.3: expired
  // after REPORTS.expiryAgeHours). Reports are kept longer for tuning, so the
  // age limit has to be explicit here.
  const stillCounts = new Date(nowMs - REPORTS.expiryAgeHours * HOUR_MS).toISOString();
  const countRow = lastRain
    ? await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM reports WHERE trail_id = ? AND created_utc >= ? AND created_utc >= ?",
      )
        .bind(id, lastRain.ts_utc, stillCounts)
        .first<{ n: number }>()
    : await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM reports WHERE trail_id = ? AND created_utc >= ?",
      )
        .bind(id, stillCounts)
        .first<{ n: number }>();

  const detail: TrailDetail = {
    id: trail.id,
    name: trail.name ?? trail.id,
    county: trail.county,
    drying_hours:
      trail.tau_base_h === null ? null : trail.tau_base_h * (trail.tau_mult ?? 1),
    soil: soilLabel(points),
    days: score?.days ?? [],
    scored_utc: score?.scored_utc ?? null,
    last_rain: lastRain,
    reports_since_rain: countRow?.n ?? 0,
    points: trailPins(points),
  };
  return Response.json(detail, {
    headers: { "Cache-Control": DETAIL_CACHE_CONTROL },
  });
}
