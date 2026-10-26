import { describe, expect, it } from "vitest";
import type { ConditionLevel } from "@trail-conditions/model";
import type { TrailScore } from "./api";
import { exploreList } from "./explore";

function trail(id: string, level: ConditionLevel, lat: number, lon: number): TrailScore {
  return {
    id,
    name: id,
    county: "Utah County",
    days: [
      {
        offset: 0,
        level,
        wetness: 0,
        worst_point: "Trailhead",
        confidence: { score: 60, band: "medium", factors: [] },
      },
    ],
    scored_utc: "2026-10-24T12:00:00Z",
    points: [{ label: "Trailhead", lat, lon }],
  };
}

const NEAR_MUDDY = trail("near-muddy", "muddy", 40.4, -111.85);
const FAR_DRY = trail("far-dry", "dry", 40.5, -111.85);
const OUTSIDE = trail("outside-prime", "prime", 41.5, -111.85);
const TRAILS = [NEAR_MUDDY, FAR_DRY, OUTSIDE];
const AREA = { south: 40, west: -112, north: 41, east: -111 };
const base = { trails: TRAILS, query: "", rideableOnly: false, bounds: AREA, origin: null };
const ids = (r: { trails: TrailScore[] }) => r.trails.map((t) => t.id);

describe("exploreList", () => {
  it("lists the trails in the map area, best conditions first", () => {
    const r = exploreList(base);
    expect(r.mode).toBe("area");
    expect(ids(r)).toEqual(["far-dry", "near-muddy"]);
    expect(r.rideableCount).toBe(1);
  });

  it("orders by distance after Near me", () => {
    expect(ids(exploreList({ ...base, origin: { lat: 40.39, lon: -111.85 } }))).toEqual([
      "near-muddy",
      "far-dry",
    ]);
  });

  it("searches every trail, ignoring the map area", () => {
    const r = exploreList({ ...base, query: "outside" });
    expect(r.mode).toBe("search");
    expect(ids(r)).toEqual(["outside-prime"]);
  });

  it("keeps the rideable count but hides the rest with Rideable now", () => {
    const r = exploreList({ ...base, rideableOnly: true });
    expect(ids(r)).toEqual(["far-dry"]);
    expect(r.rideableCount).toBe(1);
  });

  it("lists everything when there is no map", () => {
    const r = exploreList({ ...base, bounds: null });
    expect(r.mode).toBe("all");
    expect(ids(r)).toEqual(["far-dry", "outside-prime", "near-muddy"]);
  });
});
