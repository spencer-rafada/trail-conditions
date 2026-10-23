import { describe, expect, it } from "vitest";
import { TAU, tauBase, type SoilProfile } from "@trail-conditions/model";
import {
  CSV_HEADER,
  assignTrailIds,
  buildTrail,
  cellIdFromIem,
  dedupeCandidates,
  filterByCounty,
  parseCandidatesCsv,
  pointOutsideCounties,
  sdaQuery,
  soilFromSdaResponse,
  validateTrails,
  type Candidate,
} from "./enrich-trails";

// Real rows from data/trail-candidates.csv (osm_refs shortened where long).
const BOBSLED =
  "Bobsled Trail,Salt Lake County,40.78432,-111.89283,1360,40.82836,-111.86646,1824,121,0,way/33908771,distance cluster of loose ways; 48 distinct names; extremes from 30 sampled points";
const DONNER_REED =
  "Donner Reed Party and Mormon Pioneer Trail,Salt Lake County,40.75416,-111.69440,1729,40.87298,-111.76196,2705,50,0,way/10088171,distance cluster of loose ways; 10 distinct names; extremes from 30 sampled points";
const MUELLER_PARK =
  "Mueller Park Trail,Salt Lake County,40.83945,-111.82794,1975,40.85391,-111.75415,2807,4,0,way/639186640;way/1190451194;way/1431582707;way/1432084214,distance cluster of loose ways; 3 distinct names; extremes from 30 sampled points";
const GWT_UTAH =
  "GWT Strawberry Ridge,Utah County,40.14461,-111.22583,2565,40.19404,-111.24711,2789,1,0,way/10191473,distance cluster of loose ways; extremes from 30 sampled points";
const GWT_WASATCH =
  "GWT Strawberry Ridge,Wasatch County,40.14461,-111.22583,2565,40.19404,-111.24711,2789,1,0,way/10191473,distance cluster of loose ways; extremes from 30 sampled points";
const LITTLE_VALLEY_UTAH =
  "Little Valley - Sheep Canyon Trail,Utah County,40.26122,-111.40868,1999,40.28888,-111.41424,2318,1,0,way/746824100,distance cluster of loose ways; extremes from 30 sampled points";
const LITTLE_VALLEY_WASATCH =
  "Little Valley - Sheep Canyon Trail,Wasatch County,40.26122,-111.40868,1999,40.28888,-111.41424,2318,1,0,way/746824100,distance cluster of loose ways; extremes from 30 sampled points";
// Same name as GWT_UTAH but different coordinates: a distinct system, not a duplicate.
const GWT_OTHER_COORDS =
  "GWT Strawberry Ridge,Utah County,40.20000,-111.30000,2400,40.25000,-111.31000,2600,1,0,way/99999999,distance cluster of loose ways; extremes from 30 sampled points";
const QUOTED_CLUSTER =
  '"Unnamed cluster @ 40.555,-112.000",Salt Lake County,40.54672,-111.99168,1448,40.55063,-111.99773,1470,15,0,way/220795864,distance cluster of loose ways; extremes from 30 sampled points';

const csvOf = (...rows: string[]) => [CSV_HEADER, ...rows].join("\n") + "\n";

describe("parseCandidatesCsv", () => {
  it("turns a CSV row into a candidate with Trailhead and Top sample points carrying the CSV elevations", () => {
    const [c] = parseCandidatesCsv(csvOf(BOBSLED));
    expect(c).toBeDefined();
    expect(c!.system).toBe("Bobsled Trail");
    expect(c!.county).toBe("Salt Lake County");
    expect(c!.points.map((p) => p.label)).toEqual(["Trailhead", "Top"]);
    expect(c!.points[0]).toMatchObject({
      lat: 40.78432,
      lon: -111.89283,
      elev_m: 1360,
    });
    expect(c!.points[1]).toMatchObject({
      lat: 40.82836,
      lon: -111.86646,
      elev_m: 1824,
    });
    expect(c!.osm_refs).toBe("way/33908771");
  });

  it("handles quoted fields containing commas", () => {
    const [c] = parseCandidatesCsv(csvOf(QUOTED_CLUSTER));
    expect(c!.system).toBe("Unnamed cluster @ 40.555,-112.000");
    expect(c!.points[0]!.lat).toBe(40.54672);
  });

  it("rejects a CSV whose header does not match", () => {
    expect(() => parseCandidatesCsv("a,b,c\n1,2,3\n")).toThrow(/header/i);
  });

  it("rejects a row with a non-numeric coordinate", () => {
    const bad = BOBSLED.replace("40.78432", "not-a-number");
    expect(() => parseCandidatesCsv(csvOf(bad))).toThrow(/not-a-number/);
  });
});

