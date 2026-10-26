// Is the confidence marker honest? For each rider report in the retention
// window: the trail's confidence at that hour (score_history) and whether
// the rider said the call was right ("yes"). Grouped by band, a trustworthy
// marker shows High matching riders more often than Medium, and Medium more
// than Low. GET /api/admin/calibration; `pnpm prod:calibration` prints it.

import {
  CONFIDENCE,
  RETENTION,
  type ConfidenceBand,
  type ReportVerdict,
} from "@trail-conditions/model";
import type { Env } from "./score-job";
import { HOUR_MS } from "./time";

export interface CalibrationRow {
  /** Confidence (0–100) at the report's hour; null when no score was kept. */
  confidence: number | null;
  verdict: ReportVerdict;
}

export interface BandCalibration {
  reports: number;
  /** Reports whose verdict was "yes" (the call was right). */
  matched: number;
  /** matched / reports; null with no reports (unknown, not 0%). */
  matchRate: number | null;
}

export interface Calibration {
  bands: Record<ConfidenceBand, BandCalibration>;
  /** Reports with no score_history row at or before them. */
  unscored: number;
}

const bandOf = (score: number): ConfidenceBand =>
  score >= CONFIDENCE.bands.high ? "high" : score >= CONFIDENCE.bands.medium ? "medium" : "low";

export function calibrateByBand(rows: readonly CalibrationRow[]): Calibration {
  const tally: Record<ConfidenceBand, { reports: number; matched: number }> = {
    high: { reports: 0, matched: 0 },
    medium: { reports: 0, matched: 0 },
    low: { reports: 0, matched: 0 },
  };
  let unscored = 0;
  for (const row of rows) {
    if (row.confidence === null) {
      unscored++;
      continue;
    }
    const t = tally[bandOf(row.confidence)];
    t.reports++;
    if (row.verdict === "yes") t.matched++;
  }
  const finish = ({ reports, matched }: { reports: number; matched: number }) => ({
    reports,
    matched,
    matchRate: reports > 0 ? matched / reports : null,
  });
  return {
    bands: { high: finish(tally.high), medium: finish(tally.medium), low: finish(tally.low) },
    unscored,
  };
}

/** Every report in the window with the trail's last "now" score at or
 *  before it (score_history.ts_utc is an hour stamp; both sort as text). */
export async function getCalibration(env: Env, nowMs: number): Promise<Response> {
  const since = new Date(nowMs - RETENTION.reportsDays * 24 * HOUR_MS).toISOString();
  const rows = (
    await env.DB.prepare(
      "SELECT r.verdict AS verdict, (SELECT h.confidence FROM score_history h" +
        " WHERE h.trail_id = r.trail_id AND h.ts_utc <= r.created_utc" +
        " ORDER BY h.ts_utc DESC LIMIT 1) AS confidence" +
        " FROM reports r WHERE r.created_utc >= ?",
    )
      .bind(since)
      .all<CalibrationRow>()
  ).results;
  return Response.json({ window_days: RETENTION.reportsDays, ...calibrateByBand(rows) });
}
