// One-time, hand-run fixture fetch for the §4.4 backtest:
//
//   pnpm tsx scripts/fetch-backtest-fixtures.ts
//
// Fetches, for each backtest point: IEM Stage IV hourly rain (one call per
// America/Denver calendar day covering the 240 h before each report hour),
// Open-Meteo hourly temps/precip/snowfall/snow_depth at the point's
// elevation, and the USDA SDA soil query from spec §3.1. Raw responses are
// committed under fixtures/backtest/ with a README.md receipt.
//
// Polite by design: strictly sequential, a delay between calls, no retries.
// On an Open-Meteo 429 it tries the archive endpoint once, then gives up
// and records the miss in the receipt. The backtest and tests never import
// this file; they read only the committed fixtures.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES, POINTS, type BacktestPoint } from "./backtest-cases";

const FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/backtest", import.meta.url),
);
const DELAY_MS = 700;
const HOURLY_VARS = "temperature_2m,precipitation,snowfall,snow_depth";
const WALK_HOURS = 240;
// The Open-Meteo forecast endpoint reaches back ~92 days; older windows
// must use the ERA5 archive endpoint.
const FORECAST_REACH_DAYS = 85;

const SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
const sdaQuery = (p: BacktestPoint) =>
  "SELECT TOP 1 c.hydgrp, c.drainagecl, ch.sandtotal_r, ch.claytotal_r, " +
  "ch.fraggt10_r, ch.frag3to10_r " +
  `FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${p.lon} ${p.lat})') k ` +
  "JOIN mapunit mu ON mu.mukey = k.mukey " +
  "JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' " +
  "LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0 " +
  "ORDER BY c.comppct_r DESC";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const utcDate = (d: Date) => d.toISOString().slice(0, 10);

interface ReceiptLine {
  what: string;
  status: string;
  savedTo: string;
}
const receipt: ReceiptLine[] = [];

