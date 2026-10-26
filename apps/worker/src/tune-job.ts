// Nightly tune cron (spec §7.3 cron 2, ticket C-20261023-M6): apply the §6.4
// tuning rule per trail, log every actual change to tau_history, bump
// trails.reports_used, then delete old data — reports past the 30-day tuning
// window (RETENTION.reportsDays; they stop counting toward confidence after
// 48 h, which the readers enforce) and score_history past its retention. Pure D1 work: no fetches (ticket decision 4 — §6.3's rain-reset
// governs confidence weighting, not tuning). Order inside the run (ticket
// decision 2): tune first, then delete, all in one transactional D1 batch,
// so tonight's rule still sees everything tonight's deletion removes.
//
// The deletion scans compare created_utc/ts_utc without a leading index
// (idx_reports_trail_created leads on trail_id, score_history's PK too);
// both tables stay small at this scale — nightly pruning is the bound.

import {
  tuneTauMult,
  RETENTION,
  TUNING,
  type ReportVerdict,
  type TuningReport,
} from "@trail-conditions/model";
import { HOUR_MS, stamp } from "./time";
import type { Env, SubrequestCounter } from "./score-job";

export interface TuneJobResult {
  trailsSeen: number;
  /** Trails whose tau_mult actually changed (== tau_history rows written). */
  trailsTuned: number;
  reportsInWindow: number;
  subrequests: SubrequestCounter;
}

interface TrailTuneRow {
  id: string;
  tau_mult: number;
}

export async function runTuneJob(env: Env, nowMs: number): Promise<TuneJobResult> {
  const counter: SubrequestCounter = { fetches: 0, d1Calls: 0, d1Statements: 0 };
  const countBatch = <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    counter.d1Calls += 1;
    counter.d1Statements += statements.length;
    return env.DB.batch<T>(statements);
  };

  // 1. Every trail plus the 30-day window's reports, one batch. The rule
  //    re-filters by createdMs, so the SQL window only bounds the read.
  const windowSince = new Date(
    nowMs - TUNING.windowDays * 24 * HOUR_MS,
  ).toISOString();
  const [trailsRes, reportsRes] = await countBatch<Record<string, unknown>>([
    env.DB.prepare("SELECT id, tau_mult FROM trails"),
    env.DB.prepare(
      "SELECT trail_id, created_utc, verdict FROM reports WHERE created_utc >= ?",
    ).bind(windowSince),
  ]);
  const trails = (trailsRes?.results ?? []) as unknown as TrailTuneRow[];
  const reportRows = (reportsRes?.results ?? []) as unknown as {
    trail_id: string;
    created_utc: string;
    verdict: ReportVerdict;
  }[];
  const reportsByTrail = new Map<string, TuningReport[]>();
  for (const row of reportRows) {
    const createdMs = Date.parse(row.created_utc);
    if (Number.isNaN(createdMs)) continue;
    const report = { verdict: row.verdict, createdMs };
    const list = reportsByTrail.get(row.trail_id);
    if (list) list.push(report);
    else reportsByTrail.set(row.trail_id, [report]);
  }

  // 2. Apply the rule per trail; only actual changes write anything.
  const nowIso = new Date(nowMs).toISOString();
  const statements: D1PreparedStatement[] = [];
  let trailsTuned = 0;
  for (const trail of trails) {
    const { newMult, nReports } = tuneTauMult(
      trail.tau_mult,
      reportsByTrail.get(trail.id) ?? [],
      nowMs,
    );
    if (newMult === null) continue;
    trailsTuned += 1;
    statements.push(
      // Ticket decision 3: reports_used is cumulative — each applied change
      // adds the window's n, so a report still in the window tomorrow night
      // may count again. It only paces the §5 tuned-bonus threshold (5).
      env.DB.prepare(
        "UPDATE trails SET tau_mult = ?, reports_used = reports_used + ? WHERE id = ?",
      ).bind(newMult, nReports, trail.id),
      env.DB.prepare(
        "INSERT INTO tau_history (trail_id, ts_utc, old_mult, new_mult, n_reports)" +
          " VALUES (?, ?, ?, ?, ?)",
      ).bind(trail.id, nowIso, trail.tau_mult, newMult, nReports),
    );
  }

  // 3. Deletion, after the tuning statements in the same batch (decision 2).
  //    reports.created_utc is a full ISO string, score_history.ts_utc an
  //    hour-ending stamp — both sort as strings against a cutoff of their
  //    own format.
  statements.push(
    env.DB.prepare("DELETE FROM reports WHERE created_utc < ?").bind(
      new Date(nowMs - RETENTION.reportsDays * 24 * HOUR_MS).toISOString(),
    ),
    env.DB.prepare("DELETE FROM score_history WHERE ts_utc < ?").bind(
      stamp(nowMs - RETENTION.scoreHistoryDays * 24 * HOUR_MS),
    ),
  );
  await countBatch(statements);

  const result: TuneJobResult = {
    trailsSeen: trails.length,
    trailsTuned,
    reportsInWindow: reportRows.length,
    subrequests: counter,
  };
  console.log(`tune-job ${JSON.stringify(result)}`);
  return result;
}
