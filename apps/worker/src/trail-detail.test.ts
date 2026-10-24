import { describe, expect, it } from "vitest";
import type { Env } from "./score-job";
import type { ScoredDay } from "./snapshot";
import {
  getTrailDetail,
  lastRainEvent,
  soilLabel,
  type RainEventRow,
  type SoilRow,
} from "./trail-detail";

describe("lastRainEvent", () => {
  it("returns null with no rows or only sub-threshold drizzle", () => {
    expect(lastRainEvent([])).toBeNull();
    expect(
      lastRainEvent([
        { ts_utc: "2026-10-22T10:00:00Z", precip_in: 0.05 },
        { ts_utc: "2026-10-23T11:00:00Z", precip_in: 0.09 },
      ]),
    ).toBeNull();
  });

  it("does not count exactly CONFIDENCE.rainEventMinIn (spec §6.3: '> 0.1 in', decision 5a)", () => {
    const at = { ts_utc: "2026-10-23T11:00:00Z", precip_in: 0.1 };
    expect(lastRainEvent([at])).toBeNull();
    const above: RainEventRow = { ts_utc: "2026-10-23T11:00:00Z", precip_in: 0.11 };
    expect(lastRainEvent([at, above])).toEqual(above);
  });

  it("picks the most recent qualifying hour across cells, not the heaviest", () => {
    const rows: RainEventRow[] = [
      { ts_utc: "2026-10-21T04:00:00Z", precip_in: 1.5 },
      { ts_utc: "2026-10-23T09:00:00Z", precip_in: 0.3 },
      { ts_utc: "2026-10-23T11:00:00Z", precip_in: 0.08 }, // newest, below threshold
    ];
    expect(lastRainEvent(rows)).toEqual({
      ts_utc: "2026-10-23T09:00:00Z",
      precip_in: 0.3,
    });
  });

  it("on the same hour in two cells, reports the heavier cell", () => {
    const rows: RainEventRow[] = [
      { ts_utc: "2026-10-23T09:00:00Z", precip_in: 0.3 },
      { ts_utc: "2026-10-23T09:00:00Z", precip_in: 0.6 },
    ];
    expect(lastRainEvent(rows)!.precip_in).toBe(0.6);
  });
});

describe("soilLabel", () => {
  it("classifies by TAU's own thresholds: sand >= 60 sandy, clay >= 30 clay, else loam", () => {
    expect(soilLabel([{ sand: 60, clay: 10 }])).toBe("sandy");
    expect(soilLabel([{ sand: 20, clay: 30 }])).toBe("clay");
    expect(soilLabel([{ sand: 40, clay: 20 }])).toBe("loam");
  });

  it("skips NULL-soil points and returns null when no point has data", () => {
    const rows: SoilRow[] = [
      { sand: null, clay: null },
      { sand: 70, clay: 5 },
    ];
    expect(soilLabel(rows)).toBe("sandy");
    expect(soilLabel([{ sand: null, clay: null }])).toBeNull();
    expect(soilLabel([])).toBeNull();
  });
});

// --- route handler against a fake D1 ---

const NOW = Date.UTC(2026, 9, 23, 15, 0);

interface FakeData {
  trail: {
    id: string;
    name: string | null;
    county: string | null;
    tau_base_h: number | null;
    tau_mult: number | null;
  } | null;
  points: (SoilRow & { cell_id: string })[];
  snapshotJson: string | null;
  rain: RainEventRow[];
  reportCount: number;
}

function fakeEnv(data: FakeData): Env {
  const prepare = (sql: string) => {
    const stmt = {
      bind: (..._args: unknown[]) => stmt,
      first: async () => {
        if (sql.includes("FROM trails")) return data.trail;
        if (sql.includes("FROM scores_latest"))
          return data.snapshotJson ? { json: data.snapshotJson } : null;
        if (sql.includes("FROM reports")) return { n: data.reportCount };
        throw new Error(`unexpected first(): ${sql}`);
      },
      all: async () => {
        if (sql.includes("FROM trail_points")) return { results: data.points };
        if (sql.includes("FROM rain_hourly")) return { results: data.rain };
        throw new Error(`unexpected all(): ${sql}`);
      },
    };
    return stmt;
  };
  return {
    ADMIN_SECRET: "x",
    TURNSTILE_SECRET: "x",
    REPORT_IP_SALT_SECRET: "x",
    DB: { prepare } as unknown as D1Database,
  };
}

const DAY: ScoredDay = {
  offset: 0,
  level: "prime",
  wetness: 0.1,
  worst_point: "Top",
  confidence: { score: 70, band: "high", factors: [] },
};

const SCORED = {
  id: "demo-trail",
  name: "Demo Trail",
  county: "Utah County",
  days: [DAY],
  scored_utc: new Date(NOW).toISOString(),
};

describe("getTrailDetail", () => {
  it("404s on an unknown trail id", async () => {
    const res = await getTrailDetail(
      fakeEnv({ trail: null, points: [], snapshotJson: null, rain: [], reportCount: 0 }),
      "nope",
      NOW,
    );
    expect(res.status).toBe(404);
  });

  it("assembles snapshot days, soil, drying hours, last rain, and report count", async () => {
    const env = fakeEnv({
      trail: {
        id: "demo-trail",
        name: "Demo Trail",
        county: "Utah County",
        tau_base_h: 24,
        tau_mult: 1.2,
      },
      points: [{ sand: 20, clay: 35, cell_id: "264:462" }],
      snapshotJson: JSON.stringify({
        updated_utc: new Date(NOW).toISOString(),
        trails: { "demo-trail": SCORED },
      }),
      rain: [{ ts_utc: "2026-10-23T09:00:00Z", precip_in: 0.3 }],
      reportCount: 2,
    });
    const res = await getTrailDetail(env, "demo-trail", NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({
      id: "demo-trail",
      name: "Demo Trail",
      county: "Utah County",
      drying_hours: 24 * 1.2,
      soil: "clay",
      days: [DAY],
      scored_utc: new Date(NOW).toISOString(),
      last_rain: { ts_utc: "2026-10-23T09:00:00Z", precip_in: 0.3 },
      reports_since_rain: 2,
    });
  });

  it("serves a seeded-but-unscored trail with empty days and null last rain", async () => {
    const env = fakeEnv({
      trail: {
        id: "demo-trail",
        name: null,
        county: null,
        tau_base_h: null,
        tau_mult: null,
      },
      points: [{ sand: null, clay: null, cell_id: "264:462" }],
      snapshotJson: null,
      rain: [],
      reportCount: 0,
    });
    const body = (await (await getTrailDetail(env, "demo-trail", NOW)).json()) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      id: "demo-trail",
      name: "demo-trail",
      county: null,
      drying_hours: null,
      soil: null,
      days: [],
      scored_utc: null,
      last_rain: null,
      reports_since_rain: 0,
    });
  });
});
