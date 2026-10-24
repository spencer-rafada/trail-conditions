import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  buildCountyQuery,
  chunk,
  clusterSystems,
  collectSamples,
  decimatePoints,
  matchSeeds,
  pickExtremes,
  shouldKeepSystem,
  stitchRings,
  toCsv,
  type OverpassElement,
  type System,
} from "./discover-trails";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/overpass-sample.json", import.meta.url), "utf8"),
) as { elements: OverpassElement[] };

// Distilled from the live Salt Lake County Overpass response (2026-10-24): the
// Corner Canyon Regional Park relation (17003123), the nested Corner Canyon
// nature-reserve way (1238191464), 12 connected trail ways from the real
// 167-way Draper mega-cluster (5 with midpoints in the park only, 3 in the
// nested reserve, 4 BST ways outside both), and one place node.
const draper = JSON.parse(
  readFileSync(new URL("../fixtures/overpass-draper-sample.json", import.meta.url), "utf8"),
) as { elements: OverpassElement[] };

// Distilled from the live Utah County Overpass response (2026-10-24): the
// Mountain Ranch Bike Park way (480216578), the Eagle Mountain place node, and
// 38 connected ways from the real 207-way Lake Mountain mega-cluster (4 inside
// the bike park, 34 outside with 34 distinct names).
const eagle = JSON.parse(
  readFileSync(new URL("../fixtures/overpass-eagle-sample.json", import.meta.url), "utf8"),
) as { elements: OverpassElement[] };

function findSystem(systems: System[], name: string): System {
  const sys = systems.find((s) => s.name === name);
  if (!sys) throw new Error(`no system named ${name} in ${systems.map((s) => s.name).join(" | ")}`);
  return sys;
}

describe("clusterSystems", () => {
  const systems = clusterSystems(fixture.elements);

  it("skips the county boundary relation and forms six systems", () => {
    expect(systems).toHaveLength(6);
  });

  it("collects member geometry from a relation whose ways arrive only as members (the `out geom` wire shape)", () => {
    // Relation 9002's member ways 201/202 are not standalone elements; their
    // geometry rides on the members, with a null entry (clipped node) and a
    // node member (lat/lon, no geometry array) mixed in, as `out geom` returns.
    const anns = findSystem(systems, "Ann's Trail");
    expect(anns.source).toBe("relation");
    expect([...anns.wayIds].sort()).toEqual([201, 202]);
    expect(anns.points).toEqual([
      { lat: 40.52, lon: -111.79 },
      { lat: 40.522, lon: -111.787 },
      { lat: 40.522, lon: -111.787 },
      { lat: 40.525, lon: -111.783 },
    ]);
    // member ways never leak into loose clusters
    expect(systems.filter((s) => s.wayIds.includes(201))).toHaveLength(1);
  });

  it("still forms a (point-less) system from a relation that came back without members", () => {
    const bst = findSystem(systems, "Bonneville Shoreline Trail");
    expect(bst.source).toBe("relation");
    expect(bst.points).toHaveLength(0);
  });

  it("turns a named mtb relation into one system and keeps member ways out of loose clusters", () => {
    const corner = findSystem(systems, "Corner Canyon Trails");
    expect(corner.source).toBe("relation");
    expect(corner.relationIds).toEqual([9001]);
    expect([...corner.wayIds].sort()).toEqual([101, 102]);
    expect(corner.points).toHaveLength(4);
    // way 101 is also a standalone element; its name joins the relation system
    expect(corner.names).toContain("Ghost Falls");
    // and it must not form its own cluster
    expect(systems.filter((s) => s.wayIds.includes(101))).toHaveLength(1);
  });

  it("joins loose ways that touch into one cluster named by the most common way name", () => {
    const rush = findSystem(systems, "Rush, Lower");
    expect([...rush.wayIds].sort()).toEqual([103, 104]);
    expect(rush.source).toBe("cluster");
    expect(rush.hasMtbTag).toBe(true);
  });

  it("keeps far-apart ways in separate clusters", () => {
    const pipeline = findSystem(systems, "Pipeline Trail");
    expect(pipeline.wayIds).toEqual([105]);
  });

  it("names an all-unnamed cluster after the nearest place node, marked place-derived", () => {
    const withPlace = [
      ...fixture.elements,
      { type: "node", id: 999100, lat: 40.638, lon: -111.91, tags: { place: "locality", name: "Testville" } },
    ] as OverpassElement[];
    const unnamed = clusterSystems(withPlace).find((s) => s.wayIds.includes(106));
    expect(unnamed?.name).toBe("Testville trails");
    expect(unnamed?.nameSource).toBe("place");
    expect(unnamed?.names).toEqual([]);
  });

  it("falls back to coordinates — never the old debug label — when no place node exists", () => {
    const unnamed = systems.find((s) => s.wayIds.includes(106));
    expect(unnamed).toBeDefined();
    expect(unnamed?.name.startsWith("Trails near ")).toBe(true);
    expect(unnamed?.name).not.toContain("Unnamed cluster");
  });
});

