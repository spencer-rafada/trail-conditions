import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  chunk,
  clusterSystems,
  decimatePoints,
  matchSeeds,
  pickExtremes,
  shouldKeepSystem,
  toCsv,
  type OverpassElement,
  type System,
} from "./discover-trails";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/overpass-sample.json", import.meta.url), "utf8"),
) as { elements: OverpassElement[] };

function findSystem(systems: System[], name: string): System {
  const sys = systems.find((s) => s.name === name);
  if (!sys) throw new Error(`no system named ${name} in ${systems.map((s) => s.name).join(" | ")}`);
  return sys;
}

describe("clusterSystems", () => {
  const systems = clusterSystems(fixture.elements);

  it("skips the county boundary relation and forms four systems", () => {
    expect(systems).toHaveLength(4);
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

  it("labels an all-unnamed cluster by its location", () => {
    const unnamed = systems.find((s) => s.wayIds.includes(106));
    expect(unnamed).toBeDefined();
    expect(unnamed?.name.startsWith("Unnamed cluster")).toBe(true);
    expect(unnamed?.names).toEqual([]);
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
  };

  it("writes the fixed header first", () => {
    const lines = toCsv([row]).trimEnd().split("\n");
    expect(lines[0]).toBe(CSV_HEADER);
    expect(CSV_HEADER).toBe(
      "system,county,trailhead_lat,trailhead_lon,trailhead_elev_m,top_lat,top_lon,top_elev_m,n_ways,n_relations,osm_refs,notes",
    );
  });

  it("escapes quotes and commas, rounds coordinates to 5 decimals and elevations to meters", () => {
    const lines = toCsv([row]).trimEnd().split("\n");
    expect(lines[1]).toBe(
      '"Say ""Rush"", Lower",Salt Lake County,40.12346,-111.98765,1501,40.20000,-111.30000,2500,2,0,way/103;way/104,distance cluster',
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
});