describe("dedupeCandidates", () => {
  it("collapses rows identical in every column except county, keeping the first occurrence", () => {
    const rows = parseCandidatesCsv(
      csvOf(GWT_UTAH, LITTLE_VALLEY_UTAH, GWT_WASATCH, LITTLE_VALLEY_WASATCH),
    );
    const { kept, dropped } = dedupeCandidates(rows);
    expect(kept.map((c) => [c.system, c.county])).toEqual([
      ["GWT Strawberry Ridge", "Utah County"],
      ["Little Valley - Sheep Canyon Trail", "Utah County"],
    ]);
    expect(dropped).toHaveLength(2);
    expect(dropped[0]!.dropped.county).toBe("Wasatch County");
    expect(dropped[0]!.keptCopy.county).toBe("Utah County");
  });

  it("does not merge same-name rows with different coordinates", () => {
    const rows = parseCandidatesCsv(csvOf(GWT_UTAH, GWT_OTHER_COORDS));
    const { kept, dropped } = dedupeCandidates(rows);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });
});

describe("county filter (Salt Lake–Davis line)", () => {
  it("classifies both Mueller Park points as outside the target counties", () => {
    expect(pointOutsideCounties({ lat: 40.83945, lon: -111.82794 })).toBe(true); // trailhead, Bountiful bench
    expect(pointOutsideCounties({ lat: 40.85391, lon: -111.75415 })).toBe(true); // top, north of the ridge
  });

  it("classifies Donner Reed's top as outside but its trailhead as inside", () => {
    expect(pointOutsideCounties({ lat: 40.87298, lon: -111.76196 })).toBe(true); // top
    expect(pointOutsideCounties({ lat: 40.75416, lon: -111.6944 })).toBe(false); // trailhead (Emigration area)
  });

  it("keeps clearly in-county points", () => {
    expect(pointOutsideCounties({ lat: 40.82836, lon: -111.86646 })).toBe(false); // Bobsled top
    expect(pointOutsideCounties({ lat: 40.80985, lon: -111.73277 })).toBe(false); // Old Mine Road top
    expect(pointOutsideCounties({ lat: 39.78727, lon: -111.72969 })).toBe(false); // southernmost CSV point
  });

  it("drops a row only when BOTH points are outside, and names every crossing point", () => {
    const rows = parseCandidatesCsv(csvOf(BOBSLED, DONNER_REED, MUELLER_PARK));
    const { kept, droppedRows, crossedPoints } = filterByCounty(rows);
    expect(droppedRows.map((c) => c.system)).toEqual(["Mueller Park Trail"]);
    expect(kept.map((c) => c.system)).toEqual([
      "Bobsled Trail",
      "Donner Reed Party and Mormon Pioneer Trail",
    ]);
    expect(crossedPoints).toEqual([
      expect.objectContaining({
        system: "Donner Reed Party and Mormon Pioneer Trail",
        label: "Top",
        rowDropped: false,
      }),
      expect.objectContaining({
        system: "Mueller Park Trail",
        label: "Trailhead",
        rowDropped: true,
      }),
      expect.objectContaining({
        system: "Mueller Park Trail",
        label: "Top",
        rowDropped: true,
      }),
    ]);
  });
});

describe("sdaQuery", () => {
  it("is the spec §3.1 query verbatim with lon lat substituted", () => {
    expect(sdaQuery({ lat: 40.5669, lon: -111.6035 })).toBe(
      "SELECT TOP 1 c.hydgrp, c.drainagecl, ch.sandtotal_r, ch.claytotal_r, " +
        "ch.fraggt10_r, ch.frag3to10_r " +
        "FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(-111.6035 40.5669)') k " +
        "JOIN mapunit mu ON mu.mukey = k.mukey " +
        "JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' " +
        "LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0 " +
        "ORDER BY c.comppct_r DESC",
    );
  });
});

describe("soilFromSdaResponse", () => {
  it("maps a full SDA row in SELECT order, including drainage", () => {
    const r = soilFromSdaResponse({
      Table: [["B", "Well drained", "44.3", "15", "0", "5"]],
    });
    expect(r.found).toBe(true);
    expect(r.soil).toEqual({
      sandPct: 44.3,
      clayPct: 15,
      fragGt10Pct: 0,
      frag3to10Pct: 5,
      hydrologicGroup: "B",
    } satisfies SoilProfile);
    expect(r.drainage).toBe("Well drained");
  });

  it("treats a row with null chorizon columns as found, with null soil numbers (LEFT JOIN shape)", () => {
    const r = soilFromSdaResponse({
      Table: [["C", "Well drained", null, null, null, null]],
    });
    expect(r.found).toBe(true);
    expect(r.soil).toEqual({
      sandPct: null,
      clayPct: null,
      fragGt10Pct: null,
      frag3to10Pct: null,
      hydrologicGroup: "C",
    });
    expect(r.drainage).toBe("Well drained");
  });

  it("maps empty strings to null", () => {
    const r = soilFromSdaResponse({ Table: [["D", "", "", "12", "", ""]] });
    expect(r.soil.sandPct).toBeNull();
    expect(r.soil.clayPct).toBe(12);
    expect(r.drainage).toBeNull();
  });

  it("returns found=false with an all-null profile for an empty Table", () => {
    const r = soilFromSdaResponse({ Table: [] });
    expect(r.found).toBe(false);
    expect(r.soil).toEqual({
      sandPct: null,
      clayPct: null,
      fragGt10Pct: null,
      frag3to10Pct: null,
      hydrologicGroup: null,
    });
    expect(r.drainage).toBeNull();
  });

  it("returns found=false when the response has no Table key at all", () => {
    const r = soilFromSdaResponse({});
    expect(r.found).toBe(false);
    expect(r.soil.sandPct).toBeNull();
  });

  it("no-soil fallback drains through tauBase to the model's default tau, not a literal", () => {
    const { soil } = soilFromSdaResponse({});
    expect(tauBase(soil)).toBe(TAU.defaultHours);
  });
});