describe("named-area splitting (Draper / Corner Canyon fixture)", () => {
  const systems = clusterSystems(draper.elements);

  it("splits the Corner Canyon park ways out of the Draper chain as an area system", () => {
    const park = findSystem(systems, "Corner Canyon Regional Park");
    expect(park.source).toBe("area");
    expect(park.nameSource).toBe("area");
    expect([...park.wayIds].sort((a, b) => a - b)).toEqual([
      283437309, 284022151, 284022157, 284022161, 366961415,
    ]);
  });

  it("assigns ways inside the nested smaller reserve to it, not the enclosing park", () => {
    const reserve = findSystem(systems, "Corner Canyon");
    expect(reserve.source).toBe("area");
    expect([...reserve.wayIds].sort((a, b) => a - b)).toEqual([220689801, 283437300, 696249491]);
  });

  it("keeps the remaining BST ways outside Corner Canyon, named by most common way name", () => {
    const bst = systems.filter((s) => s.name === "Bonneville Shoreline Trail - Draper Section");
    expect(bst.length).toBeGreaterThan(0);
    expect(bst.flatMap((s) => s.wayIds).sort((a, b) => a - b)).toEqual([
      357084742, 512166855, 1062459230, 1062459231,
    ]);
    for (const s of bst) {
      expect(s.source).toBe("cluster");
      expect(s.nameSource).toBe("osm");
    }
  });

  it("never turns the area polygons or the place node into systems", () => {
    expect(systems.some((s) => s.relationIds.includes(17003123))).toBe(false);
    expect(systems.some((s) => s.wayIds.includes(1238191464))).toBe(false);
    const allWayIds = systems.flatMap((s) => s.wayIds);
    expect(allWayIds).toHaveLength(12); // exactly the 12 trail ways, each in one system
    expect(new Set(allWayIds).size).toBe(12);
  });
});

describe("network naming (Eagle Mountain / Lake Mountain fixture)", () => {
  const systems = clusterSystems(eagle.elements);

  it("splits the bike park into its own area system", () => {
    const bikePark = findSystem(systems, "Mountain Ranch Bike Park");
    expect(bikePark.source).toBe("area");
    expect(bikePark.nameSource).toBe("area");
    expect(bikePark.wayIds).toHaveLength(4);
  });

  it("names the merged many-name network after the nearest place, not an arbitrary member way", () => {
    const network = findSystem(systems, "Eagle Mountain trail network");
    expect(network.source).toBe("cluster");
    expect(network.nameSource).toBe("place");
    expect(network.wayIds).toHaveLength(34);
    // the old rule named this cluster after one arbitrary member
    expect(systems.some((s) => s.name === "Backspacer Trail")).toBe(false);
  });

  it("matchSeeds reports the Eagle Mountain seed matched via the derived name", () => {
    const report = matchSeeds("Utah County", systems);
    expect(report.matched.map((m) => m.label)).toContain("Eagle Mountain trails");
  });
});