async function save(relPath: string, body: string): Promise<string> {
  const full = path.join(FIXTURE_DIR, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return relPath;
}

async function fetchTo(
  what: string,
  url: string,
  relPath: string,
  init?: RequestInit,
): Promise<number> {
  const res = await fetch(url, init);
  const body = await res.text();
  if (res.ok) {
    await save(relPath, body);
    receipt.push({ what, status: `HTTP ${res.status}`, savedTo: relPath });
  } else {
    receipt.push({ what, status: `HTTP ${res.status} — NOT SAVED`, savedTo: "" });
  }
  await sleep(DELAY_MS);
  return res.status;
}

/** Per point: the UTC window [start, end] the walk needs, padded a day. */
function pointWindow(point: BacktestPoint): { start: Date; end: Date } {
  const reports = CASES.filter((c) => c.point.slug === point.slug).map(
    (c) => new Date(c.reportHourUtc).getTime(),
  );
  const HOUR = 3_600_000;
  return {
    start: new Date(Math.min(...reports) - (WALK_HOURS - 1) * HOUR - 24 * HOUR),
    end: new Date(Math.max(...reports)),
  };
}

/** America/Denver calendar days covering the window. All cases are in MDT
 *  (UTC-6); DST does not change inside any window (next switch 2026-11-01). */
function denverDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const MDT_OFFSET = 6 * 3_600_000;
  for (
    let t = new Date(start.getTime() - MDT_OFFSET);
    utcDate(t) <= utcDate(new Date(end.getTime() - MDT_OFFSET));
    t = new Date(t.getTime() + 24 * 3_600_000)
  ) {
    days.push(utcDate(t));
  }
  return days;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const points = Object.values(POINTS);

  // 1. Elevation per point, one call (Open-Meteo elevation API, 90 m DEM).
  const elevationUrl =
    "https://api.open-meteo.com/v1/elevation" +
    `?latitude=${points.map((p) => p.lat).join(",")}` +
    `&longitude=${points.map((p) => p.lon).join(",")}`;
  const elevationStatus = await fetchTo(
    "elevation (all points)",
    elevationUrl,
    "elevation.json",
  );
  if (elevationStatus !== 200) {
    throw new Error(`elevation fetch failed (HTTP ${elevationStatus}); aborting`);
  }
  const elevations: number[] = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      path.join(FIXTURE_DIR, "elevation.json"),
      "utf8",
    ),
  ).elevation;

  // 2. Per point: SDA soil, Stage IV per day, Open-Meteo hourly window.
  for (const [i, point] of points.entries()) {
    const { start, end } = pointWindow(point);

    const sdaRes = await fetch(SDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: sdaQuery(point), format: "JSON" }),
    });
    const sdaBody = await sdaRes.text();
    if (sdaRes.ok) {
      await save(`soil/${point.slug}.json`, sdaBody);
      receipt.push({
        what: `SDA soil ${point.slug}`,
        status: `HTTP ${sdaRes.status}`,
        savedTo: `soil/${point.slug}.json`,
      });
    } else {
      receipt.push({
        what: `SDA soil ${point.slug}`,
        status: `HTTP ${sdaRes.status} — NOT SAVED`,
        savedTo: "",
      });
    }
    await sleep(DELAY_MS);

    for (const day of denverDays(start, end)) {
      const url =
        "https://mesonet.agron.iastate.edu/json/stage4.py" +
        `?lat=${point.lat}&lon=${point.lon}&valid=${day}&tz=America/Denver`;
      await fetchTo(
        `Stage IV ${point.slug} ${day}`,
        url,
        `stage4/${point.slug}/${day}.json`,
      );
    }

    const ageDays = (Date.now() - start.getTime()) / 86_400_000;
    const params =
      `?latitude=${point.lat}&longitude=${point.lon}` +
      `&elevation=${elevations[i]}` +
      `&hourly=${HOURLY_VARS}` +
      "&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=UTC" +
      `&start_date=${utcDate(start)}&end_date=${utcDate(end)}`;
    const forecastUrl = `https://api.open-meteo.com/v1/forecast${params}`;
    const archiveUrl = `https://archive-api.open-meteo.com/v1/archive${params}`;

    if (ageDays > FORECAST_REACH_DAYS) {
      await fetchTo(
        `Open-Meteo archive ${point.slug}`,
        archiveUrl,
        `open-meteo/${point.slug}.json`,
      );
    } else {
      const status = await fetchTo(
        `Open-Meteo forecast ${point.slug}`,
        forecastUrl,
        `open-meteo/${point.slug}.json`,
      );
      if (status === 429) {
        await fetchTo(
          `Open-Meteo archive (forecast 429) ${point.slug}`,
          archiveUrl,
          `open-meteo/${point.slug}.json`,
        );
      }
    }
  }

  // 3. Receipt.
  const lines = [
    "# Backtest fixtures — fetch receipt",
    "",
    "Raw API responses for the 8 spec §4.4 backtest cases, saved verbatim.",
    "One-time hand run; the backtest and tests read only these files and",
    "never fetch.",
    "",
    `- Command: \`pnpm tsx scripts/fetch-backtest-fixtures.ts\``,
    `- Started: ${startedAt} (UTC)`,
    `- Finished: ${new Date().toISOString()} (UTC)`,
    "",
    "Notes on axes and units, verified from the raw responses:",
    "- Stage IV `end_valid` is UTC (hour-ending accumulation, inches);",
    "  `tz=America/Denver` only selects the local calendar day.",
    "- Open-Meteo hours are labeled UTC (`timezone=UTC`); temperature_2m is",
    "  °F at the labeled instant; precipitation and snowfall are",
    "  preceding-hour sums in inches; snow_depth is feet (the unit follows precipitation_unit=inch; see hourly_units in the raw responses).",
    "- SDA soil values are strings in `Table` rows:",
    "  hydgrp, drainagecl, sandtotal_r, claytotal_r, fraggt10_r, frag3to10_r.",
    "",
    "## Calls, in order",
    "",
    "| What | Status | Saved to |",
    "|---|---|---|",
    ...receipt.map((r) => `| ${r.what} | ${r.status} | ${r.savedTo} |`),
    "",
    "## SDA query shape (spec §3.1), per point coordinate",
    "",
    "```sql",
    sdaQuery({ slug: "<point>", lat: 0, lon: 0 })
      .replace("point(0 0)", "point(<lon> <lat>)")
      .replace(/ (FROM|JOIN|LEFT JOIN|ORDER BY) /g, "\n$1 "),
    "```",
    "",
  ];
  await save("README.md", lines.join("\n"));

  const misses = receipt.filter((r) => !r.status.startsWith("HTTP 2"));
  console.log(`${receipt.length} calls, ${misses.length} failed.`);
  for (const m of misses) console.log(`MISS: ${m.what} — ${m.status}`);
  process.exitCode = misses.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
