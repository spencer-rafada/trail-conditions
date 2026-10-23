// One cron run of the score job (spec §7.2): one chunk of Stage IV cells.
// Fetch today's Stage IV hours per cell (plus yesterday right after UTC
// midnight), upsert into rain_hourly, one batched Open-Meteo call for the
// chunk's points, score now / tomorrow / day-after through packages/model,
// merge into the single scores_latest row and append hourly score_history
// rows. Every fetch and D1 call goes through a counter so each run logs its
// own subrequest usage against the 50-subrequest limit.

import {
  cellChunks,
  chunkIndexForTime,
  firstPoint,
  pointsByTrail,
  trailIdsForChunk,
  NUM_CHUNKS,
  type PointRow,
} from "./chunking";
import {
  cellNeedsFetch,
  daysToFetch,
  rainRowsFromResponse,
  rainUpsertStatements,
  stage4Url,
  type RainRow,
  type Stage4Response,
} from "./stage4";
import {
  openMeteoUrls,
  parseOpenMeteo,
  OM_MAX_LOCATIONS_PER_CALL,
  type OmHour,
  type OmPoint,
} from "./open-meteo";
import {
  historyRows,
  mergeSnapshot,
  scoreTrail,
  EMPTY_SNAPSHOT,
  type Snapshot,
  type TrailRow,
  type TrailScore,
} from "./snapshot";
import { HOUR_MS, stamp } from "./time";
import { WETNESS } from "@trail-conditions/model";

export interface Env {
  DB: D1Database;
  ADMIN_SECRET: string;
}

export interface SubrequestCounter {
  /** Outbound HTTP fetches. */
  fetches: number;
  /** D1 binding calls (each prepare().run()/all() or batch() is one call). */
  d1Calls: number;
  /** Individual SQL statements, in case D1 counts per statement. */
  d1Statements: number;
}

export interface ScoreJobResult {
  chunk: number;
  cellsFetched: number;
  trailsScored: number;
  trailsSkipped: string[];
  rainRowsUpserted: number;
  subrequests: SubrequestCounter;
}

