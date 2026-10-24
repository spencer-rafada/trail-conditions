import { describe, expect, it } from "vitest";
import type { TrailScore } from "./api";
import {
  boundsOfTrails,
  directionsUrl,
  distanceMiles,
  formatMiles,
  formatView,
  milesTo,
  parseView,
  trailInBounds,
  trailhead,
} from "./geo";

const LEHI = { lat: 40.3916, lon: -111.8508 };
const DRAPER = { lat: 40.5247, lon: -111.8638 };

const trail = (points?: TrailScore["points"]): TrailScore => ({
  id: "t",
  name: "T",
  days: [],
  scored_utc: "2026-10-24T12:00:00Z",
  ...(points && { points }),
});

describe("distanceMiles / formatMiles", () => {
  it("measures straight-line miles", () => {
    expect(distanceMiles(LEHI, DRAPER)).toBeCloseTo(9.2, 1);
    expect(distanceMiles(LEHI, LEHI)).toBe(0);
  });

  it("formats short, mid, and long distances", () => {
    expect(formatMiles(0.04)).toBe("< 0.1 mi");
    expect(formatMiles(6.24)).toBe("6.2 mi");
    expect(formatMiles(23.4)).toBe("23 mi");
  });
});

describe("pins", () => {
  const t = trail([
    { label: "Trailhead", lat: 40.5, lon: -111.8 },
    { label: "Top", lat: 40.6, lon: -111.6 },
  ]);

  it("uses the first pin as the trailhead and measures to it", () => {
    expect(trailhead(t)?.label).toBe("Trailhead");
    expect(milesTo(t, { lat: 40.5, lon: -111.8 })).toBe(0);
    expect(trailhead(trail())).toBeNull();
    expect(milesTo(trail(), LEHI)).toBeNull();
  });

  it("is in an area when its trailhead pin is on screen", () => {
    expect(trailInBounds(t, { south: 40.45, west: -111.85, north: 40.55, east: -111.75 })).toBe(true);
    // Only the Top is on screen: not listed, because it has no pin there.
    expect(trailInBounds(t, { south: 40.55, west: -111.7, north: 40.7, east: -111.5 })).toBe(false);
    expect(trailInBounds(trail(), { south: 0, west: -180, north: 90, east: 180 })).toBe(false);
  });

  it("boxes the trailheads only, or null when nothing has pins", () => {
    const other = trail([{ label: "Trailhead", lat: 40.7, lon: -111.9 }]);
    expect(boundsOfTrails([t, other])).toEqual({ south: 40.5, west: -111.9, north: 40.7, east: -111.8 });
    expect(boundsOfTrails([trail()])).toBeNull();
  });
});

describe("map view in the URL", () => {
  it("round-trips and rejects junk", () => {
    const view = { lat: 40.51234, lon: -111.86789, zoom: 12.4 };
    expect(formatView(view)).toBe("40.5123,-111.8679,12");
    expect(parseView("40.5123,-111.8679,12")).toEqual({ lat: 40.5123, lon: -111.8679, zoom: 12 });
    expect(parseView(null)).toBeNull();
    expect(parseView("40,abc,12")).toBeNull();
    expect(parseView("95,-111,12")).toBeNull();
    expect(parseView("40,-111")).toBeNull();
  });
});

describe("directionsUrl", () => {
  it("points Google Maps at the trailhead", () => {
    expect(directionsUrl({ lat: 40.5, lon: -111.8 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=40.5,-111.8",
    );
  });
});
