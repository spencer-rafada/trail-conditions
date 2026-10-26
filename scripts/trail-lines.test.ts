import { describe, expect, it } from "vitest";
import { encodePolyline, geometryByWay, linesForSystem, simplifyLine } from "./trail-lines";

describe("encodePolyline", () => {
  it("matches Google's published example", () => {
    expect(
      encodePolyline([
        { lat: 38.5, lon: -120.2 },
        { lat: 40.7, lon: -120.95 },
        { lat: 43.252, lon: -126.453 },
      ]),
    ).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });
});

describe("simplifyLine", () => {
  it("keeps both ends and drops points within the tolerance of the line", () => {
    const line = [
      { lat: 40.0, lon: -111.0 },
      { lat: 40.0, lon: -110.9995 }, // on the line
      { lat: 40.00002, lon: -110.999 }, // ~2 m off: dropped at 8 m
      { lat: 40.0, lon: -110.998 },
    ];
    expect(simplifyLine(line, 8)).toEqual([line[0], line[3]]);
  });

  it("keeps a real bend", () => {
    const line = [
      { lat: 40.0, lon: -111.0 },
      { lat: 40.001, lon: -110.999 }, // ~110 m off the chord
      { lat: 40.0, lon: -110.998 },
    ];
    expect(simplifyLine(line, 8)).toEqual(line);
  });
});

describe("geometryByWay / linesForSystem", () => {
  const elements = [
    {
      type: "way" as const,
      id: 1,
      geometry: [
        { lat: 40.0, lon: -111.0 },
        { lat: 40.01, lon: -111.0 },
      ],
    },
    {
      type: "relation" as const,
      id: 9,
      members: [
        {
          type: "way",
          ref: 2,
          geometry: [
            { lat: 40.1, lon: -111.1 },
            { lat: 40.11, lon: -111.1 },
          ],
        },
      ],
    },
  ];

  it("collects line geometry from standalone ways and relation members", () => {
    const geom = geometryByWay(elements);
    expect([...geom.keys()].sort()).toEqual([1, 2]);
  });

  it("encodes one line per way of the system, skipping ways without geometry", () => {
    const lines = linesForSystem([1, 2, 3], geometryByWay(elements), 8);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
  });
});
