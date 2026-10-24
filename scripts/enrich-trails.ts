/**
 * Trail enrichment (spec §2.4). Hand-run only — never on a schedule.
 *
 *   pnpm enrich-trails
 *
 * Reads the founder-approved data/trail-candidates.csv, drops duplicate rows
 * (identical in every column except county, first occurrence kept) and rows
 * whose BOTH sample points sit outside the three target counties (spec §2.1),
 * then enriches every remaining sample point with:
 *   - soil from USDA Soil Data Access (spec §3.1 query verbatim),
 *   - its Stage IV grid cell from the IEM API (`cell_id` = "gridi:gridj"),
 * and computes tau_base_h per point with the model's tauBase. A trail's
 * tau_base_h is the slowest-drying (max) of its points (spec §4.3's
 * "worst point" philosophy; flagged for the founder in the PR). Elevations
 * come from the CSV (USGS NED 10 m, founder-approved) — this script calls
 * no elevation API.
 *
 * Points USDA returns no soil row for get an all-null SoilProfile, which
 * tauBase maps to the spec §4.1 "else" tau; they are named in the run receipt
 * (soil_found: false in data/trails.json).
 *
 * Writes data/trails.json — the sanctioned generation path for that file
 * (the "never edit by hand" repo rule covers manual edits).
 *
 * Polite by design: strictly sequential, a delay between calls, one retry.
 * Raw API responses are cached in a scratch file outside the repo so an
 * interrupted run does not re-spend ~600 calls; the cache is never committed.
 *
 * Pure helpers are exported for tests (scripts/enrich-trails.test.ts, which
 * run on fixture rows/responses, never on live APIs). main() only runs when
 * the file is executed directly.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tauBase, type SoilProfile } from "@trail-conditions/model";

// ---------------------------------------------------------------------------
// Tunables (one block, discover-trails style)
// ---------------------------------------------------------------------------

export const CONFIG = {
  SDA_URL: "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest",
  IEM_URL: "https://mesonet.agron.iastate.edu/json/stage4.py",
  // Any recent past day works: only the top-level gridi/gridj are read, the
  // hourly data is ignored. Verified live 2026-10-23.
  IEM_VALID_DATE: "2026-10-20",
  DELAY_MS: 800, // pause between any two API calls (polite pacing)
  RETRY_DELAY_MS: 10_000, // one retry per call after this wait, then abort
  // Scratch cache for raw API responses, outside the repo so it is never
  // committed; an interrupted run resumes from it.
  CACHE_FILE:
    process.env["ENRICH_CACHE"] ??
    path.join(tmpdir(), "trail-conditions-enrich-cache.json"),
  // Salt Lake–Davis county line, approximated as a step function of
  // longitude and calibrated against the candidate CSV (its southern,
  // eastern and western extreme points all sit well inside Utah/Wasatch
  // counties, so this is the only county boundary any point approaches).
  // West of the ridge foot the line crosses the North Salt Lake bench
  // (~40.834 between Bobsled's top and Mueller Park's trailhead); along the
  // ridge it runs just south of Grandview Peak (~40.845).
  DAVIS_LINE: { splitLon: -111.8, westLat: 40.834, eastLat: 40.845 },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const CSV_HEADER =
  "system,county,trailhead_lat,trailhead_lon,trailhead_elev_m,top_lat,top_lon,top_elev_m,n_ways,n_relations,osm_refs,notes,name_source";

/** Where the system's display name came from (written by discover-trails):
 *  "osm" = a trail element's own name; "area" = the named park/reserve
 *  containing the ways; "place" = derived from the nearest place node (the
 *  cluster has no usable OSM trail name). Anything but "osm" is a derived name. */
export const NAME_SOURCES = ["osm", "area", "place"] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

export type PointLabel = "Trailhead" | "Top";

export interface SamplePoint {
  label: PointLabel;
  lat: number;
  lon: number;
  elev_m: number;
}

export interface Candidate {
  system: string;
  county: string;
  points: [SamplePoint, SamplePoint]; // [Trailhead, Top]
  osm_refs: string;
  notes: string;
  name_source: NameSource;
  /** Every raw CSV cell except county — the dedupe identity. */
  dedupeKey: string;
  /** 1-based line number in the CSV file, for receipts. */
  csvLine: number;
}

