// §6.4 nightly tau-tuning rule, pure. Ticket C-20261023-M6 decisions, pinned
// by tuning.test.ts:
// 1. "Many": among all of the trail's reports in the last TUNING.windowDays
//    days (n — 'yes' verdicts count toward n; floor n >= TUNING.minReports),
//    raise tau_mult ×TUNING.raiseStep when wetter verdicts are a strict
//    majority of n, lower ×TUNING.lowerStep when drier verdicts are,
//    otherwise no change. Ties and exact halves are not a majority.
// 4. No rain-reset here: §6.3's reset governs confidence weighting; §6.4
//    reads stored reports as-is.
// A clamped step that lands back on the current value is no change — §6.4's
// "log every change" means actual changes only.

import { TUNING } from "./config";
import type { ReportVerdict } from "./reports";

const HOUR_MS = 3_600_000;

/** One stored report, as the tune job reads it back. */
export interface TuningReport {
  verdict: ReportVerdict;
  /** When the report was created, ms since epoch. */
  createdMs: number;
}

export interface TuneResult {
  /** The multiplier to write, or null when nothing changes (window below
   *  the report floor, no strict majority, or the clamp lands back on the
   *  current value). */
  newMult: number | null;
  /** Reports in the window (n): tau_history's n_reports and the trails
   *  reports_used increment when a change is applied. */
  nReports: number;
}

/** Apply one night of §6.4 tuning to a trail's multiplier. `reports` are the
 *  trail's stored rows; the rule itself filters them to the 30-day window
 *  (a report exactly windowDays old still counts; one from the future —
 *  clock skew — never does). */
export function tuneTauMult(
  currentMult: number,
  reports: readonly TuningReport[],
  nowMs: number,
): TuneResult {
  const windowStartMs = nowMs - TUNING.windowDays * 24 * HOUR_MS;
  let n = 0;
  let wetter = 0;
  let drier = 0;
  for (const report of reports) {
    if (report.createdMs < windowStartMs || report.createdMs > nowMs) continue;
    n += 1;
    if (report.verdict === "wetter") wetter += 1;
    else if (report.verdict === "drier") drier += 1;
  }
  if (n < TUNING.minReports) return { newMult: null, nReports: n };
  const step =
    wetter * 2 > n ? TUNING.raiseStep : drier * 2 > n ? TUNING.lowerStep : null;
  if (step === null) return { newMult: null, nReports: n };
  const clamped = Math.min(
    TUNING.multMax,
    Math.max(TUNING.multMin, currentMult * step),
  );
  if (clamped === currentMult) return { newMult: null, nReports: n };
  return { newMult: clamped, nReports: n };
}
