import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clusterSystems, type OverpassElement, type System } from "./discover-trails";
import { buildNamesFile, cleanNames, matchSystem, type TrailsJsonEntry } from "./trail-names";

const draper = JSON.parse(
  readFileSync(new URL("../fixtures/overpass-draper-sample.json", import.meta.url), "utf8"),
) as { elements: OverpassElement[] };

const systems = clusterSystems(draper.elements);
const withNames = systems.find((s) => s.names.includes("Rattler Trail"))!;

const entry = (over: Partial<TrailsJsonEntry> = {}): TrailsJsonEntry => ({
  id: "corner-canyon",
  system: withNames.name,
  county: "Salt Lake County",
  points: [{ label: "Trailhead", ...withNames.points[0]! }],
  ...over,
});

describe("cleanNames", () => {
  it("dedupes, sorts, and drops generic names and the system's own name", () => {
    expect(
      cleanNames(
        ["Rattler Trail", "Corner Canyon", "rattler  trail", "Trail", " Gas Line Trail", ""],
        "Corner Canyon",
      ),
    ).toEqual(["Gas Line Trail", "Rattler Trail"]);
  });
});

describe("matchSystem", () => {
  it("matches by name in the fixture's Corner Canyon cluster", () => {
    expect(withNames).toBeDefined();
    expect(matchSystem(entry(), systems)).toBe(withNames);
  });

  it("falls back to a system near the trailhead when the name was changed in review", () => {
    expect(matchSystem(entry({ system: "Renamed In Review" }), systems)).toBe(withNames);
  });

  it("gives up when neither the name nor the location matches", () => {
    expect(
      matchSystem(
        entry({ system: "Nowhere", points: [{ label: "Trailhead", lat: 41.5, lon: -112.5 }] }),
        systems,
      ),
    ).toBeNull();
  });

  it("picks the same-named system closest to the trailhead when names repeat", () => {
    const far: System = { ...withNames, points: [{ lat: 41, lon: -112 }] };
    expect(matchSystem(entry(), [far, withNames])).toBe(withNames);
  });
});

describe("buildNamesFile", () => {
  it("writes member names by trail id and lists unmatched trails", () => {
    const lost = entry({
      id: "lost",
      system: "Nowhere",
      points: [{ label: "Trailhead", lat: 41.5, lon: -112.5 }],
    });
    const { file, unmatched } = buildNamesFile(
      [entry(), lost],
      new Map([["Salt Lake County", systems]]),
      "2026-10-24T00:00:00.000Z",
    );
    expect(file.names["corner-canyon"]).toContain("Rattler Trail");
    expect(file.names["corner-canyon"]).not.toContain(withNames.name);
    expect(file.names["lost"]).toBeUndefined();
    expect(unmatched.map((e) => e.id)).toEqual(["lost"]);
  });
});
