// Pure snapshot assembly: merged rain/temperature axes per point (same
// convention as scripts/backtest.ts computeRow — UTC hour-ending stamps,
// Stage IV precip wins over Open-Meteo for past hours, Open-Meteo fills gaps
// and the future), wetness walks for now / tomorrow / day-after, worst point
// per trail, confidence, and the single-row scores_latest JSON.
//
// The snapshot JSON shape is M4's input contract: per trail a name, one entry
// per day offset (level, optional freeze note, wetness, worst section, and
// the confidence band + factors for the "why" popover), and timestamps.

import {
  aggregateReports,
  confidence,
  pointCondition,
  walkWetness,
  CONFIDENCE,
  OVERRIDES,
  REPORTS,
  WETNESS,
  worstPoint,
  type ActiveReport,
  type Confidence,
  type ConditionLevel,
  type NamedPointCondition,
  type RainHourSample,
} from "@trail-conditions/model";
import { HOUR_MS, stamp } from "./time";
import type { PointRow } from "./chunking";
import type { OmHour } from "./open-meteo";

export interface TrailRow {
  id: string;
  name: string | null;
  county: string | null;
  tau_base_h: number;
  tau_mult: number;
  reports_used: number;
}

export interface ScoredDay {
  /** 0 = now, 1 = tomorrow, 2 = day after (same UTC hour of day). */
  offset: 0 | 1 | 2;
  level: ConditionLevel;
  note?: string;
  wetness: number;
  /** Which section is worst, e.g. "Trailhead" or "Top". */
  worst_point: string;
  confidence: Confidence;
}

/** A map pin for one sample point. Coordinates are rounded to 5 decimals
 *  (~1 m), which is plenty for a pin and keeps the snapshot small. */
export interface TrailPin {
  label: string;
  lat: number;
  lon: number;
}

export interface TrailScore {
  id: string;
  name: string;
  /** Optional: entries scored before this field existed survive mergeSnapshot
   *  without it, so consumers must tolerate its absence. */
  county?: string;
  days: ScoredDay[];
  scored_utc: string;
  /** Sample points, Trailhead first. Optional for the same reason as
   *  county: entries scored before the field existed survive mergeSnapshot
   *  without it until the next run rescores them. */
  points?: TrailPin[];
}

export interface Snapshot {
  updated_utc: string | null;
  trails: Record<string, TrailScore>;
}

export const EMPTY_SNAPSHOT: Snapshot = { updated_utc: null, trails: {} };

/** rain_hourly cache in memory: cell_id -> hour-ending stamp -> inches. */
export type RainByCell = ReadonlyMap<string, ReadonlyMap<string, number>>;
export type OmByPoint = ReadonlyMap<string, ReadonlyMap<string, OmHour>>;

const DAY_OFFSETS = [0, 1, 2] as const;

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Map pins for a trail's points: the Trailhead first, then by point id,
 *  so the first pin is always the one a rider drives to. */
export function trailPins(
  points: readonly Pick<PointRow, "id" | "label" | "lat" | "lon">[],
): TrailPin[] {
  return [...points]
    .sort(
      (a, b) =>
        Number(b.label === "Trailhead") - Number(a.label === "Trailhead") ||
        a.id.localeCompare(b.id),
    )
    .map((p) => ({ label: p.label ?? p.id, lat: round5(p.lat), lon: round5(p.lon) }));
}

interface PointDay {
  condition: NamedPointCondition;
  wetness: number;
}

/** Walk one point to the hour ending at targetMs. Returns null when the
 *  Open-Meteo axis is missing (the trail keeps its previous score). Precip
 *  per hour: Stage IV for the point's cell when present, else Open-Meteo,
 *  else 0 (a missing hour counts as dry rather than dropping the trail). */
function scorePointAt(
  point: PointRow,
  targetMs: number,
  rain: ReadonlyMap<string, number> | undefined,
  om: ReadonlyMap<string, OmHour> | undefined,
  tauTrailHours: number,
): PointDay | null {
  if (!om) return null;

  let snowfall48hIn = 0;
  let lastTempF: number | null = null;
  const hours: { tempF: number; precipIn: number }[] = [];
  for (let i = WETNESS.windowHours - 1; i >= 0; i--) {
    const hourEnd = stamp(targetMs - i * HOUR_MS);
    const omHour = om.get(hourEnd);
    const tempF: number | null = omHour?.tempF ?? lastTempF;
    if (tempF === null) return null; // no temperature yet at the axis start
    lastTempF = tempF;
    const precipIn = rain?.get(hourEnd) ?? omHour?.precipIn ?? 0;
    hours.push({ tempF, precipIn });
    if (i < OVERRIDES.snowfallWindowHours) {
      snowfall48hIn += omHour?.snowfallIn ?? 0;
    }
  }

  const target = om.get(stamp(targetMs));
  if (target?.tempF == null) return null;

  const wetness = walkWetness(hours, tauTrailHours);
  const condition = pointCondition({
    wetness,
    tempF: target.tempF,
    snowfall48hIn,
    snowDepth: target.snowDepthFt ?? 0,
  });
  return {
    condition: { name: point.label ?? point.id, condition },
    wetness,
  };
}

/** |Σ Stage IV − Σ Open-Meteo| precip over the trailing divergence window,
 *  summed over the hours where Stage IV has a value (no Stage IV, no
 *  divergence evidence). */
export function sourceDivergenceIn(
  nowMs: number,
  rain: ReadonlyMap<string, number> | undefined,
  om: ReadonlyMap<string, OmHour> | undefined,
): number {
  if (!rain || !om) return 0;
  let stage4Sum = 0;
  let omSum = 0;
  let sawStage4 = false;
  for (let i = CONFIDENCE.sourceDivergenceWindowHours - 1; i >= 0; i--) {
    const hourEnd = stamp(nowMs - i * HOUR_MS);
    const s4 = rain.get(hourEnd);
    if (s4 === undefined) continue;
    sawStage4 = true;
    stage4Sum += s4;
    omSum += om.get(hourEnd)?.precipIn ?? 0;
  }
  return sawStage4 ? Math.abs(stage4Sum - omSum) : 0;
}

