// Confidence marker, spec §5. Pure: rider reports and rain history arrive
// already aggregated as plain inputs. The factor list is returned with the
// score so the UI can show why ("2 riders confirmed today").

import { CONFIDENCE } from "./config";

export type ConfidenceBand = "high" | "medium" | "low";

export interface ConfidenceFactor {
  /** Stable id, keys into CONFIDENCE for the tunable behind it. */
  id:
    | "riders_agree"
    | "rider_disagrees"
    | "reports_conflict"
    | "sources_diverge"
    | "high_elevation"
    | "recent_rain"
    | "long_dry"
    | "trail_tuned"
    | "forecast_day";
  delta: number;
}

export interface ConfidenceInput {
  /** Rider reports since the last rain, within the last 24 h, that agree
   *  with the model. */
  agreeingReports: number;
  /** Rider reports that disagree with the model. */
  disagreeingReports: number;
  /** Reports disagree with each other. */
  reportsConflict: boolean;
  /** |Stage IV − Open-Meteo| precipitation total over the last 72 h, inches. */
  sourceDivergenceIn: number;
  /** Sample point elevation, meters. */
  elevationMeters: number;
  /** Hours since the last hour with rain > CONFIDENCE.rainEventMinIn;
   *  null when there is no such rain in the record (counts as long-dry). */
  hoursSinceRain: number | null;
  /** Reports used in tau_mult so far (§6.4). */
  tunedReportCount: number;
  /** 0 = today, 1 = tomorrow, 2 = day after. */
  forecastDayOffset: number;
}

export interface Confidence {
  /** 0–100. */
  score: number;
  band: ConfidenceBand;
  factors: ConfidenceFactor[];
}

export function confidence(input: ConfidenceInput): Confidence {
  const c = CONFIDENCE;
  const factors: ConfidenceFactor[] = [];

  if (input.agreeingReports > 0) {
    factors.push({
      id: "riders_agree",
      delta: Math.min(input.agreeingReports * c.agreePerReport, c.agreeMaxBonus),
    });
  }
  if (input.disagreeingReports > 0) {
    factors.push({
      id: "rider_disagrees",
      delta: input.disagreeingReports * c.disagreePenalty,
    });
  }
  if (input.reportsConflict) {
    factors.push({ id: "reports_conflict", delta: c.reportsConflictPenalty });
  }
  if (input.sourceDivergenceIn > c.sourceDivergenceMinIn) {
    factors.push({ id: "sources_diverge", delta: c.sourceDivergencePenalty });
  }
  if (input.elevationMeters > c.highElevationMinMeters) {
    factors.push({ id: "high_elevation", delta: c.highElevationPenalty });
  }
  if (input.hoursSinceRain !== null && input.hoursSinceRain < c.recentRainMaxHours) {
    factors.push({ id: "recent_rain", delta: c.recentRainPenalty });
  }
  if (input.hoursSinceRain === null || input.hoursSinceRain > c.longDryMinHours) {
    factors.push({ id: "long_dry", delta: c.longDryBonus });
  }
  if (input.tunedReportCount >= c.tunedMinReports) {
    factors.push({ id: "trail_tuned", delta: c.tunedBonus });
  }
  if (input.forecastDayOffset > 0) {
    factors.push({
      id: "forecast_day",
      delta: input.forecastDayOffset * c.forecastDayPenalty,
    });
  }

  const raw = c.start + factors.reduce((sum, f) => sum + f.delta, 0);
  const score = Math.min(100, Math.max(0, raw));
  const band: ConfidenceBand =
    score >= c.bands.high ? "high" : score >= c.bands.medium ? "medium" : "low";

  return { score, band, factors };
}
