// Rider report weighting (spec §6.3) and §6.2 limit predicates, pure.
// Timestamps arrive as plain ms-since-epoch numbers; rain arrives as
// hour-ending samples — the Worker builds both, this module never touches
// I/O, Date.now() or the environment.
//
// Ticket decisions (C-20261023-M5) pinned by reports.test.ts:
// 1. "yes" agrees with the model; "wetter" and "drier" disagree (§5 names
//    the factors, §6.1 names the verdicts; this is the mapping).
// 2. reportsConflict (−15) means riders contradicting each other: both
//    "wetter" and "drier" present among the still-counting reports.
// 3. Rain-reset: a single hour with rain > REPORTS.rainResetMinIn after the
//    report (the same one-hour event definition as §5's since-rain factors).
// 5. Agree/disagree factors apply per report at §6.3 weight: full <= 24 h,
//    half 24–48 h, zero after 48 h or once rain resets the report.

import { REPORTS } from "./config";

export type ReportVerdict = "yes" | "wetter" | "drier";

/** One stored report, as the score job reads it back. */
export interface ActiveReport {
  verdict: ReportVerdict;
  /** When the report was created, ms since epoch. */
  createdMs: number;
}

/** One merged rain hour (hour-ending convention, like rain_hourly). */
export interface RainHourSample {
  /** End of the hour, ms since epoch. */
  endMs: number;
  precipIn: number;
}

/** Aggregated report evidence, shaped for confidence(). */
export interface ReportAggregate {
  /** §6.3-weighted sum of agreeing ("yes") reports. */
  agreeingReports: number;
  /** §6.3-weighted sum of disagreeing ("wetter"/"drier") reports. */
  disagreeingReports: number;
  /** Both "wetter" and "drier" among the still-counting reports. */
  reportsConflict: boolean;
}

/** Decision 1: "yes" agrees with the model, corrections disagree. */
export function reportAgrees(verdict: ReportVerdict): boolean {
  return verdict === "yes";
}

/** §6.3 weight by age: full for 0–24 h, half for 24–48 h, then expired.
 *  A report from the future (clock skew) carries no weight. */
export function reportWeight(createdMs: number, nowMs: number): number {
  const ageHours = (nowMs - createdMs) / 3_600_000;
  if (ageHours < 0) return 0;
  if (ageHours < REPORTS.fullWeightMaxAgeHours) return 1;
  if (ageHours < REPORTS.expiryAgeHours) return REPORTS.halfWeight;
  return 0;
}

/** §6.3 "new rain resets reports": true when any hour ending after the
 *  report carries rain > REPORTS.rainResetMinIn (decision 3: the single-hour
 *  event definition, shared with §5's since-rain factors). */
export function rainResetsReport(
  createdMs: number,
  rain: readonly RainHourSample[],
): boolean {
  return rain.some(
    (hour) => hour.endMs > createdMs && hour.precipIn > REPORTS.rainResetMinIn,
  );
}

/** Fold a trail's reports into confidence() inputs: each report counts at
 *  its §6.3 weight, zero once expired or rain-reset (decision 5). */
export function aggregateReports(
  reports: readonly ActiveReport[],
  rain: readonly RainHourSample[],
  nowMs: number,
): ReportAggregate {
  let agreeing = 0;
  let disagreeing = 0;
  const activeVerdicts = new Set<ReportVerdict>();
  for (const report of reports) {
    const weight = rainResetsReport(report.createdMs, rain)
      ? 0
      : reportWeight(report.createdMs, nowMs);
    if (weight === 0) continue;
    activeVerdicts.add(report.verdict);
    if (reportAgrees(report.verdict)) agreeing += weight;
    else disagreeing += weight;
  }
  return {
    agreeingReports: agreeing,
    disagreeingReports: disagreeing,
    // Decision 2, narrow reading: riders contradicting each other.
    reportsConflict: activeVerdicts.has("wetter") && activeVerdicts.has("drier"),
  };
}

/** §6.2: 1 report per trail per device per day. `priorToday` is the count of
 *  this device's reports for this trail since UTC midnight. */
export function deviceLimitExceeded(priorToday: number): boolean {
  return priorToday >= REPORTS.maxPerTrailPerDevicePerDay;
}

/** §6.2: 20 reports per IP hash per day. `priorToday` is the count of this
 *  ip_hash's reports since UTC midnight. */
export function ipLimitExceeded(priorToday: number): boolean {
  return priorToday >= REPORTS.maxPerIpHashPerDay;
}
