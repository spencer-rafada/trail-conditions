/**
 * Trail discovery (spec §2.2). Hand-run only — never on a schedule.
 *
 *   pnpm discover-trails
 *
 * Queries the Overpass API once per county (Salt Lake, Utah, Wasatch — Utah state) for
 * MTB trails plus named park/reserve polygons and place nodes (used only to split and
 * name clusters), clusters the trails into systems, looks up elevations for sample points
 * via Open-Meteo's elevation API (refetching from Open Topo Data's USGS NED 10 m
 * dataset when an Open-Meteo rate limit persists), and writes
 * data/trail-candidates.csv for human review.
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
  // Escalating waits on HTTP 429 before retrying a batch: Open-Meteo also has
  // hourly/daily caps a one-minute wait cannot clear (observed 2026-10-23). When
  // the ladder is exhausted, the script refetches everything from Open Topo Data.
  ELEVATION_RATE_LIMIT_WAITS_MS: [65_000, 300_000],
  OTD_URL: "https://api.opentopodata.org/v1/ned10m", // fallback: USGS NED 10 m via Open Topo Data
  OTD_DELAY_MS: 1_100, // Open Topo Data allows 1 call per second
  MIN_UNNAMED_CLUSTER_WAYS: 3, // all-unnamed clusters smaller than this are dropped as noise
  MAX_OSM_REFS_PER_ROW: 12, // keep the osm_refs CSV cell readable
  // Named areas (leisure=park|nature_reserve, boundary=protected_area) split and
  // name clusters; they are never systems themselves. The span cap keeps
  // county-spanning areas (Uinta-Wasatch-Cache NF, BLM districts) from swallowing
  // whole canyons; state/regional parks stay under it.
  AREA_MAX_SPAN_M: 30_000, // bbox diagonal above this: the area is ignored
  AREA_MIN_WAYS: 3, // fewer ways inside an area stay with distance clustering
  // A loose cluster this big where no single way name covers even this share of
  // ways is a merged network, not one trail; it is named after the nearest
  // place node instead of an arbitrary member way.
  NETWORK_MIN_WAYS: 30,
  NETWORK_MAX_TOP_NAME_SHARE: 0.1,
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
  {
    county: "Utah County",
    label: "Traverse Mountain (Lehi)",
    // "suncrest": OSM carries no element named "Traverse Mountain"/"Traverse
    // Ridge" (2026-10-24 Overpass probe — only roads and POIs); the network's
    // derived name comes from the Suncrest place node on Traverse Ridge.
    keys: ["traverse mountain", "traverse ridge", "suncrest"],
  },
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
  | { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: "way"; id: number; tags?: Record<string, string>; geometry?: LatLon[] }
  | {
      type: "relation";
      id: number;
      tags?: Record<string, string>;
      members?: Array<{ type: string; ref: number; role?: string; geometry?: LatLon[] }>;
    };

/** Where a system's display name came from: a trail element name in OSM, the
 *  named area (park/reserve) containing the ways, or a nearby place node
 *  (derived — OSM has no trail-element name for the cluster). */
export type NameSource = "osm" | "area" | "place";

export type System = {
  name: string;
  source: "relation" | "area" | "cluster";
  nameSource: NameSource;
  relationIds: number[];
  wayIds: number[];
  names: string[]; // distinct raw relation/way names seen in the system
  points: LatLon[];
  hasMtbTag: boolean; // any way carries mtb:scale or mtb:scale:imba
};

/** A named park/reserve/protected-area polygon used to split and name clusters. */
export type NamedArea = {
  name: string;
  rings: LatLon[][]; // closed outer rings
  bboxDeg2: number; // bbox area in square degrees — nesting tie-break (smaller wins)
  spanM: number; // bbox diagonal in meters
};

export type Place = { name: string; lat: number; lon: number };

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
  name_source: NameSource;
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

/** True for named park / nature-reserve / protected-area elements — fetched for
 *  splitting and naming only, never turned into trail systems. */
export function isNamedAreaTags(tags: Record<string, string> | undefined): boolean {
  if (!tags || !tags["name"]) return false;
  const leisure = tags["leisure"];
  return leisure === "park" || leisure === "nature_reserve" || tags["boundary"] === "protected_area";
}

/**
 * Assembles closed rings from way segments (a multipolygon's outer boundary
 * arrives as unordered, possibly reversed member ways sharing end nodes).
 * Segments that never close a ring are dropped.
 */