describe("named-area guards", () => {
  const square = (name: string, id: number, d: number) => ({
    type: "way" as const,
    id,
    tags: { leisure: "park", name },
    geometry: [
      { lat: 40 - d, lon: -112 - d },
      { lat: 40 + d, lon: -112 - d },
      { lat: 40 + d, lon: -112 + d },
      { lat: 40 - d, lon: -112 + d },
      { lat: 40 - d, lon: -112 - d },
    ],
  });
  const ways = [0, 1, 2].map((i) => ({
    type: "way" as const,
    id: 8000 + i,
    geometry: [
      { lat: 40.001 + 0.001 * i, lon: -112.001 },
      { lat: 40.002 + 0.001 * i, lon: -112.002 },
    ],
  }));

  it("ignores areas wider than the span cap (national-forest scale)", () => {
    const systems = clusterSystems([square("Giant Forest", 7001, 1), ...ways] as OverpassElement[]);
    expect(systems.some((s) => s.name === "Giant Forest")).toBe(false);
    expect(systems).toHaveLength(1); // the ways stay one loose cluster
  });

  it("groups the same ways under an area within the span cap", () => {
    const systems = clusterSystems([square("Local Park", 7002, 0.01), ...ways] as OverpassElement[]);
    const park = findSystem(systems, "Local Park");
    expect(park.source).toBe("area");
    expect([...park.wayIds].sort((a, b) => a - b)).toEqual([8000, 8001, 8002]);
  });

  it("returns ways to distance clustering when fewer than AREA_MIN_WAYS fall inside", () => {
    const systems = clusterSystems(
      [square("Local Park", 7003, 0.01), ...ways.slice(0, 2)] as OverpassElement[],
    );
    expect(systems.some((s) => s.name === "Local Park")).toBe(false);
    expect(systems).toHaveLength(1);
  });
});

describe("stitchRings", () => {
  it("assembles one ring from unordered, partly reversed segments", () => {
    const a = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    ];
    const b = [
      { lat: 1, lon: 1 },
      { lat: 0, lon: 1 },
    ]; // reversed relative to the ring direction
    const c = [
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
      { lat: 0, lon: 0 },
    ];
    const rings = stitchRings([a, b, c]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5); // 4 corners + the closing repeat of the first
    expect(rings[0]?.[0]).toEqual(rings[0]?.[rings[0].length - 1]);
  });

  it("drops segments that never close a ring", () => {
    expect(
      stitchRings([
        [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
        ],
      ]),
    ).toHaveLength(0);
  });
});

describe("shouldKeepSystem", () => {
  const systems = clusterSystems(fixture.elements);

  it("keeps relation systems and named clusters, drops tiny unnamed clusters", () => {
    expect(shouldKeepSystem(findSystem(systems, "Corner Canyon Trails"))).toBe(true);
    expect(shouldKeepSystem(findSystem(systems, "Rush, Lower"))).toBe(true);
    expect(shouldKeepSystem(findSystem(systems, "Pipeline Trail"))).toBe(true);
    const unnamed = systems.find((s) => s.wayIds.includes(106));
    expect(unnamed && shouldKeepSystem(unnamed)).toBe(false);
  });
});

describe("decimatePoints", () => {
  it("caps the point count and keeps the first and last points", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ lat: 40 + i, lon: -111 }));
    const out = decimatePoints(points, 4);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[9]);
  });

  it("returns short lists unchanged", () => {
    const points = [
      { lat: 40, lon: -111 },
      { lat: 41, lon: -111 },
    ];
    expect(decimatePoints(points, 30)).toEqual(points);
  });
});