/** Hours since the last hour with merged precip > CONFIDENCE.rainEventMinIn
 *  within the walk window; null when there is no such hour (long-dry). */
export function hoursSinceRain(
  nowMs: number,
  rain: ReadonlyMap<string, number> | undefined,
  om: ReadonlyMap<string, OmHour> | undefined,
): number | null {
  for (let i = 0; i < WETNESS.windowHours; i++) {
    const hourEnd = stamp(nowMs - i * HOUR_MS);
    const precip = rain?.get(hourEnd) ?? om?.get(hourEnd)?.precipIn ?? 0;
    if (precip > CONFIDENCE.rainEventMinIn) return i;
  }
  return null;
}

/** Merged rain hours (Stage IV wins, Open-Meteo fills) over a report's
 *  possible lifetime, as plain samples for the model's rain-reset check. */
function reportRainSamples(
  nowHourMs: number,
  rain: ReadonlyMap<string, number> | undefined,
  om: ReadonlyMap<string, OmHour> | undefined,
): RainHourSample[] {
  const samples: RainHourSample[] = [];
  for (let i = 0; i <= REPORTS.expiryAgeHours; i++) {
    const endMs = nowHourMs - i * HOUR_MS;
    const hourEnd = stamp(endMs);
    const precipIn = rain?.get(hourEnd) ?? om?.get(hourEnd)?.precipIn ?? 0;
    if (precipIn > 0) samples.push({ endMs, precipIn });
  }
  return samples;
}

/** Score one trail for now / tomorrow / day-after. Returns null when the
 *  forecast data for any point is missing, so a failed fetch never
 *  overwrites a good previous score. `reports` are this trail's rows from
 *  the last 48 h; §6.3 weighting (age, rain-reset against the worst point's
 *  cell rain) happens in the model's aggregateReports. */
export function scoreTrail(
  trail: TrailRow,
  points: readonly PointRow[],
  rainByCell: RainByCell,
  omByPoint: OmByPoint,
  nowMs: number,
  reports: readonly ActiveReport[],
): TrailScore | null {
  const nowHourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const tau = trail.tau_base_h * trail.tau_mult;
  const days: ScoredDay[] = [];

  for (const offset of DAY_OFFSETS) {
    const targetMs = nowHourMs + offset * 24 * HOUR_MS;
    const perPoint: (PointDay & { point: PointRow })[] = [];
    for (const point of points) {
      const scored = scorePointAt(
        point,
        targetMs,
        rainByCell.get(point.cell_id),
        omByPoint.get(point.id),
        tau,
      );
      if (!scored) return null;
      perPoint.push({ ...scored, point });
    }

    const worst = worstPoint(perPoint.map((p) => p.condition));
    const worstEntry = perPoint.find((p) => p.condition === worst) ?? perPoint[0]!;
    const reportAgg = aggregateReports(
      reports,
      reportRainSamples(
        nowHourMs,
        rainByCell.get(worstEntry.point.cell_id),
        omByPoint.get(worstEntry.point.id),
      ),
      nowMs,
    );
    const conf = confidence({
      agreeingReports: reportAgg.agreeingReports,
      disagreeingReports: reportAgg.disagreeingReports,
      reportsConflict: reportAgg.reportsConflict,
      sourceDivergenceIn: sourceDivergenceIn(
        nowHourMs,
        rainByCell.get(worstEntry.point.cell_id),
        omByPoint.get(worstEntry.point.id),
      ),
      elevationMeters: worstEntry.point.elev_m ?? 0,
      hoursSinceRain: hoursSinceRain(
        nowHourMs,
        rainByCell.get(worstEntry.point.cell_id),
        omByPoint.get(worstEntry.point.id),
      ),
      tunedReportCount: trail.reports_used,
      forecastDayOffset: offset,
    });

    days.push({
      offset,
      level: worst.condition.level,
      ...(worst.condition.note !== undefined && { note: worst.condition.note }),
      wetness: worstEntry.wetness,
      worst_point: worst.name,
      confidence: conf,
    });
  }

  return {
    id: trail.id,
    name: trail.name ?? trail.id,
    ...(trail.county !== null && { county: trail.county }),
    days,
    scored_utc: new Date(nowMs).toISOString(),
    points: trailPins(points),
  };
}

/** Read-modify-write of the single scores_latest row: replace this chunk's
 *  trails, keep every other trail's last score. */
export function mergeSnapshot(
  existing: Snapshot | null,
  scores: readonly TrailScore[],
  nowMs: number,
): Snapshot {
  const trails = { ...(existing?.trails ?? {}) };
  for (const score of scores) trails[score.id] = score;
  return { updated_utc: new Date(nowMs).toISOString(), trails };
}

export interface HistoryRow {
  trail_id: string;
  ts_utc: string;
  wetness: number;
  level: string;
  confidence: number;
}

/** Hourly "now" rows for score_history, keyed (trail_id, hour-ending now). */
export function historyRows(
  scores: readonly TrailScore[],
  nowMs: number,
): HistoryRow[] {
  const tsUtc = stamp(Math.floor(nowMs / HOUR_MS) * HOUR_MS);
  return scores.map((score) => {
    const now = score.days.find((d) => d.offset === 0)!;
    return {
      trail_id: score.id,
      ts_utc: tsUtc,
      wetness: now.wetness,
      level: now.level,
      confidence: now.confidence.score,
    };
  });
}
