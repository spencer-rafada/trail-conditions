/**
 * Trail discovery (spec §2.2). Hand-run only — never on a schedule.
 *
 *   pnpm discover-trails
 *
 * Queries the Overpass API once per county (Salt Lake, Utah, Wasatch — Utah state) for
 * MTB trails, clusters them into trail systems, looks up elevations for sample points
 * via Open-Meteo's elevation API, and writes data/trail-candidates.csv for human review.
 * It never writes data/trails.json — that file is the human-reviewed list.
 *
 * Pure helpers are exported for tests (scripts/discover-trails.test.ts, which run on
 * fixtures/overpass-sample.json, never on live APIs). main() only runs when the file is
 * executed directly.
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Tunables (one block, LEVEL_THRESHOLDS-style)
// ---------------------------------------------------------------------------

export const CONFIG = {
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",
  ELEVATION_URL: "https://api.open-meteo.com/v1/elevation",
  USER_AGENT: "trail-conditions-mtb-discovery/0.1 (one-time hand-run script; Wasatch Front trail list)",
  OVERPASS_TIMEOUT_S: 300, // [timeout:] in the query
  QUERY_DELAY_MS: 4000, // pause between county queries (3–5 s per Overpass etiquette)
  RETRY_DELAYS_MS: [15_000, 45_000], // polite backoff on 429/504; then give up
  CLUSTER_RADIUS_M: 800, // loose ways join a cluster when endpoints are this close
  MAX_SAMPLE_POINTS_PER_SYSTEM: 30, // elevation candidates per system (min/max picked from these)
  ELEVATION_BATCH_SIZE: 100, // Open-Meteo elevation API max locations per call
  ELEVATION_DELAY_MS: 12_000, // Open-Meteo counts each location; 100 per 12 s stays under 600/min
  ELEVATION_RATE_LIMIT_WAIT_MS: 65_000, // wait on HTTP 429 before retrying a batch
  MIN_UNNAMED_CLUSTER_WAYS: 3, // all-unnamed clusters smaller than this are dropped as noise
  MAX_OSM_REFS_PER_ROW: 12, // keep the osm_refs CSV cell readable
} as const;

export const COUNTIES = ["Salt Lake County", "Utah County", "Wasatch County"] as const;
export type County = (typeof COUNTIES)[number];

/** Spec §2.3 seed list — verification only, never a coordinate source. */
export const SEED_SYSTEMS: ReadonlyArray<{ county: County; label: string; keys: string[] }> = [
  { county: "Salt Lake County", label: "Corner Canyon (Draper)", keys: ["corner canyon"] },
  { county: "Salt Lake County", label: "Bonneville Shoreline Trail sections", keys: ["bonneville shoreline"] },
  {
    county: "Salt Lake County",
    label: "Mill Creek Canyon (Pipeline, Big Water, Great Western)",
    keys: ["mill creek", "millcreek", "pipeline", "big water", "great western"],
  },
  { county: "Salt Lake County", label: "Wasatch Crest", keys: ["wasatch crest", "the crest"] },
  {
    county: "Salt Lake County",
    label: "Butterfield Canyon and Herriman trails (Yellow Fork, Rose Canyon)",
    keys: ["butterfield", "herriman", "yellow fork", "rose canyon"],
  },
  { county: "Salt Lake County", label: "Brighton / Solitude resort trails", keys: ["brighton", "solitude"] },
  { county: "Utah County", label: "Lambert Park (Alpine)", keys: ["lambert"] },
  { county: "Utah County", label: "Traverse Mountain (Lehi)", keys: ["traverse mountain", "traverse ridge"] },
  {
    county: "Utah County",
    label: "American Fork Canyon (Tibble Fork, Ridge trails)",
    keys: ["american fork", "tibble fork", "ridge trail"],
  },
  { county: "Utah County", label: "Eagle Mountain trails", keys: ["eagle mountain"] },
  { county: "Utah County", label: "Bonneville Shoreline (Orem / Provo)", keys: ["bonneville shoreline"] },
  { county: "Utah County", label: "Hobble Creek (Springville)", keys: ["hobble creek"] },
  {
    county: "Wasatch County",
    label: "Wasatch Mountain State Park (Midway)",
    keys: ["wasatch mountain", "wasatch over wasatch"],
  },
  { county: "Wasatch County", label: "Soldier Hollow", keys: ["soldier hollow"] },
  { county: "Wasatch County", label: "Jordanelle State Park", keys: ["jordanelle"] },
  { county: "Wasatch County", label: "Coyote Canyon (Heber)", keys: ["coyote canyon", "coyote"] },
  { county: "Wasatch County", label: "Deer Valley Mayflower area", keys: ["mayflower", "deer valley"] },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LatLon = { lat: number; lon: number };

export type OverpassElement =
  | { type: "way"; id: number; tags?: Record<string, string>; geometry?: LatLon[] }
  | {
      type: "relation";
      id: number;
      tags?: Record<string, string>;
      members?: Array<{ type: string; ref: number; role?: string; geometry?: LatLon[] }>;
    };

export type System = {
  name: string;
  source: "relation" | "cluster";
  relationIds: number[];
  wayIds: number[];
  names: string[]; // distinct raw relation/way names seen in the system
  points: LatLon[];
  hasMtbTag: boolean; // any way carries mtb:scale or mtb:scale:imba
};

export type CandidateRow = {
  system: string;
  county: string;
  trailhead_lat: number;
  trailhead_lon: number;
  trailhead_elev_m: number;
  top_lat: number;
  top_lon: number;
  top_elev_m: number;
  n_ways: number;
  n_relations: number;
  osm_refs: string;
  notes: string;
};

// ---------------------------------------------------------------------------
// Pure helpers (tested against fixtures/overpass-sample.json)
// ---------------------------------------------------------------------------

export function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLatLon(p: unknown): p is LatLon {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as LatLon).lat === "number" &&
    typeof (p as LatLon).lon === "number"
  );
}

