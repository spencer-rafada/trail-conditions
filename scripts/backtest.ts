// Offline backtest for spec §4.4: runs the v3 mud model on the 8 committed
// rider-report cases and prints the table.
//
//   pnpm backtest
//
// Reads only fixtures/backtest/ — no network, same result every run. Exits
// non-zero on any mismatch against the spec's "v3 result in testing"
// column (which includes the two known misses as-is: JEM expects Dry,
// Deer Valley expects Muddy).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  pointCondition,
  tauTrail,
  walkWetness,
  WETNESS,
  OVERRIDES,
  type ConditionLevel,
  type HourSample,
  type Level,
  type SoilProfile,
} from "@trail-conditions/model";
import { CASES, type BacktestCase } from "./backtest-cases";

const FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/backtest", import.meta.url),
);

// ----- fixture loading (filesystem only) -----

interface SdaResponse {
  Table: (string | null)[][];
}

interface Stage4Response {
  data: { end_valid: string; precip_in: number }[];
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation: (number | null)[];
    snowfall: (number | null)[];
    snow_depth: (number | null)[];
  };
}

export interface CaseFixtures {
  soil: SdaResponse;
  openMeteo: OpenMeteoResponse;
  stage4Days: Stage4Response[];
}

export function loadCaseFixtures(slug: string): CaseFixtures {
  const read = (rel: string) =>
    JSON.parse(readFileSync(path.join(FIXTURE_DIR, rel), "utf8"));
  const stage4Dir = path.join(FIXTURE_DIR, "stage4", slug);
  return {
    soil: read(`soil/${slug}.json`),
    openMeteo: read(`open-meteo/${slug}.json`),
    stage4Days: readdirSync(stage4Dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => read(`stage4/${slug}/${f}`)),
  };
}

// ----- pure table building -----

const num = (v: string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** SDA row order follows the §3.1 query's SELECT list. */
export function soilFromSda(sda: SdaResponse, slug: string): SoilProfile {
  const row = sda.Table[0];
  if (!row) throw new Error(`no SDA soil row for ${slug}`);
  const [hydgrp, , sand, clay, fragGt10, frag3to10] = row;
  return {
    sandPct: num(sand),
    clayPct: num(clay),
    fragGt10Pct: num(fragGt10),
    frag3to10Pct: num(frag3to10),
    hydrologicGroup: hydgrp ?? null,
  };
}

const HOUR_MS = 3_600_000;
const stamp = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 13)}:00:00Z`;

interface OpenMeteoHour {
  tempF: number | null;
  precipIn: number | null;
  snowfallIn: number | null;
  snowDepth: number | null;
}

/** Key Open-Meteo hours by UTC hour-ending stamp. The API labels hours in
 *  UTC (timezone=UTC); temperature_2m is the value at the labeled instant,
 *  precipitation and snowfall are preceding-hour sums — so a label T
 *  describes the hour ending at T, same convention as Stage IV end_valid. */
function openMeteoByHour(om: OpenMeteoResponse): Map<string, OpenMeteoHour> {
  const h = om.hourly;
  const map = new Map<string, OpenMeteoHour>();
  h.time.forEach((label, i) => {
    map.set(`${label}:00Z`, {
      tempF: h.temperature_2m[i] ?? null,
      precipIn: h.precipitation[i] ?? null,
      snowfallIn: h.snowfall[i] ?? null,
      snowDepth: h.snow_depth[i] ?? null,
    });
  });
  return map;
}

export interface BacktestRow {
  trail: string;
  reportLocal: string;
  ridersSaid: string;
  expected: Level;
  computed: ConditionLevel;
  wetness: number;
}

export function computeRow(c: BacktestCase, fx: CaseFixtures): BacktestRow {
  const tau = tauTrail(soilFromSda(fx.soil, c.point.slug)); // tau_mult 1.0: no rider tuning yet

  const stage4 = new Map<string, number>();
  for (const day of fx.stage4Days) {
    for (const row of day.data) stage4.set(row.end_valid, row.precip_in);
  }
  const openMeteo = openMeteoByHour(fx.openMeteo);

  const reportMs = new Date(c.reportHourUtc).getTime();
  const hours: HourSample[] = [];
  let snowfall48hIn = 0;
  for (let i = WETNESS.windowHours - 1; i >= 0; i--) {
    const hourEnd = stamp(reportMs - i * HOUR_MS);
    const om = openMeteo.get(hourEnd);
    if (om?.tempF == null) {
      throw new Error(`${c.point.slug}: no Open-Meteo temperature for ${hourEnd}`);
    }
    // Past rain: Stage IV is the source of truth; Open-Meteo fills gaps.
    const precipIn = stage4.get(hourEnd) ?? om.precipIn;
    if (precipIn == null) {
      throw new Error(`${c.point.slug}: no precipitation for ${hourEnd}`);
    }
    hours.push({ tempF: om.tempF, precipIn });
    if (i < OVERRIDES.snowfallWindowHours) snowfall48hIn += om.snowfallIn ?? 0;
  }

  const reportHour = openMeteo.get(stamp(reportMs));
  if (reportHour?.tempF == null || reportHour.snowDepth == null) {
    throw new Error(`${c.point.slug}: no Open-Meteo data at ${c.reportHourUtc}`);
  }

  const wetness = walkWetness(hours, tau);
  const condition = pointCondition({
    wetness,
    tempF: reportHour.tempF,
    snowfall48hIn,
    snowDepth: reportHour.snowDepth,
  });

  return {
    trail: c.trail,
    reportLocal: c.reportLocal,
    ridersSaid: c.ridersSaid,
    expected: c.expected,
    computed: condition.level,
    wetness,
  };
}

export function buildBacktestTable(
  fixturesBySlug: Map<string, CaseFixtures>,
): BacktestRow[] {
  return CASES.map((c) => {
    const fx = fixturesBySlug.get(c.point.slug);
    if (!fx) throw new Error(`no fixtures loaded for ${c.point.slug}`);
    return computeRow(c, fx);
  });
}

// ----- CLI -----

const show = (level: Level | ConditionLevel) =>
  level.charAt(0).toUpperCase() + level.slice(1);

function main(): void {
  const fixtures = new Map(
    [...new Set(CASES.map((c) => c.point.slug))].map((slug) => [
      slug,
      loadCaseFixtures(slug),
    ]),
  );
  const rows = buildBacktestTable(fixtures);

  const header = ["Trail", "Time (America/Denver)", "Riders said", "Expected", "Computed", "w"];
  const cells = rows.map((r) => [
    r.trail,
    r.reportLocal,
    r.ridersSaid,
    show(r.expected),
    show(r.computed),
    r.wetness.toFixed(3),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => row[i]!.length)),
  );
  const line = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of cells) console.log(line(row));

  const misses = rows.filter((r) => r.computed !== r.expected);
  if (misses.length > 0) {
    console.error(
      `\n${misses.length} mismatch(es) against the spec §4.4 expected column:`,
    );
    for (const m of misses) {
      console.error(
        `  ${m.trail} ${m.reportLocal}: computed ${show(m.computed)}, expected ${show(m.expected)}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("\nAll 8 cases match spec §4.4.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