describe("cellIdFromIem", () => {
  it('formats top-level integer gridi/gridj as "gridi:gridj"', () => {
    expect(
      cellIdFromIem({ gridi: 267, gridj: 458, data: [{ end_valid: "x", precip_in: 0 }] }),
    ).toBe("267:458");
  });

  it("rejects a response missing gridj", () => {
    expect(() => cellIdFromIem({ gridi: 267 })).toThrow(/gridj/);
  });

  it("rejects non-integer grid indices", () => {
    expect(() => cellIdFromIem({ gridi: "267", gridj: 458 })).toThrow(/gridi/);
  });
});

describe("assignTrailIds", () => {
  it("slugifies system names and disambiguates collisions deterministically", () => {
    const ids = assignTrailIds([
      { system: "Bonneville Shoreline Trail", county: "Salt Lake County" },
      { system: "Bonneville Shoreline Trail", county: "Utah County" },
      { system: "Murdock Canal Trail", county: "Utah County" },
      { system: "Murdock Canal Trail", county: "Utah County" },
    ]);
    expect(ids[0]).toBe("bonneville-shoreline-trail");
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});

const SANDY: SoilProfile = {
  sandPct: 70,
  clayPct: 5,
  fragGt10Pct: 0,
  frag3to10Pct: 0,
  hydrologicGroup: "B",
};
const CLAYEY: SoilProfile = {
  sandPct: 20,
  clayPct: 40,
  fragGt10Pct: 0,
  frag3to10Pct: 0,
  hydrologicGroup: "C",
};

function builtTrail() {
  const [candidate] = parseCandidatesCsv(csvOf(BOBSLED));
  return buildTrail(candidate as Candidate, "bobsled-trail", [
    { soil: SANDY, drainage: "Well drained", found: true, cell_id: "267:458" },
    { soil: CLAYEY, drainage: "Poorly drained", found: true, cell_id: "268:458" },
  ]);
}

describe("buildTrail", () => {
  it("stores tau_base_h per point via the model's tauBase", () => {
    const trail = builtTrail();
    expect(trail.points[0]!.tau_base_h).toBe(tauBase(SANDY));
    expect(trail.points[1]!.tau_base_h).toBe(tauBase(CLAYEY));
  });

  it("sets the trail tau_base_h to the slowest-drying (max) of its points", () => {
    const trail = builtTrail();
    expect(trail.tau_base_h).toBe(Math.max(tauBase(SANDY), tauBase(CLAYEY)));
    expect(trail.tau_base_h).toBe(tauBase(CLAYEY)); // the clayey point is the slower one
  });

  it("carries drainage and cell_id onto each point and tau_mult 1.0 on the trail", () => {
    const trail = builtTrail();
    expect(trail.tau_mult).toBe(1.0);
    expect(trail.points[0]).toMatchObject({
      label: "Trailhead",
      drainage: "Well drained",
      soil_found: true,
      cell_id: "267:458",
    });
    expect(trail.points[1]).toMatchObject({ label: "Top", cell_id: "268:458" });
  });
});

describe("validateTrails", () => {
  it("passes a fully-enriched trail", () => {
    expect(validateTrails([builtTrail()])).toEqual([]);
  });

  it("reports a point with a malformed cell_id", () => {
    const trail = builtTrail();
    trail.points[0]!.cell_id = "";
    const problems = validateTrails([trail]);
    expect(problems.join("\n")).toMatch(/bobsled-trail/);
    expect(problems.join("\n")).toMatch(/cell_id/);
  });

  it("reports a point with a non-finite elevation", () => {
    const trail = builtTrail();
    trail.points[1]!.elev_m = Number.NaN;
    expect(validateTrails([trail]).join("\n")).toMatch(/elev_m/);
  });

  it("reports a trail whose tau_base_h is not the max of its points", () => {
    const trail = builtTrail();
    trail.tau_base_h = 1;
    expect(validateTrails([trail]).join("\n")).toMatch(/tau_base_h/);
  });
});