export interface SdaResponse {
  Table?: (string | null)[][];
}

export interface SoilResult {
  /** false = SDA returned no soil row (empty/missing Table). */
  found: boolean;
  soil: SoilProfile;
  /** drainagecl. Carried in trails.json but not part of the model's SoilProfile. */
  drainage: string | null;
}

export interface TrailPoint extends SamplePoint {
  soil: SoilProfile;
  drainage: string | null;
  soil_found: boolean;
  cell_id: string; // "gridi:gridj"
  tau_base_h: number;
}

export interface Trail {
  id: string;
  system: string;
  county: string;
  osm_refs: string;
  name_source: NameSource;
  tau_base_h: number; // max (slowest-drying) of its points
  tau_mult: number; // 1.0 until rider reports tune it (spec §6.4)
  points: TrailPoint[];
}

// ---------------------------------------------------------------------------
// Pure helpers (tested in scripts/enrich-trails.test.ts)
// ---------------------------------------------------------------------------

/** Minimal RFC-4180-ish parser for the candidates CSV (quoted cells may
 *  contain commas and doubled quotes; no multi-line cells in this file). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const cells: string[] = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(cell);
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

const COLUMNS = CSV_HEADER.split(",");

export function parseCandidatesCsv(text: string): Candidate[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header || header.join(",") !== CSV_HEADER) {
    throw new Error(
      `unexpected trail-candidates.csv header: ${header?.join(",")}`,
    );
  }
  return rows.slice(1).map((cells, i) => {
    const csvLine = i + 2;
    if (cells.length !== COLUMNS.length) {
      throw new Error(
        `CSV line ${csvLine}: ${cells.length} cells, expected ${COLUMNS.length}`,
      );
    }
    const cell = (name: string) => cells[COLUMNS.indexOf(name)] as string;
    const num = (name: string) => {
      const value = Number(cell(name));
      if (!Number.isFinite(value)) {
        throw new Error(`CSV line ${csvLine}: ${name} is not a number: ${cell(name)}`);
      }
      return value;
    };
    const countyIndex = COLUMNS.indexOf("county");
    const nameSource = cell("name_source");
    if (!(NAME_SOURCES as readonly string[]).includes(nameSource)) {
      throw new Error(
        `CSV line ${csvLine}: name_source is "${nameSource}", expected one of ${NAME_SOURCES.join("|")}`,
      );
    }
    return {
      system: cell("system"),
      county: cell("county"),
      points: [
        {
          label: "Trailhead" as const,
          lat: num("trailhead_lat"),
          lon: num("trailhead_lon"),
          elev_m: num("trailhead_elev_m"),
        },
        {
          label: "Top" as const,
          lat: num("top_lat"),
          lon: num("top_lon"),
          elev_m: num("top_elev_m"),
        },
      ] as [SamplePoint, SamplePoint],
      osm_refs: cell("osm_refs"),
      notes: cell("notes"),
      name_source: nameSource as NameSource,
      dedupeKey: JSON.stringify(cells.filter((_, j) => j !== countyIndex)),
      csvLine,
    };
  });
}

/** Rows identical in every column except county collapse to their first
 *  occurrence (the known duplicates are Utah/Wasatch county-pair rows). */
export function dedupeCandidates(candidates: Candidate[]): {
  kept: Candidate[];
  dropped: Array<{ dropped: Candidate; keptCopy: Candidate }>;
} {
  const firstByKey = new Map<string, Candidate>();
  const kept: Candidate[] = [];
  const dropped: Array<{ dropped: Candidate; keptCopy: Candidate }> = [];
  for (const c of candidates) {
    const first = firstByKey.get(c.dedupeKey);
    if (first) {
      dropped.push({ dropped: c, keptCopy: first });
    } else {
      firstByKey.set(c.dedupeKey, c);
      kept.push(c);
    }
  }
  return { kept, dropped };
}

/** True when the point lies north of the approximated Salt Lake–Davis
 *  county line, i.e. outside the three target counties (spec §2.1). */
export function pointOutsideCounties(p: { lat: number; lon: number }): boolean {
  const line = CONFIG.DAVIS_LINE;
  const boundaryLat = p.lon <= line.splitLon ? line.westLat : line.eastLat;
  return p.lat > boundaryLat;
}