function hasMtbTag(tags: Record<string, string> | undefined): boolean {
  return tags !== undefined && ("mtb:scale" in tags || "mtb:scale:imba" in tags);
}

function addName(system: System, name: string | undefined): void {
  if (name && !system.names.includes(name)) system.names.push(name);
}

function centroid(points: LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  const n = Math.max(points.length, 1);
  return { lat: lat / n, lon: lon / n };
}

/**
 * Groups Overpass elements into trail systems:
 * 1. named `route=mtb` relations become systems (same normalized name → one system);
 * 2. ways that are members of those relations belong to them, not to loose clusters;
 * 3. remaining ways are distance-clustered (union when endpoints are within
 *    `clusterRadiusM`), and each cluster is named by its most common way name.
 */
export function clusterSystems(
  elements: OverpassElement[],
  clusterRadiusM: number = CONFIG.CLUSTER_RADIUS_M,
): System[] {
  const systemsByKey = new Map<string, System>();
  const memberOwners = new Map<number, System[]>();

  for (const el of elements) {
    if (el.type !== "relation") continue;
    if (el.tags?.["boundary"] === "administrative") continue; // the county boundary itself
    const rawName = el.tags?.["name"];
    const name = rawName ?? `relation/${el.id}`;
    const key = normalizeName(name);
    let sys = systemsByKey.get(key);
    if (!sys) {
      sys = {
        name,
        source: "relation",
        relationIds: [],
        wayIds: [],
        names: [],
        points: [],
        hasMtbTag: false,
      };
      systemsByKey.set(key, sys);
    }
    sys.relationIds.push(el.id);
    addName(sys, rawName);
    for (const m of el.members ?? []) {
      if (m.type === "way") {
        if (!sys.wayIds.includes(m.ref)) sys.wayIds.push(m.ref);
        const owners: System[] = memberOwners.get(m.ref) ?? [];
        if (!owners.includes(sys)) owners.push(sys);
        memberOwners.set(m.ref, owners);
      }
      if (m.geometry) sys.points.push(...m.geometry.filter(isLatLon));
    }
  }

  type LooseWay = { id: number; name?: string; mtb: boolean; points: LatLon[]; ends: LatLon[] };
  const loose: LooseWay[] = [];

  for (const el of elements) {
    if (el.type !== "way") continue;
    const owners = memberOwners.get(el.id);
    if (owners) {
      // a relation member seen standalone: contribute its name/tags to its system(s)
      for (const sys of owners) {
        addName(sys, el.tags?.["name"]);
        if (hasMtbTag(el.tags)) sys.hasMtbTag = true;
      }
      continue;
    }
    const points = (el.geometry ?? []).filter(isLatLon);
    if (points.length === 0) continue;
    const first = points[0] as LatLon;
    const last = points[points.length - 1] as LatLon;
    loose.push({ id: el.id, name: el.tags?.["name"], mtb: hasMtbTag(el.tags), points, ends: [first, last] });
  }

  // Union-find over loose ways by endpoint proximity.
  const parent = loose.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const latBound = (clusterRadiusM / 111_000) * 1.2;
  for (let i = 0; i < loose.length; i++) {
    const a = loose[i] as LooseWay;
    for (let j = i + 1; j < loose.length; j++) {
      const b = loose[j] as LooseWay;
      let close = false;
      for (const pa of a.ends) {
        for (const pb of b.ends) {
          if (Math.abs(pa.lat - pb.lat) > latBound) continue; // cheap prefilter
          if (haversineMeters(pa, pb) <= clusterRadiusM) {
            close = true;
            break;
          }
        }
        if (close) break;
      }
      if (close) union(i, j);
    }
  }

  const clusters = new Map<number, LooseWay[]>();
  for (let i = 0; i < loose.length; i++) {
    const root = find(i);
    const members = clusters.get(root) ?? [];
    members.push(loose[i] as LooseWay);
    clusters.set(root, members);
  }

  const systems = [...systemsByKey.values()];
  for (const members of clusters.values()) {
    const nameCounts = new Map<string, number>();
    for (const w of members) {
      if (w.name) nameCounts.set(w.name, (nameCounts.get(w.name) ?? 0) + 1);
    }
    const points = members.flatMap((w) => w.points);
    let name: string;
    if (nameCounts.size > 0) {
      name = [...nameCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]![0];
    } else {
      const c = centroid(points);
      name = `Unnamed cluster @ ${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
    }
    systems.push({
      name,
      source: "cluster",
      relationIds: [],
      wayIds: members.map((w) => w.id),
      names: [...nameCounts.keys()],
      points,
      hasMtbTag: members.some((w) => w.mtb),
    });
  }

  return systems;
}

/** Noise filter for the CSV: drop small clusters where no way has a name or an mtb tag. */
export function shouldKeepSystem(
  system: System,
  minUnnamedClusterWays: number = CONFIG.MIN_UNNAMED_CLUSTER_WAYS,
): boolean {
  if (system.source === "relation") return true;
  if (system.names.length > 0) return true;
  if (system.hasMtbTag) return true;
  return system.wayIds.length >= minUnnamedClusterWays;
}

/** Evenly thins a point list to at most `max` points, always keeping the first and last. */
export function decimatePoints(points: LatLon[], max: number): LatLon[] {
  if (points.length <= max) return [...points];
  const out: LatLon[] = [];
  const step = (points.length - 1) / (max - 1);
  let lastIndex = -1;
  for (let i = 0; i < max; i++) {
    const index = Math.round(i * step);
    if (index === lastIndex) continue;
    out.push(points[index] as LatLon);
    lastIndex = index;
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Trailhead = lowest sampled point (spec §2.2's own definition), top = highest. */
export function pickExtremes<T extends LatLon & { elev: number }>(points: T[]): {
  trailhead: T;
  top: T;
} {
  const first = points[0];
  if (!first) throw new Error("pickExtremes: no points");
  let trailhead = first;
  let top = first;
  for (const p of points) {
    if (p.elev < trailhead.elev) trailhead = p;
    if (p.elev > top.elev) top = p;
  }
  return { trailhead, top };
}

export const CSV_HEADER =
  "system,county,trailhead_lat,trailhead_lon,trailhead_elev_m,top_lat,top_lon,top_elev_m,n_ways,n_relations,osm_refs,notes";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function toCsv(rows: CandidateRow[]): string {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.system),
        csvEscape(r.county),
        r.trailhead_lat.toFixed(5),
        r.trailhead_lon.toFixed(5),
        String(Math.round(r.trailhead_elev_m)),
        r.top_lat.toFixed(5),
        r.top_lon.toFixed(5),
        String(Math.round(r.top_elev_m)),
        String(r.n_ways),
        String(r.n_relations),
        csvEscape(r.osm_refs),
        csvEscape(r.notes),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Checks the county's spec §2.3 seeds against discovered system/way names. */
export function matchSeeds(
  county: string,
  systems: System[],
): { matched: Array<{ label: string; system: string }>; missed: string[] } {
  const matched: Array<{ label: string; system: string }> = [];
  const missed: string[] = [];
  for (const seed of SEED_SYSTEMS.filter((s) => s.county === county)) {
    let hit: string | undefined;
    outer: for (const sys of systems) {
      for (const rawName of [sys.name, ...sys.names]) {
        const name = normalizeName(rawName);
        for (const key of seed.keys) {
          const nk = normalizeName(key);
          if (name.includes(nk) || (name.length >= 4 && nk.includes(name))) {
            hit = sys.name;
            break outer;
          }
        }
      }
    }
    if (hit) matched.push({ label: seed.label, system: hit });
    else missed.push(seed.label);
  }
  return { matched, missed };
}

/**
 * Decimates each kept system's points into elevation samples. A kept system
 * with zero geometry points cannot be sampled; it is returned in `skipped` so
 * main() can warn with its name instead of dropping it silently.
 */
export function collectSamples(
  perCounty: Array<{ county: County; systems: System[] }>,
  maxPointsPerSystem: number = CONFIG.MAX_SAMPLE_POINTS_PER_SYSTEM,
): {
  samples: Array<{ county: County; system: System; points: LatLon[] }>;
  skipped: Array<{ county: County; system: System }>;
} {
  const samples: Array<{ county: County; system: System; points: LatLon[] }> = [];
  const skipped: Array<{ county: County; system: System }> = [];
  for (const { county, systems } of perCounty) {
    for (const system of systems) {
      const points = decimatePoints(system.points, maxPointsPerSystem);
      if (points.length > 0) samples.push({ county, system, points });
      else skipped.push({ county, system });
    }
  }
  return { samples, skipped };
}

export function buildCountyQuery(county: County): string {
  return `[out:json][timeout:${CONFIG.OVERPASS_TIMEOUT_S}];
area["boundary"="administrative"]["admin_level"="6"]["name"="${county}"]->.county;
rel(pivot.county);
out tags;
(
  relation["route"="mtb"](area.county);
  way["highway"~"^(path|track)$"]["mtb:scale"](area.county);
  way["highway"~"^(path|track)$"]["mtb:scale:imba"](area.county);
  way["highway"~"^(path|track)$"]["bicycle"~"^(designated|yes)$"](area.county);
);
out geom;`;
}

// ---------------------------------------------------------------------------
// I/O (only runs when executed directly — never from tests)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOverpass(query: string): Promise<{ elements: OverpassElement[] }> {
  const attempts = CONFIG.RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(CONFIG.OVERPASS_URL, {
        method: "POST",
        headers: {
          "User-Agent": CONFIG.USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "data=" + encodeURIComponent(query),
      });
    } catch (err) {
      if (attempt === attempts - 1) throw err;
      console.warn(`Overpass request failed (${String(err)}); backing off…`);
      await sleep(CONFIG.RETRY_DELAYS_MS[attempt] as number);
      continue;
    }
    if (res.ok) return (await res.json()) as { elements: OverpassElement[] };
    const retryable = res.status === 429 || res.status === 502 || res.status === 504;
    if (!retryable || attempt === attempts - 1) {
      throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    console.warn(`Overpass HTTP ${res.status}; backing off…`);
    await sleep(CONFIG.RETRY_DELAYS_MS[attempt] as number);
  }
  throw new Error("unreachable");
}

async function fetchElevationBatch(batch: LatLon[]): Promise<number[]> {
  const url =
    `${CONFIG.ELEVATION_URL}?latitude=${batch.map((p) => p.lat.toFixed(5)).join(",")}` +
    `&longitude=${batch.map((p) => p.lon.toFixed(5)).join(",")}`;
  const attempts = CONFIG.RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": CONFIG.USER_AGENT } });
    if (res.status === 429 && attempt < attempts - 1) {
      console.warn("Open-Meteo HTTP 429; waiting out the rate-limit window…");
      await sleep(CONFIG.ELEVATION_RATE_LIMIT_WAIT_MS);
      continue;
    }
    if (!res.ok) throw new Error(`Open-Meteo elevation HTTP ${res.status}`);
    const data = (await res.json()) as { elevation: number[] };
    if (!Array.isArray(data.elevation) || data.elevation.length !== batch.length) {
      throw new Error(`Open-Meteo elevation returned ${data.elevation?.length} values for ${batch.length} points`);
    }
    return data.elevation;
  }
  throw new Error("unreachable");
}

async function fetchElevations(points: LatLon[]): Promise<number[]> {
  const out: number[] = [];
  const batches = chunk(points, CONFIG.ELEVATION_BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    out.push(...(await fetchElevationBatch(batches[i] as LatLon[])));
    if ((i + 1) % 10 === 0) console.log(`   …${i + 1}/${batches.length} elevation batches`);
    if (i < batches.length - 1) await sleep(CONFIG.ELEVATION_DELAY_MS);
  }
  return out;
}

function osmRefs(system: System): string {
  const refs = [
    ...system.relationIds.map((id) => `relation/${id}`),
    ...system.wayIds.map((id) => `way/${id}`),
  ];
  if (refs.length <= CONFIG.MAX_OSM_REFS_PER_ROW) return refs.join(";");
  const shown = refs.slice(0, CONFIG.MAX_OSM_REFS_PER_ROW);
  return `${shown.join(";")};+${refs.length - shown.length} more`;
}

async function main(): Promise<void> {
  console.log(`Trail discovery — ${new Date().toISOString()}`);
  console.log(`Counties: ${COUNTIES.join(", ")} (one Overpass query each, serialized)\n`);

  const perCounty: Array<{ county: County; systems: System[]; dropped: number }> = [];

  for (const county of COUNTIES) {
    console.log(`── ${county}: querying Overpass…`);
    const data = await fetchOverpass(buildCountyQuery(county));
    const boundary = data.elements.find(
      (el) => el.type === "relation" && el.tags?.["boundary"] === "administrative",
    );
    if (boundary?.tags) {
      const t = boundary.tags;
      console.log(
        `   boundary sanity check: relation/${boundary.id} name="${t["name"]}" admin_level=${t["admin_level"]} wikidata=${t["wikidata"] ?? "?"}`,
      );
    } else {
      console.warn(`   WARNING: no administrative boundary relation came back for ${county}`);
    }
    const nWays = data.elements.filter((el) => el.type === "way").length;
    const nRels = data.elements.filter((el) => el.type === "relation").length;
    console.log(`   elements: ${nWays} ways, ${nRels} relations`);

    const all = clusterSystems(data.elements);
    const systems = all.filter((s) => shouldKeepSystem(s));
    const dropped = all.length - systems.length;
    console.log(`   systems: ${systems.length} kept, ${dropped} tiny unnamed clusters dropped`);
    perCounty.push({ county, systems, dropped });

    if (county !== COUNTIES[COUNTIES.length - 1]) await sleep(CONFIG.QUERY_DELAY_MS);
  }

  // Elevation lookup for decimated sample points, batched across all systems.
  const { samples, skipped } = collectSamples(perCounty);
  for (const { county, system } of skipped) {
    console.warn(
      `WARNING: kept system "${system.name}" (${county}) has zero geometry points — excluded from the CSV (${osmRefs(system)})`,
    );
  }
  const flat = samples.flatMap((s) => s.points);
  console.log(
    `\nFetching elevations for ${flat.length} sample points in batches of ${CONFIG.ELEVATION_BATCH_SIZE}…`,
  );
  const elevations = await fetchElevations(flat);

  const rows: CandidateRow[] = [];
  let cursor = 0;
  for (const { county, system, points } of samples) {
    const withElev = points.map((p, i) => ({ ...p, elev: elevations[cursor + i] as number }));
    cursor += points.length;
    const { trailhead, top } = pickExtremes(withElev);
    const notes = [
      system.source === "relation" ? "from mtb route relation(s)" : "distance cluster of loose ways",
      system.names.length > 1 ? `${system.names.length} distinct names` : "",
      `extremes from ${points.length} sampled points`,
    ]
      .filter(Boolean)
      .join("; ");
    rows.push({
      system: system.name,
      county,
      trailhead_lat: trailhead.lat,
      trailhead_lon: trailhead.lon,
      trailhead_elev_m: trailhead.elev,
      top_lat: top.lat,
      top_lon: top.lon,
      top_elev_m: top.elev,
      n_ways: system.wayIds.length,
      n_relations: system.relationIds.length,
      osm_refs: osmRefs(system),
      notes,
    });
  }

  const countyOrder = new Map(COUNTIES.map((c, i) => [c, i] as const));
  rows.sort(
    (a, b) =>
      (countyOrder.get(a.county as County) ?? 0) - (countyOrder.get(b.county as County) ?? 0) ||
      b.n_ways - a.n_ways ||
      a.system.localeCompare(b.system),
  );

  const outPath = new URL("../data/trail-candidates.csv", import.meta.url);
  writeFileSync(outPath, toCsv(rows));
  console.log(`\nWrote ${rows.length} candidate rows to data/trail-candidates.csv`);

  console.log("\nSeed check (spec §2.3):");
  for (const { county, systems } of perCounty) {
    const report = matchSeeds(county, systems);
    console.log(`\n  ${county} — matched ${report.matched.length}, missed ${report.missed.length}`);
    for (const m of report.matched) console.log(`    ✓ ${m.label} → ${m.system}`);
    for (const label of report.missed) console.log(`    ✗ MISSED: ${label}`);
  }
  console.log(
    "\nData © OpenStreetMap contributors (ODbL); elevations from Open-Meteo. Review the CSV before promoting anything to data/trails.json.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