export async function runScoreJob(
  env: Env,
  nowMs: number,
  chunkOverride?: number,
): Promise<ScoreJobResult> {
  const counter: SubrequestCounter = { fetches: 0, d1Calls: 0, d1Statements: 0 };
  const countBatch = <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    counter.d1Calls += 1;
    counter.d1Statements += statements.length;
    return env.DB.batch<T>(statements);
  };
  const countFetch = (url: string): Promise<Response> => {
    counter.fetches += 1;
    return fetch(url);
  };

  // 1. Load trails + points and the current snapshot (one batch).
  const [trailsRes, pointsRes, snapshotRes] = await countBatch<Record<string, unknown>>([
    env.DB.prepare(
      "SELECT id, name, county, tau_base_h, tau_mult, reports_used FROM trails",
    ),
    env.DB.prepare(
      "SELECT id, trail_id, label, lat, lon, elev_m, cell_id FROM trail_points",
    ),
    env.DB.prepare("SELECT json FROM scores_latest WHERE id = 1"),
  ]);
  const trails = (trailsRes?.results ?? []) as unknown as TrailRow[];
  const points = (pointsRes?.results ?? []) as unknown as PointRow[];
  const snapshotJson = snapshotRes?.results[0]?.json;
  const existingSnapshot: Snapshot = snapshotJson
    ? (JSON.parse(snapshotJson as string) as Snapshot)
    : EMPTY_SNAPSHOT;

  // 2. This run's chunk, its trails, and every cell those trails touch.
  const chunk = chunkOverride ?? chunkIndexForTime(nowMs);
  const byTrail = pointsByTrail(points);
  const chunkCells = cellChunks(points.map((p) => p.cell_id))[chunk] ?? [];
  const trailIds = trailIdsForChunk(chunkCells, byTrail);
  const trailById = new Map(trails.map((t) => [t.id, t]));
  const neededCells = new Set(chunkCells);
  for (const id of trailIds) {
    for (const p of byTrail.get(id) ?? []) neededCells.add(p.cell_id);
  }

  // 3. Cached rain for every needed cell, as far back as the walk looks.
  const sinceTs = stamp(nowMs - WETNESS.windowHours * HOUR_MS);
  const cellList = [...neededCells].sort();
  const rainByCell = new Map<string, Map<string, number>>();
  if (cellList.length > 0) {
    const [cachedRes] = await countBatch<RainRow>([
      env.DB.prepare(
        "SELECT cell_id, ts_utc, precip_in FROM rain_hourly WHERE ts_utc >= ?" +
          ` AND cell_id IN (${cellList.map(() => "?").join(", ")})`,
      ).bind(sinceTs, ...cellList),
    ]);
    for (const row of cachedRes!.results) {
      let cell = rainByCell.get(row.cell_id);
      if (!cell) rainByCell.set(row.cell_id, (cell = new Map()));
      cell.set(row.ts_utc, row.precip_in);
    }
  }
  const latestCachedTs = (cellId: string): string | null => {
    const hours = rainByCell.get(cellId);
    if (!hours || hours.size === 0) return null;
    return [...hours.keys()].sort().at(-1) ?? null;
  };

  // 4. Stage IV: the chunk's own cells fetch their due days; cells that only
  //    carry a chunk trail's second point fetch today only when stale.
  const chunkCellSet = new Set(chunkCells);
  const representative = new Map<string, PointRow>();
  for (const p of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!representative.has(p.cell_id)) representative.set(p.cell_id, p);
  }
  const fetchPlan: { cellId: string; day: string }[] = [];
  const today = daysToFetch(nowMs);
  for (const cellId of cellList) {
    if (chunkCellSet.has(cellId)) {
      for (const day of today) fetchPlan.push({ cellId, day });
    } else if (cellNeedsFetch(latestCachedTs(cellId), nowMs)) {
      fetchPlan.push({ cellId, day: today[today.length - 1]! });
    }
  }

  const rainRows: RainRow[] = [];
  let cellsFetched = 0;
  for (const { cellId, day } of fetchPlan) {
    const rep = representative.get(cellId);
    if (!rep) continue;
    try {
      const res = await countFetch(stage4Url(rep.lat, rep.lon, day));
      if (!res.ok) {
        console.warn(`stage4 ${cellId} ${day}: HTTP ${res.status}, skipping`);
        continue;
      }
      const body = (await res.json()) as Stage4Response;
      rainRows.push(...rainRowsFromResponse(cellId, body));
      cellsFetched += 1;
    } catch (err) {
      console.warn(`stage4 ${cellId} ${day}: ${String(err)}, skipping`);
    }
  }
  if (rainRows.length > 0) {
    await countBatch(
      rainUpsertStatements(rainRows).map((s) =>
        env.DB.prepare(s.sql).bind(...s.params),
      ),
    );
    for (const row of rainRows) {
      let cell = rainByCell.get(row.cell_id);
      if (!cell) rainByCell.set(row.cell_id, (cell = new Map()));
      cell.set(row.ts_utc, row.precip_in);
    }
  }

  // 5. One batched Open-Meteo call for all of the chunk's points (falls back
  //    to more calls only above OM_MAX_LOCATIONS_PER_CALL locations). A
  //    failed call (e.g. 429 quota) aborts scoring but keeps the rain cache.
  const omPoints: OmPoint[] = trailIds.flatMap((id) =>
    (byTrail.get(id) ?? []).map((p) => ({
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      elevM: p.elev_m,
    })),
  );
  const omByPoint = new Map<string, ReadonlyMap<string, OmHour>>();
  const urls = openMeteoUrls(omPoints);
  for (const [i, url] of urls.entries()) {
    const batchPoints = omPoints.slice(
      i * OM_MAX_LOCATIONS_PER_CALL,
      (i + 1) * OM_MAX_LOCATIONS_PER_CALL,
    );
    const res = await countFetch(url);
    if (!res.ok) {
      console.warn(
        `open-meteo HTTP ${res.status} (429 = daily quota); scoring skipped for chunk ${chunk}`,
      );
      return {
        chunk,
        cellsFetched,
        trailsScored: 0,
        trailsSkipped: trailIds,
        rainRowsUpserted: rainRows.length,
        subrequests: counter,
      };
    }
    for (const [id, hours] of parseOpenMeteo(batchPoints, await res.json())) {
      omByPoint.set(id, hours);
    }
  }

  // 6. Score the chunk's trails and write the snapshot + history.
  const scores: TrailScore[] = [];
  const skipped: string[] = [];
  for (const id of trailIds) {
    const trail = trailById.get(id);
    const trailPoints = byTrail.get(id);
    const score =
      trail && trailPoints
        ? scoreTrail(trail, trailPoints, rainByCell, omByPoint, nowMs)
        : null;
    if (score) scores.push(score);
    else skipped.push(id);
  }

  if (scores.length > 0) {
    const snapshot = mergeSnapshot(existingSnapshot, scores, nowMs);
    const history = historyRows(scores, nowMs);
    const HISTORY_ROWS_PER_STATEMENT = 20; // 5 params per row, 100-param limit
    const statements = [
      env.DB.prepare(
        "INSERT INTO scores_latest (id, json, updated_utc) VALUES (1, ?, ?)" +
          " ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_utc = excluded.updated_utc",
      ).bind(JSON.stringify(snapshot), snapshot.updated_utc),
    ];
    for (let i = 0; i < history.length; i += HISTORY_ROWS_PER_STATEMENT) {
      const slice = history.slice(i, i + HISTORY_ROWS_PER_STATEMENT);
      statements.push(
        env.DB.prepare(
          "INSERT INTO score_history (trail_id, ts_utc, wetness, level, confidence) VALUES " +
            slice.map(() => "(?, ?, ?, ?, ?)").join(", ") +
            " ON CONFLICT (trail_id, ts_utc) DO UPDATE SET wetness = excluded.wetness," +
            " level = excluded.level, confidence = excluded.confidence",
        ).bind(
          ...slice.flatMap((h) => [h.trail_id, h.ts_utc, h.wetness, h.level, h.confidence]),
        ),
      );
    }
    await countBatch(statements);
  }

  const result: ScoreJobResult = {
    chunk,
    cellsFetched,
    trailsScored: scores.length,
    trailsSkipped: skipped,
    rainRowsUpserted: rainRows.length,
    subrequests: counter,
  };
  console.log(`score-job ${JSON.stringify({ ...result, of: NUM_CHUNKS })}`);
  return result;
}