export function stitchRings(segments: LatLon[][]): LatLon[][] {
  const key = (p: LatLon) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const pool = segments.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings: LatLon[][] = [];
  while (pool.length > 0) {
    let ring = pool.shift() as LatLon[];
    let grew = true;
    while (grew && key(ring[0] as LatLon) !== key(ring[ring.length - 1] as LatLon)) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i] as LatLon[];
        const ringEnd = key(ring[ring.length - 1] as LatLon);
        if (key(seg[0] as LatLon) === ringEnd) {
          ring = ring.concat(seg.slice(1));
        } else if (key(seg[seg.length - 1] as LatLon) === ringEnd) {
          ring = ring.concat([...seg].reverse().slice(1));
        } else {
          continue;
        }
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0] as LatLon) === key(ring[ring.length - 1] as LatLon)) {
      rings.push(ring);
    }
  }
  return rings;
}

/** Ray-cast point-in-polygon on one closed ring (lat/lon treated as planar —
 *  fine at park scale). Inner (hole) rings are ignored by the callers. */
export function pointInRing(p: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as LatLon;
    const b = ring[j] as LatLon;
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Builds usable named areas: outer rings stitched, span-capped at `maxSpanM`. */
export function buildNamedAreas(
  elements: OverpassElement[],
  maxSpanM: number = CONFIG.AREA_MAX_SPAN_M,
): NamedArea[] {
  const areas: NamedArea[] = [];
  for (const el of elements) {
    if (el.type === "node" || !isNamedAreaTags(el.tags)) continue;
    const segments: LatLon[][] =
      el.type === "way"
        ? [(el.geometry ?? []).filter(isLatLon)]
        : (el.members ?? [])
            .filter((m) => m.type === "way" && (m.role === "outer" || !m.role) && m.geometry)
            .map((m) => (m.geometry ?? []).filter(isLatLon));
    const rings = stitchRings(segments);
    if (rings.length === 0) continue;
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (const ring of rings) {
      for (const p of ring) {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
      }
    }
    const spanM = haversineMeters({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon });
    if (spanM > maxSpanM) continue;
    areas.push({
      name: el.tags?.["name"] as string,
      rings,
      bboxDeg2: (maxLat - minLat) * (maxLon - minLon),
      spanM,
    });
  }
  return areas;
}

/** Place nodes (city/town/suburb/locality…) used to derive cluster names. */
export function collectPlaces(elements: OverpassElement[]): Place[] {
  const places: Place[] = [];
  for (const el of elements) {
    if (el.type !== "node") continue;
    const name = el.tags?.["name"];
    if (!name || !el.tags?.["place"]) continue;
    places.push({ name, lat: el.lat, lon: el.lon });
  }
  return places;
}

/** The smallest (by bbox) named area containing the point, if any. */
function smallestContainingArea(areas: NamedArea[], p: LatLon): NamedArea | undefined {
  let best: NamedArea | undefined;
  for (const area of areas) {
    if (!area.rings.some((ring) => pointInRing(p, ring))) continue;
    if (!best || area.bboxDeg2 < best.bboxDeg2) best = area;
  }
  return best;
}

function nearestPlace(places: Place[], p: LatLon): Place | undefined {
  let best: Place | undefined;
  let bestDist = Infinity;
  for (const place of places) {
    const d = haversineMeters(p, place);
    if (d < bestDist || (d === bestDist && best && place.name.localeCompare(best.name) < 0)) {
      best = place;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Groups Overpass elements into trail systems:
 * 1. named `route=mtb` relations become systems (same normalized name → one system);
 * 2. ways that are members of those relations belong to them, not to loose clusters;
 * 3. remaining ways whose midpoint lies inside a named area (park/reserve, span-capped)
 *    group per area — at least AREA_MIN_WAYS or they return to distance clustering;
 * 4. the rest are distance-clustered (union when endpoints are within `clusterRadiusM`);
 *    a cluster is named by its most common way name, except that a merged network
 *    (≥ NETWORK_MIN_WAYS, top name share < NETWORK_MAX_TOP_NAME_SHARE) and an
 *    all-unnamed cluster take a name derived from the nearest place node.
 * Named-area polygons and place nodes never become systems themselves.
 */
export function clusterSystems(
  elements: OverpassElement[],
  clusterRadiusM: number = CONFIG.CLUSTER_RADIUS_M,
): System[] {
  const areas = buildNamedAreas(elements);
  const places = collectPlaces(elements);
  const systemsByKey = new Map<string, System>();
  const memberOwners = new Map<number, System[]>();

  for (const el of elements) {
    if (el.type !== "relation") continue;
    if (el.tags?.["boundary"] === "administrative") continue; // the county boundary itself
    if (isNamedAreaTags(el.tags)) continue; // park/reserve polygons are not trail systems
    const rawName = el.tags?.["name"];
    const name = rawName ?? `relation/${el.id}`;
    const key = normalizeName(name);
    let sys = systemsByKey.get(key);
    if (!sys) {
      sys = {
        name,
        source: "relation",
        nameSource: "osm",
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
  const allLoose: LooseWay[] = [];

  for (const el of elements) {
    if (el.type !== "way") continue;
    if (isNamedAreaTags(el.tags)) continue; // park/reserve polygons are not trail ways
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
    allLoose.push({ id: el.id, name: el.tags?.["name"], mtb: hasMtbTag(el.tags), points, ends: [first, last] });
  }

  // Named-area grouping: a loose way belongs to the smallest area containing
  // its midpoint. Same-named areas (e.g. a park mapped twice) merge.
  const areaGroups = new Map<string, { name: string; members: LooseWay[] }>();
  const loose: LooseWay[] = [];
  for (const way of allLoose) {
    const area = smallestContainingArea(areas, way.points[Math.floor(way.points.length / 2)] as LatLon);
    if (!area) {
      loose.push(way);
      continue;
    }
    const key = normalizeName(area.name);
    const group = areaGroups.get(key) ?? { name: area.name, members: [] };
    group.members.push(way);
    areaGroups.set(key, group);
  }
  const systems = [...systemsByKey.values()];
  for (const { name, members } of areaGroups.values()) {
    if (members.length < CONFIG.AREA_MIN_WAYS) {
      loose.push(...members); // too thin to stand alone — back to distance clustering
      continue;
    }
    const names: string[] = [];
    for (const w of members) if (w.name && !names.includes(w.name)) names.push(w.name);
    systems.push({
      name,
      source: "area",
      nameSource: "area",
      relationIds: [],
      wayIds: members.map((w) => w.id),
      names,
      points: members.flatMap((w) => w.points),
      hasMtbTag: members.some((w) => w.mtb),
    });
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

  for (const members of clusters.values()) {
    const nameCounts = new Map<string, number>();
    for (const w of members) {
      if (w.name) nameCounts.set(w.name, (nameCounts.get(w.name) ?? 0) + 1);
    }
    const points = members.flatMap((w) => w.points);
    let name: string;
    let nameSource: NameSource = "osm";
    if (nameCounts.size > 0) {
      const [topName, topCount] = [...nameCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0] as [string, number];
      const isMergedNetwork =
        members.length >= CONFIG.NETWORK_MIN_WAYS &&
        topCount / members.length < CONFIG.NETWORK_MAX_TOP_NAME_SHARE;
      const place = isMergedNetwork ? nearestPlace(places, centroid(points)) : undefined;
      if (place) {
        name = `${place.name} trail network`;
        nameSource = "place";
      } else {
        name = topName;
      }
    } else {
      const c = centroid(points);
      const place = nearestPlace(places, c);
      name = place ? `${place.name} trails` : `Trails near ${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
      nameSource = "place";
    }
    systems.push({
      name,
      source: "cluster",
      nameSource,
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
  if (system.source === "relation" || system.source === "area") return true;
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
  "system,county,trailhead_lat,trailhead_lon,trailhead_elev_m,top_lat,top_lon,top_elev_m,n_ways,n_relations,osm_refs,notes,name_source";

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
        r.name_source,
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
  way["leisure"~"^(park|nature_reserve)$"]["name"](area.county);
  relation["leisure"~"^(park|nature_reserve)$"]["name"](area.county);
  way["boundary"="protected_area"]["name"](area.county);
  relation["boundary"="protected_area"]["name"](area.county);
  node["place"]["name"](area.county);
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
  const attempts = CONFIG.ELEVATION_RATE_LIMIT_WAITS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": CONFIG.USER_AGENT } });
    if (res.status === 429 && attempt < attempts - 1) {
      const wait = CONFIG.ELEVATION_RATE_LIMIT_WAITS_MS[attempt] as number;
      console.warn(`Open-Meteo HTTP 429; waiting ${Math.round(wait / 1000)} s for the rate-limit window…`);
      await sleep(wait);
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

/** Fallback elevation source: Open Topo Data serving the USGS NED 10 m dataset. */
async function fetchElevationBatchOtd(batch: LatLon[]): Promise<number[]> {
  const locations = batch.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join("|");
  const attempts = CONFIG.RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(CONFIG.OTD_URL, {
      method: "POST",
      headers: { "User-Agent": CONFIG.USER_AGENT, "Content-Type": "application/json" },
      body: JSON.stringify({ locations }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < attempts - 1) {
      console.warn(`Open Topo Data HTTP ${res.status}; backing off…`);
      await sleep(CONFIG.RETRY_DELAYS_MS[attempt] as number);
      continue;
    }
    if (!res.ok) throw new Error(`Open Topo Data HTTP ${res.status}`);
    const data = (await res.json()) as {
      status: string;
      results?: Array<{ elevation: number | null; location: { lat: number; lng: number } }>;
    };
    if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length !== batch.length) {
      throw new Error(
        `Open Topo Data returned status=${data.status} with ${data.results?.length} results for ${batch.length} points`,
      );
    }
    return data.results.map((r) => {
      if (r.elevation === null) {
        throw new Error(`Open Topo Data has no elevation for ${r.location.lat},${r.location.lng}`);
      }
      return r.elevation;
    });
  }
  throw new Error("unreachable");
}

export type ElevationProvider = "Open-Meteo" | "Open Topo Data (USGS NED 10 m)";

async function fetchElevations(
  points: LatLon[],
): Promise<{ elevations: number[]; provider: ElevationProvider }> {
  // Query each distinct coordinate once (relation members share way endpoints);
  // Open-Meteo counts every location in a batch against its rate limits.
  const keyOf = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const indexByKey = new Map<string, number>();
  const unique: LatLon[] = [];
  for (const p of points) {
    const key = keyOf(p);
    if (!indexByKey.has(key)) {
      indexByKey.set(key, unique.length);
      unique.push(p);
    }
  }
  if (unique.length < points.length) {
    console.log(`   (${points.length} points → ${unique.length} distinct coordinates)`);
  }
  const batches = chunk(unique, CONFIG.ELEVATION_BATCH_SIZE);
  let provider: ElevationProvider = "Open-Meteo";
  let uniqueElevations: number[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] as LatLon[];
    if (provider === "Open-Meteo") {
      try {
        uniqueElevations.push(...(await fetchElevationBatch(batch)));
      } catch (err) {
        if (!String(err).includes("HTTP 429")) throw err;
        // The wait ladder could not clear the rate limit (hourly/daily cap).
        // Switch provider and refetch from the start so one DEM serves every row.
        console.warn(
          "Open-Meteo rate limit persisted; refetching all batches from Open Topo Data (USGS NED 10 m)…",
        );
        provider = "Open Topo Data (USGS NED 10 m)";
        uniqueElevations = [];
        i = -1;
        continue;
      }
    } else {
      uniqueElevations.push(...(await fetchElevationBatchOtd(batch)));
    }
    if ((i + 1) % 10 === 0) console.log(`   …${i + 1}/${batches.length} elevation batches`);
    if (i < batches.length - 1) {
      await sleep(provider === "Open-Meteo" ? CONFIG.ELEVATION_DELAY_MS : CONFIG.OTD_DELAY_MS);
    }
  }
  return {
    elevations: points.map((p) => uniqueElevations[indexByKey.get(keyOf(p)) as number] as number),
    provider,
  };
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
  const { elevations, provider } = await fetchElevations(flat);

  const rows: CandidateRow[] = [];
  let cursor = 0;
  for (const { county, system, points } of samples) {
    const withElev = points.map((p, i) => ({ ...p, elev: elevations[cursor + i] as number }));
    cursor += points.length;
    const { trailhead, top } = pickExtremes(withElev);
    const sourceNote =
      system.source === "relation"
        ? "from mtb route relation(s)"
        : system.source === "area"
          ? "ways grouped by the named park/reserve containing them"
          : "distance cluster of loose ways";
    const notes = [
      sourceNote,
      system.nameSource === "place" ? "name derived from the nearest place node" : "",
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
      name_source: system.nameSource,
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
    `\nData © OpenStreetMap contributors (ODbL); elevations from ${provider}. Review the CSV before promoting anything to data/trails.json.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