describe("pickExtremes", () => {
  it("picks the lowest point as trailhead and the highest as top", () => {
    const pts = [
      { lat: 40.1, lon: -111.1, elev: 2000 },
      { lat: 40.2, lon: -111.2, elev: 1500 },
      { lat: 40.3, lon: -111.3, elev: 2500 },
    ];
    const { trailhead, top } = pickExtremes(pts);
    expect(trailhead.elev).toBe(1500);
    expect(trailhead.lat).toBe(40.2);
    expect(top.elev).toBe(2500);
    expect(top.lat).toBe(40.3);
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
});

describe("toCsv", () => {
  const row = {
    system: 'Say "Rush", Lower',
    county: "Salt Lake County",
    trailhead_lat: 40.123456,
    trailhead_lon: -111.987654,
    trailhead_elev_m: 1500.6,
    top_lat: 40.2,
    top_lon: -111.3,
    top_elev_m: 2500.4,
    n_ways: 2,
    n_relations: 0,
    osm_refs: "way/103;way/104",
    notes: "distance cluster",
    name_source: "osm" as const,
  };

  it("writes the fixed header first", () => {
    const lines = toCsv([row]).trimEnd().split("\n");
    expect(lines[0]).toBe(CSV_HEADER);
    expect(CSV_HEADER).toBe(
      "system,county,trailhead_lat,trailhead_lon,trailhead_elev_m,top_lat,top_lon,top_elev_m,n_ways,n_relations,osm_refs,notes,name_source",
    );
  });

  it("escapes quotes and commas, rounds coordinates to 5 decimals and elevations to meters", () => {
    const lines = toCsv([row]).trimEnd().split("\n");
    expect(lines[1]).toBe(
      '"Say ""Rush"", Lower",Salt Lake County,40.12346,-111.98765,1501,40.20000,-111.30000,2500,2,0,way/103;way/104,distance cluster,osm',
    );
  });
});

describe("matchSeeds", () => {
  const systems = [
    { name: "Corner Canyon Trails", names: ["Corner Canyon Trails", "Ghost Falls"] },
    { name: "Pipeline Trail", names: ["Pipeline Trail"] },
  ] as System[];

  it("matches seeds by any system or member name, case-insensitively", () => {
    const report = matchSeeds("Salt Lake County", systems);
    const matchedLabels = report.matched.map((m) => m.label);
    expect(matchedLabels).toContain("Corner Canyon (Draper)");
    expect(matchedLabels).toContain("Mill Creek Canyon (Pipeline, Big Water, Great Western)");
  });

  it("reports the seeds nothing matched", () => {
    const report = matchSeeds("Salt Lake County", systems);
    expect(report.missed).toContain("Wasatch Crest");
    expect(report.matched.length + report.missed.length).toBe(6);
  });

  it("matches Traverse Mountain (Lehi) via the Suncrest-derived network name", () => {
    // OSM has no element named "Traverse Mountain"/"Traverse Ridge" (2026-10-24
    // probe); the derived name comes from the Suncrest place node on the ridge.
    const derived = [{ name: "Suncrest trail network", names: [] }] as unknown as System[];
    const report = matchSeeds("Utah County", derived);
    expect(report.matched.map((m) => m.label)).toContain("Traverse Mountain (Lehi)");
  });
});

describe("buildCountyQuery", () => {
  it("outputs the trail union with `out geom` so relations carry member geometry", () => {
    // `out tags geom` (tags-only verbosity) returns route=mtb relations with NO
    // members on live Overpass, so relation systems get zero points.
    const query = buildCountyQuery("Salt Lake County");
    const unionOut = query.slice(query.lastIndexOf(");") + 2).trim();
    expect(unionOut).toBe("out geom;");
  });

  it("is the pinned query: unchanged trail filter plus named areas and place nodes", () => {
    // The trail-way filter must NOT loosen (540 bare path/track ways would
    // flood the list); areas and places are fetched for naming/splitting only.
    expect(buildCountyQuery("Utah County")).toBe(`[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="6"]["name"="Utah County"]->.county;
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
out geom;`);
  });
});

describe("collectSamples", () => {
  const systems = clusterSystems(fixture.elements).filter((s) => shouldKeepSystem(s));
  const { samples, skipped } = collectSamples(
    [{ county: "Salt Lake County", systems }],
    30,
  );

  it("samples every kept system that has points", () => {
    const sampled = samples.map((s) => s.system.name);
    expect(sampled).toContain("Corner Canyon Trails");
    expect(sampled).toContain("Ann's Trail");
    expect(sampled).not.toContain("Bonneville Shoreline Trail");
    for (const s of samples) expect(s.points.length).toBeGreaterThan(0);
  });

  it("names a kept system that ends up with zero sample points instead of dropping it silently", () => {
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.system.name).toBe("Bonneville Shoreline Trail");
    expect(skipped[0]?.county).toBe("Salt Lake County");
  });
});
