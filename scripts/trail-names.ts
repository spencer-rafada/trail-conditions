/**
 * Member trail names for search. Hand-run only — never on a schedule.
 *
 *   pnpm trail-names
 *
 * Re-runs discovery's Overpass county queries and clustering (the same
 * functions as scripts/discover-trails.ts — no elevation, soil, or radar
 * calls), matches each clustered system to its data/trails.json entry, and
 * writes data/trail-names.json: trail id -> the names of the OSM trails
 * inside that system. Search uses these so "Clark's" finds Corner Canyon.
 *
 * It reads data/trails.json but never writes it (the human-reviewed list).
 * A trail whose system can't be matched just gets no member names; the
 * script lists those at the end.
 *
 * Pure helpers are exported for tests (scripts/trail-names.test.ts, run on
 * fixtures). main() only runs when the file is executed directly.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  COUNTIES,
  CONFIG,
  buildCountyQuery,
  clusterSystems,
  fetchOverpass,
  haversineMeters,
  normalizeName,
  shouldKeepSystem,
  sleep,
  type County,
  type LatLon,
  type System,
} from "./discover-trails";

export const NAMES_CONFIG = {
  /** A system whose name differs from the trails.json entry (renamed in
   *  review) still matches when one of its points is this close to the
   *  entry's trailhead. */
  NEAR_MATCH_M: 250,
  /** Huge merged networks have hundreds of names; keep the list bounded. */
  MAX_NAMES_PER_TRAIL: 120,
} as const;

/** Names that say nothing about which trail it is. */
const GENERIC = new Set(["trail", "path", "connector", "singletrack", "bike trail", "unnamed"]);

export interface TrailsJsonEntry {
  id: string;
  system: string;
  county: string;
  points: Array<{ label: string; lat: number; lon: number }>;
}

export interface TrailNamesFile {
  generated_utc: string | null;
  source: string;
  names: Record<string, string[]>;
}

/** Distinct, sorted, non-generic member names, without the system's own. */
export function cleanNames(raw: readonly string[], systemName: string): string[] {
  const own = normalizeName(systemName);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    const key = normalizeName(trimmed);
    if (!key || key === own || GENERIC.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out
    .sort((a, b) => a.localeCompare(b))
    .slice(0, NAMES_CONFIG.MAX_NAMES_PER_TRAIL);
}

function nearestMeters(system: System, p: LatLon): number {
  let best = Number.POSITIVE_INFINITY;
  for (const q of system.points) best = Math.min(best, haversineMeters(p, q));
  return best;
}

/** The clustered system behind a trails.json entry: same name in the same
 *  county (closest to the trailhead when names repeat), else any system in
 *  the county with a point within NEAR_MATCH_M of the trailhead. */
export function matchSystem(entry: TrailsJsonEntry, systems: readonly System[]): System | null {
  const head = entry.points.find((p) => p.label === "Trailhead") ?? entry.points[0];
  if (!head) return null;
  const byDistance = (list: readonly System[]) =>
    list
      .map((s) => ({ s, d: nearestMeters(s, head) }))
      .sort((a, b) => a.d - b.d)[0];
  const sameName = systems.filter((s) => normalizeName(s.name) === normalizeName(entry.system));
  const named = byDistance(sameName);
  if (named) return named.s;
  const near = byDistance(systems);
  return near && near.d <= NAMES_CONFIG.NEAR_MATCH_M ? near.s : null;
}

export function buildNamesFile(
  entries: readonly TrailsJsonEntry[],
  systemsByCounty: ReadonlyMap<string, readonly System[]>,
  generatedUtc: string,
): { file: TrailNamesFile; unmatched: TrailsJsonEntry[] } {
  const names: Record<string, string[]> = {};
  const unmatched: TrailsJsonEntry[] = [];
  for (const entry of entries) {
    const system = matchSystem(entry, systemsByCounty.get(entry.county) ?? []);
    if (!system) {
      unmatched.push(entry);
      continue;
    }
    const list = cleanNames(system.names, entry.system);
    if (list.length > 0) names[entry.id] = list;
  }
  return {
    file: {
      generated_utc: generatedUtc,
      source: "OpenStreetMap contributors (ODbL), via scripts/trail-names.ts",
      names,
    },
    unmatched,
  };
}

async function main(): Promise<void> {
  const trailsPath = new URL("../data/trails.json", import.meta.url);
  const entries = (JSON.parse(readFileSync(trailsPath, "utf8")) as { trails: TrailsJsonEntry[] })
    .trails;
  console.log(`Trail names — ${entries.length} trails in data/trails.json`);

  const systemsByCounty = new Map<County, System[]>();
  for (const county of COUNTIES) {
    console.log(`── ${county}: querying Overpass…`);
    const data = await fetchOverpass(buildCountyQuery(county));
    const systems = clusterSystems(data.elements).filter((s) => shouldKeepSystem(s));
    console.log(`   ${systems.length} systems`);
    systemsByCounty.set(county, systems);
    if (county !== COUNTIES[COUNTIES.length - 1]) await sleep(CONFIG.QUERY_DELAY_MS);
  }

  const { file, unmatched } = buildNamesFile(entries, systemsByCounty, new Date().toISOString());
  const outPath = new URL("../data/trail-names.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(file, null, 2) + "\n");
  const total = Object.values(file.names).reduce((n, list) => n + list.length, 0);
  console.log(
    `\nWrote ${total} names for ${Object.keys(file.names).length} trails to data/trail-names.json`,
  );
  if (unmatched.length > 0) {
    console.log(`\n${unmatched.length} trails had no matching system (no member names):`);
    for (const e of unmatched) console.log(`  - ${e.id} (${e.county})`);
  }
  console.log("\nData © OpenStreetMap contributors (ODbL).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
