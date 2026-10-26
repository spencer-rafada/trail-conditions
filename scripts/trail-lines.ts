/**
 * Trail lines for the map. Hand-run only — never on a schedule.
 *
 *   pnpm trail-lines
 *
 * The map draws one pin per trail system, and neither base map shows much
 * singletrack, so riders couldn't see the trails themselves. This re-runs
 * discovery's Overpass county queries and clustering (the same functions as
 * scripts/discover-trails.ts), matches each system to its data/trails.json
 * entry exactly as scripts/trail-names.ts does, and writes
 * data/trail-lines.json: trail id -> one encoded polyline per OSM way.
 *
 * Lines are simplified (points within TOLERANCE_M of the line dropped) and
 * Google-polyline encoded (precision 5) to keep the file small; the web app
 * decodes them in apps/web/src/polyline.ts. Reads data/trails.json, never
 * writes it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  COUNTIES,
  CONFIG,
  buildCountyQuery,
  clusterSystems,
  fetchOverpass,
  shouldKeepSystem,
  sleep,
  type County,
  type LatLon,
  type OverpassElement,
  type System,
} from "./discover-trails";
import { matchSystem, type TrailsJsonEntry } from "./trail-names";

/** Points closer than this to the simplified line are dropped. */
export const TOLERANCE_M = 8;

const M_PER_DEG_LAT = 111_320;

/** Perpendicular distance (m) from p to segment a–b, on a local flat plane. */
function segmentDistanceM(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * kx;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (p.lon - a.lon) * kx;
  const py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Douglas–Peucker; always keeps the first and last point. */
export function simplifyLine(points: readonly LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let worst = -1;
    let worstD = 0;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistanceM(points[i]!, points[start]!, points[end]!);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst !== -1 && worstD > toleranceM) {
      keep[worst] = true;
      stack.push([start, worst], [worst, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Google's polyline algorithm, precision 5 (~1 m). */
export function encodePolyline(points: readonly LatLon[]): string {
  let out = "";
  let prevLat = 0;
  let prevLon = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    encode(lat - prevLat);
    encode(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

/** Each OSM way's own line, from standalone ways and relation members. */
export function geometryByWay(elements: readonly OverpassElement[]): Map<number, LatLon[]> {
  const out = new Map<number, LatLon[]>();
  const isLatLon = (p: unknown): p is LatLon =>
    typeof p === "object" && p !== null && "lat" in p && "lon" in p;
  for (const el of elements) {
    if (el.type === "way" && el.geometry && !out.has(el.id)) {
      out.set(el.id, el.geometry.filter(isLatLon));
    }
    if (el.type === "relation") {
      for (const m of el.members ?? []) {
        if (m.type === "way" && m.geometry && !out.has(m.ref)) {
          out.set(m.ref, m.geometry.filter(isLatLon));
        }
      }
    }
  }
  return out;
}

/** One encoded, simplified line per way of a system that has geometry. */
export function linesForSystem(
  wayIds: readonly number[],
  geometry: ReadonlyMap<number, LatLon[]>,
  toleranceM: number,
): string[] {
  const lines: string[] = [];
  for (const id of wayIds) {
    const points = geometry.get(id);
    if (!points || points.length < 2) continue;
    lines.push(encodePolyline(simplifyLine(points, toleranceM)));
  }
  return lines;
}

export interface TrailLinesFile {
  generated_utc: string | null;
  source: string;
  tolerance_m: number;
  /** trail id -> encoded polylines (Google format, precision 5). */
  lines: Record<string, string[]>;
}

async function main(): Promise<void> {
  const trailsPath = new URL("../data/trails.json", import.meta.url);
  const entries = (JSON.parse(readFileSync(trailsPath, "utf8")) as { trails: TrailsJsonEntry[] })
    .trails;
  console.log(`Trail lines — ${entries.length} trails in data/trails.json`);

  const lines: Record<string, string[]> = {};
  const unmatched: string[] = [];
  for (const county of COUNTIES as readonly County[]) {
    console.log(`── ${county}: querying Overpass…`);
    const data = await fetchOverpass(buildCountyQuery(county));
    const systems: System[] = clusterSystems(data.elements).filter((s) => shouldKeepSystem(s));
    const geometry = geometryByWay(data.elements);
    for (const entry of entries.filter((e) => e.county === county)) {
      const system = matchSystem(entry, systems);
      if (!system) {
        unmatched.push(entry.id);
        continue;
      }
      const encoded = linesForSystem(system.wayIds, geometry, TOLERANCE_M);
      if (encoded.length > 0) lines[entry.id] = encoded;
    }
    console.log(`   ${systems.length} systems, ${geometry.size} ways with geometry`);
    if (county !== COUNTIES[COUNTIES.length - 1]) await sleep(CONFIG.QUERY_DELAY_MS);
  }

  const file: TrailLinesFile = {
    generated_utc: new Date().toISOString(),
    source: "OpenStreetMap contributors (ODbL), via scripts/trail-lines.ts",
    tolerance_m: TOLERANCE_M,
    lines,
  };
  const out = JSON.stringify(file);
  writeFileSync(new URL("../data/trail-lines.json", import.meta.url), out + "\n");
  const total = Object.values(lines).reduce((n, l) => n + l.length, 0);
  console.log(
    `\nWrote ${total} lines for ${Object.keys(lines).length} trails to data/trail-lines.json (${Math.round(out.length / 1024)} KB)`,
  );
  if (unmatched.length > 0) {
    console.log(`${unmatched.length} trails had no matching system (pin only): ${unmatched.join(", ")}`);
  }
  console.log("Data © OpenStreetMap contributors (ODbL).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