export interface CrossedPoint {
  system: string;
  county: string;
  label: PointLabel;
  lat: number;
  lon: number;
  /** true when the whole row was dropped (both points outside). */
  rowDropped: boolean;
}

/** Both-points-outside rule: a row is dropped only when every sample point
 *  is outside the target counties. Every crossing point is reported. */
export function filterByCounty(candidates: Candidate[]): {
  kept: Candidate[];
  droppedRows: Candidate[];
  crossedPoints: CrossedPoint[];
} {
  const kept: Candidate[] = [];
  const droppedRows: Candidate[] = [];
  const crossedPoints: CrossedPoint[] = [];
  for (const c of candidates) {
    const outside = c.points.map(pointOutsideCounties);
    const rowDropped = outside.every(Boolean);
    c.points.forEach((p, i) => {
      if (outside[i]) {
        crossedPoints.push({
          system: c.system,
          county: c.county,
          label: p.label,
          lat: p.lat,
          lon: p.lon,
          rowDropped,
        });
      }
    });
    (rowDropped ? droppedRows : kept).push(c);
  }
  return { kept, droppedRows, crossedPoints };
}

/** Spec §3.1 soil query, verbatim, with the point's lon/lat substituted. */
export const sdaQuery = (p: { lat: number; lon: number }): string =>
  "SELECT TOP 1 c.hydgrp, c.drainagecl, ch.sandtotal_r, ch.claytotal_r, " +
  "ch.fraggt10_r, ch.frag3to10_r " +
  `FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${p.lon} ${p.lat})') k ` +
  "JOIN mapunit mu ON mu.mukey = k.mukey " +
  "JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' " +
  "LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0 " +
  "ORDER BY c.comppct_r DESC";

