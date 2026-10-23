import { describe, expect, it } from "vitest";
import {
  cellNeedsFetch,
  daysToFetch,
  rainRowsFromResponse,
  rainUpsertStatements,
  stage4Url,
  RAIN_ROWS_PER_STATEMENT,
  STAGE4_SOURCE,
  type RainRow,
} from "./stage4";

describe("daysToFetch", () => {
  it("fetches only today mid-day — a completed past day is never refetched", () => {
    expect(daysToFetch(Date.UTC(2026, 9, 23, 14, 30))).toEqual(["2026-10-23"]);
    expect(daysToFetch(Date.UTC(2026, 9, 23, 23, 50))).toEqual(["2026-10-23"]);
  });

  it("also fetches yesterday during the first chunk cycle after UTC midnight", () => {
    expect(daysToFetch(Date.UTC(2026, 9, 23, 0, 0))).toEqual([
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(daysToFetch(Date.UTC(2026, 9, 23, 2, 50))).toEqual([
      "2026-10-22",
      "2026-10-23",
    ]);
    // the cycle is over: yesterday was captured exactly once per cell
    expect(daysToFetch(Date.UTC(2026, 9, 23, 3, 0))).toEqual(["2026-10-23"]);
  });
});

describe("cellNeedsFetch (cross-chunk cache check)", () => {
  const now = Date.UTC(2026, 9, 23, 14, 0);

  it("does not refetch a cell cached recently by its own chunk", () => {
    expect(cellNeedsFetch("2026-10-23T12:00:00Z", now)).toBe(false);
  });

  it("fetches when the cache is empty or stale", () => {
    expect(cellNeedsFetch(null, now)).toBe(true);
    expect(cellNeedsFetch("2026-10-23T07:00:00Z", now)).toBe(true);
  });
});

describe("rainRowsFromResponse", () => {
  it("keeps zero-precip hours so a Stage IV zero beats the Open-Meteo filler", () => {
    const rows = rainRowsFromResponse("264:462", {
      gridi: 264,
      gridj: 462,
      data: [
        { end_valid: "2026-10-23T01:00:00Z", precip_in: 0 },
        { end_valid: "2026-10-23T02:00:00Z", precip_in: 0.12 },
      ],
    });
    expect(rows).toEqual<RainRow[]>([
      {
        cell_id: "264:462",
        ts_utc: "2026-10-23T01:00:00Z",
        precip_in: 0,
        source: STAGE4_SOURCE,
      },
      {
        cell_id: "264:462",
        ts_utc: "2026-10-23T02:00:00Z",
        precip_in: 0.12,
        source: STAGE4_SOURCE,
      },
    ]);
  });
});

describe("rainUpsertStatements", () => {
  it("batches rows under the 100-bound-parameter limit and upserts on (cell_id, ts_utc)", () => {
    const rows: RainRow[] = Array.from({ length: 60 }, (_, i) => ({
      cell_id: "264:462",
      ts_utc: `2026-10-23T${String(i % 24).padStart(2, "0")}:00:00Z`,
      precip_in: 0,
      source: STAGE4_SOURCE,
    }));
    const statements = rainUpsertStatements(rows);
    expect(statements).toHaveLength(Math.ceil(60 / RAIN_ROWS_PER_STATEMENT));
    for (const s of statements) {
      expect(s.params.length).toBeLessThanOrEqual(100);
      expect(s.sql).toContain("ON CONFLICT (cell_id, ts_utc) DO UPDATE");
    }
    expect(statements.flatMap((s) => s.params)).toHaveLength(60 * 4);
  });
});

describe("stage4Url", () => {
  it("asks for one UTC calendar day at the cell's representative point", () => {
    expect(stage4Url(40.5, -111.6, "2026-10-23")).toBe(
      "https://mesonet.agron.iastate.edu/json/stage4.py?lat=40.5&lon=-111.6&valid=2026-10-23&tz=UTC",
    );
  });
});
