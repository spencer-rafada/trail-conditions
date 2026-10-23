// The 8 backtest cases from spec §4.4, shared by the one-time fixture
// fetcher and the offline backtest. Pure data, no I/O.
//
// Report times in the spec are America/Denver; all 8 fall in MDT (UTC-6),
// so each reportHourUtc below is the spec time plus 6 hours.

import type { Level } from "@trail-conditions/model";

export interface BacktestPoint {
  /** Directory slug under fixtures/backtest/. */
  slug: string;
  lat: number;
  lon: number;
}

export interface BacktestCase {
  trail: string;
  point: BacktestPoint;
  /** The spec's report time, for display. */
  reportLocal: string;
  /** The same instant in UTC, ISO, hour precision. */
  reportHourUtc: string;
  ridersSaid: string;
  /** The spec's "v3 result in testing" column, including the known misses. */
  expected: Level;
}

export const POINTS = {
  wasatchCrest: { slug: "wasatch-crest", lat: 40.615, lon: -111.585 },
  spinalTap: { slug: "spinal-tap", lat: 38.7717, lon: -112.1553 },
  jem: { slug: "jem", lat: 37.165, lon: -113.315 },
  butterfield: { slug: "butterfield", lat: 40.488, lon: -112.08 },
  deerValley: { slug: "deer-valley", lat: 40.62, lon: -111.49 },
  lehisDream: { slug: "lehis-dream", lat: 40.444, lon: -111.853 },
} as const satisfies Record<string, BacktestPoint>;

export const CASES: readonly BacktestCase[] = [
  {
    trail: "Wasatch Crest",
    point: POINTS.wasatchCrest,
    reportLocal: "2026-10-17 10:00",
    reportHourUtc: "2026-10-17T16:00:00Z",
    ridersSaid: "Muddy",
    expected: "muddy",
  },
  {
    trail: "Wasatch Crest",
    point: POINTS.wasatchCrest,
    reportLocal: "2026-10-18 11:00",
    reportHourUtc: "2026-10-18T17:00:00Z",
    ridersSaid: "Muddy",
    expected: "muddy",
  },
  {
    trail: "Wasatch Crest",
    point: POINTS.wasatchCrest,
    reportLocal: "2026-10-21 11:00",
    reportHourUtc: "2026-10-21T17:00:00Z",
    ridersSaid: "Dry (secondhand)",
    expected: "prime",
  },
  {
    trail: "Spinal Tap (Richfield)",
    point: POINTS.spinalTap,
    reportLocal: "2026-10-18 10:00",
    reportHourUtc: "2026-10-18T16:00:00Z",
    ridersSaid: "Hero dirt",
    expected: "soft",
  },
  {
    trail: "JEM (Hurricane)",
    point: POINTS.jem,
    reportLocal: "2026-10-19 12:00",
    reportHourUtc: "2026-10-19T18:00:00Z",
    ridersSaid: "Muddy",
    expected: "dry", // known miss: soil says it dries fast; rider tuning (§6.4) should fix it
  },
  {
    trail: "Butterfield",
    point: POINTS.butterfield,
    reportLocal: "2026-08-29 13:00",
    reportHourUtc: "2026-08-29T19:00:00Z",
    ridersSaid: "Sloppy",
    expected: "muddy",
  },
  {
    trail: "Deer Valley",
    point: POINTS.deerValley,
    reportLocal: "2026-09-19 11:00",
    reportHourUtc: "2026-09-19T17:00:00Z",
    ridersSaid: "Hero dirt",
    expected: "muddy", // known miss: do not tune thresholds on 8 points
  },
  {
    trail: "Lehi's Dream",
    point: POINTS.lehisDream,
    reportLocal: "2026-05-01 11:00",
    reportHourUtc: "2026-05-01T17:00:00Z",
    ridersSaid: "Dry",
    expected: "prime",
  },
];