const num = (v: string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

const NO_SOIL: SoilProfile = {
  sandPct: null,
  clayPct: null,
  fragGt10Pct: null,
  frag3to10Pct: null,
  hydrologicGroup: null,
};

/** SDA row order follows the §3.1 query's SELECT list. An empty or missing
 *  Table means SDA has no soil there: found=false with an all-null profile,
 *  which tauBase maps to the spec §4.1 "else" tau. */
export function soilFromSdaResponse(sda: SdaResponse): SoilResult {
  const row = sda.Table?.[0];
  if (!row) return { found: false, soil: { ...NO_SOIL }, drainage: null };
  const [hydgrp, drainagecl, sand, clay, fragGt10, frag3to10] = row;
  return {
    found: true,
    soil: {
      sandPct: num(sand),
      clayPct: num(clay),
      fragGt10Pct: num(fragGt10),
      frag3to10Pct: num(frag3to10),
      hydrologicGroup: hydgrp || null,
    },
    drainage: drainagecl || null,
  };
}

/** IEM stage4.py returns top-level integer gridi/gridj (verified live
 *  2026-10-23); the shared radar cell key is "gridi:gridj". */
export function cellIdFromIem(res: unknown): string {
  const r = res as { gridi?: unknown; gridj?: unknown };
  for (const key of ["gridi", "gridj"] as const) {
    if (!Number.isInteger(r?.[key])) {
      throw new Error(`IEM response has no integer ${key}: ${JSON.stringify(res).slice(0, 200)}`);
    }
  }
  return `${r.gridi}:${r.gridj}`;
}

/** Deterministic unique ids: slug of the system name; collisions append the
 *  county, then a counter. */
export function assignTrailIds(
  rows: Array<{ system: string; county: string }>,
): string[] {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const taken = new Set<string>();
  return rows.map((row) => {
    let id = slug(row.system);
    if (taken.has(id)) id = `${id}-${slug(row.county.replace(/ county$/i, ""))}`;
    for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
    taken.add(id);
    return id;
  });
}

export interface PointEnrichment extends SoilResult {
  cell_id: string;
}

/** Assembles one output trail. tau_base_h per point comes from the model's
 *  tauBase; the trail's tau_base_h is the max (slowest-drying) point. */
export function buildTrail(
  candidate: Candidate,
  id: string,
  enrichments: PointEnrichment[],
): Trail {
  if (enrichments.length !== candidate.points.length) {
    throw new Error(`${id}: ${enrichments.length} enrichments for ${candidate.points.length} points`);
  }
  const points: TrailPoint[] = candidate.points.map((p, i) => {
    const e = enrichments[i] as PointEnrichment;
    return {
      ...p,
      soil: e.soil,
      drainage: e.drainage,
      soil_found: e.found,
      cell_id: e.cell_id,
      tau_base_h: tauBase(e.soil),
    };
  });
  return {
    id,
    system: candidate.system,
    county: candidate.county,
    osm_refs: candidate.osm_refs,
    name_source: candidate.name_source,
    tau_base_h: Math.max(...points.map((p) => p.tau_base_h)),
    tau_mult: 1.0,
    points,
  };
}

const SOIL_KEYS: ReadonlyArray<keyof SoilProfile> = [
  "sandPct",
  "clayPct",
  "fragGt10Pct",
  "frag3to10Pct",
  "hydrologicGroup",
];

/** Fail-loud validation of the assembled output: every field present and
 *  well-formed on every trail and point. Returns a list of problems. */
export function validateTrails(trails: Trail[]): string[] {
  const problems: string[] = [];
  const bad = (id: string, what: string) => problems.push(`${id}: ${what}`);
  for (const t of trails) {
    if (!t.id) bad(t.system, "missing id");
    if (!t.system) bad(t.id, "missing system");
    if (!t.county) bad(t.id, "missing county");
    if (!t.osm_refs) bad(t.id, "missing osm_refs");
    if (!(NAME_SOURCES as readonly string[]).includes(t.name_source)) {
      bad(t.id, `name_source is "${t.name_source}", expected one of ${NAME_SOURCES.join("|")}`);
    }
    if (t.tau_mult !== 1.0) bad(t.id, `tau_mult is ${t.tau_mult}, expected 1.0`);
    if (t.points.length !== 2) bad(t.id, `${t.points.length} points, expected 2`);
    const maxTau = Math.max(...t.points.map((p) => p.tau_base_h));
    if (t.tau_base_h !== maxTau) {
      bad(t.id, `trail tau_base_h ${t.tau_base_h} is not the max point tau ${maxTau}`);
    }
    for (const p of t.points) {
      const pid = `${t.id}/${p.label}`;
      for (const field of ["lat", "lon", "elev_m", "tau_base_h"] as const) {
        if (!Number.isFinite(p[field])) bad(pid, `${field} is not a finite number`);
      }
      if (!/^\d+:\d+$/.test(p.cell_id)) bad(pid, `malformed cell_id "${p.cell_id}"`);
      if (p.tau_base_h <= 0) bad(pid, `tau_base_h ${p.tau_base_h} is not positive`);
      if (typeof p.soil_found !== "boolean") bad(pid, "missing soil_found");
      if (p.drainage !== null && typeof p.drainage !== "string") {
        bad(pid, "drainage is neither string nor null");
      }
      for (const key of SOIL_KEYS) {
        if (!(key in p.soil)) bad(pid, `soil is missing ${key}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// I/O (only runs when executed directly — never from tests)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Cache {
  sda: Record<string, SdaResponse>;
  iem: Record<string, { gridi: number; gridj: number }>;
}

function loadCache(): Cache {
  if (existsSync(CONFIG.CACHE_FILE)) {
    return JSON.parse(readFileSync(CONFIG.CACHE_FILE, "utf8")) as Cache;
  }
  return { sda: {}, iem: {} };
}

const saveCache = (cache: Cache) =>
  writeFileSync(CONFIG.CACHE_FILE, JSON.stringify(cache));

/** One fetch with a single retry; non-OK after the retry aborts the run
 *  (the cache keeps already-fetched responses for the rerun). */
async function fetchJson(what: string, url: string, init?: RequestInit): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return (await res.json()) as unknown;
      if (attempt > 0) throw new Error(`${what}: HTTP ${res.status} after retry`);
      console.warn(`${what}: HTTP ${res.status}; retrying once…`);
    } catch (err) {
      if (attempt > 0) throw err instanceof Error ? err : new Error(`${what}: ${String(err)}`);
      console.warn(`${what}: ${String(err)}; retrying once…`);
    }
    await sleep(CONFIG.RETRY_DELAY_MS);
  }
}

const coordKey = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;

async function enrichPoint(
  cache: Cache,
  p: SamplePoint,
  who: string,
): Promise<PointEnrichment> {
  const key = coordKey(p);

  let sda = cache.sda[key];
  if (!sda) {
    sda = (await fetchJson(`SDA ${who}`, CONFIG.SDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: sdaQuery(p), format: "JSON" }),
    })) as SdaResponse;
    cache.sda[key] = sda;
    saveCache(cache);
    await sleep(CONFIG.DELAY_MS);
  }

  let iem = cache.iem[key];
  if (!iem) {
    const res = await fetchJson(
      `IEM ${who}`,
      `${CONFIG.IEM_URL}?lat=${p.lat}&lon=${p.lon}&valid=${CONFIG.IEM_VALID_DATE}&tz=America/Denver`,
    );
    // Validate before caching so a bad shape is never persisted.
    cellIdFromIem(res);
    const { gridi, gridj } = res as { gridi: number; gridj: number };
    iem = { gridi, gridj };
    cache.iem[key] = iem;
    saveCache(cache);
    await sleep(CONFIG.DELAY_MS);
  }

  return { ...soilFromSdaResponse(sda), cell_id: cellIdFromIem(iem) };
}

async function main(): Promise<void> {
  console.log(`Trail enrichment — ${new Date().toISOString()}`);
  const csvUrl = new URL("../data/trail-candidates.csv", import.meta.url);
  const candidates = parseCandidatesCsv(readFileSync(csvUrl, "utf8"));
  console.log(`${candidates.length} candidate rows read`);

  const { kept: unique, dropped: duplicates } = dedupeCandidates(candidates);
  console.log(`\nDuplicate rows dropped (identical except county): ${duplicates.length}`);
  for (const d of duplicates) {
    console.log(
      `  - "${d.dropped.system}" (${d.dropped.county}, CSV line ${d.dropped.csvLine}) — kept the ${d.keptCopy.county} copy (CSV line ${d.keptCopy.csvLine})`,
    );
  }

  const { kept, droppedRows, crossedPoints } = filterByCounty(unique);
  console.log(`\nRows dropped by the county filter (both points outside): ${droppedRows.length}`);
  for (const c of droppedRows) {
    console.log(`  - "${c.system}" (labeled ${c.county}, CSV line ${c.csvLine})`);
  }
  console.log("Points north of the Salt Lake–Davis line:");
  for (const p of crossedPoints) {
    console.log(
      `  - "${p.system}" ${p.label} (${p.lat},${p.lon}) — ${p.rowDropped ? "row dropped" : "row kept (other point inside)"}`,
    );
  }

  const ids = assignTrailIds(kept);
  const cache = loadCache();
  console.log(
    `\nEnriching ${kept.length} trails / ${kept.length * 2} points ` +
      `(cache: ${Object.keys(cache.sda).length} SDA, ${Object.keys(cache.iem).length} IEM responses at ${CONFIG.CACHE_FILE})`,
  );

  const trails: Trail[] = [];
  for (const [i, candidate] of kept.entries()) {
    const id = ids[i] as string;
    const enrichments: PointEnrichment[] = [];
    for (const p of candidate.points) {
      enrichments.push(await enrichPoint(cache, p, `${id}/${p.label}`));
    }
    trails.push(buildTrail(candidate, id, enrichments));
    if ((i + 1) % 10 === 0) console.log(`  …${i + 1}/${kept.length} trails enriched`);
  }

  const noSoil = trails.flatMap((t) =>
    t.points.filter((p) => !p.soil_found).map((p) => `"${t.system}" ${p.label} (${p.lat},${p.lon})`),
  );
  console.log(`\nPoints with no SDA soil row (spec §4.1 "else" tau applies): ${noSoil.length}`);
  for (const line of noSoil) console.log(`  - ${line}`);

  const problems = validateTrails(trails);
  if (problems.length > 0) {
    console.error(`\nVALIDATION FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  const out = {
    generated_utc: new Date().toISOString(),
    source: "data/trail-candidates.csv",
    trails,
  };
  const outUrl = new URL("../data/trails.json", import.meta.url);
  writeFileSync(outUrl, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\nWrote ${trails.length} trails / ${trails.length * 2} points to data/trails.json`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
