import { describe, expect, it } from "vitest";
import { HOUR_MS, stamp } from "./time";
import type { PointRow } from "./chunking";
import type { OmHour } from "./open-meteo";
import {
  historyRows,
  mergeSnapshot,
  scoreTrail,
  trailPins,
  EMPTY_SNAPSHOT,
  type TrailRow,
  type TrailScore,
} from "./snapshot";

// "Now": an exact UTC hour, mid-day (no midnight edge in these tests).
const NOW = Date.UTC(2026, 9, 23, 15, 0);

const TRAIL: TrailRow = {
  id: "demo-trail",
  name: "Demo Trail",
  county: "Salt Lake County",
  tau_base_h: 24,
  tau_mult: 1,
  reports_used: 0,
};

const POINTS: PointRow[] = [
  {
    id: "demo-trail#trailhead",
    trail_id: "demo-trail",
    label: "Trailhead",
    lat: 40.5,
    lon: -111.6,
    elev_m: 1500,
    cell_id: "264:462",
  },
  {
    id: "demo-trail#top",
    trail_id: "demo-trail",
    label: "Top",
    lat: 40.6,
    lon: -111.7,
    elev_m: 2000,
    cell_id: "267:458",
  },
];

/** Open-Meteo axis spanning the full walk for offsets 0–2: 60 °F, dry,
 *  no snow, with per-stamp precip overrides. */
function omHours(precipAt: Record<string, number> = {}): Map<string, OmHour> {
  const map = new Map<string, OmHour>();
  for (let ms = NOW - 240 * HOUR_MS; ms <= NOW + 72 * HOUR_MS; ms += HOUR_MS) {
    const hourEnd = stamp(ms);
    map.set(hourEnd, {
      tempF: 60,
      precipIn: precipAt[hourEnd] ?? 0,
      snowfallIn: 0,
      snowDepthFt: 0,
    });
  }
  return map;
}

const omBoth = (precipAt: Record<string, number> = {}) =>
  new Map([
    ["demo-trail#trailhead", omHours(precipAt)],
    ["demo-trail#top", omHours(precipAt)],
  ]);

describe("scoreTrail — merged axis", () => {
  it("lets cached Stage IV rain win over Open-Meteo for a past hour", () => {
    const wetHour = stamp(NOW - 2 * HOUR_MS);
    // Open-Meteo says dry; Stage IV (rain_hourly) recorded 1.0 in for the
    // trailhead's cell. The now-level must reflect the Stage IV value.
    const rain = new Map([["264:462", new Map([[wetHour, 1.0]])]]);
    const score = scoreTrail(TRAIL, POINTS, rain, omBoth(), NOW, []);
    expect(score).not.toBeNull();
    const now = score!.days.find((d) => d.offset === 0)!;
    expect(now.level).toBe("muddy"); // 1.0 in two hours ago, tau 24 h
    expect(now.worst_point).toBe("Trailhead");

    // Same inputs without the Stage IV row: bone dry.
    const dry = scoreTrail(TRAIL, POINTS, new Map(), omBoth(), NOW, []);
    expect(dry!.days.find((d) => d.offset === 0)!.level).toBe("dry");
  });

  it("a Stage IV zero beats a wet Open-Meteo hour", () => {
    const wetHour = stamp(NOW - 2 * HOUR_MS);
    const rain = new Map([
      ["264:462", new Map([[wetHour, 0]])],
      ["267:458", new Map([[wetHour, 0]])],
    ]);
    const score = scoreTrail(TRAIL, POINTS, rain, omBoth({ [wetHour]: 1.0 }), NOW, []);
    expect(score!.days.find((d) => d.offset === 0)!.level).toBe("dry");
  });
});

describe("scoreTrail — now / tomorrow / day-after", () => {
  it("scores the three day offsets from forecast rain, with the forecast-day confidence penalty", () => {
    // Heavy rain forecast 20 h from now: dry today, muddy tomorrow, drier
    // again (but not dry) the day after as tau decays it.
    const score = scoreTrail(
      TRAIL,
      POINTS,
      new Map(),
      omBoth({ [stamp(NOW + 20 * HOUR_MS)]: 1.0 }),
      NOW,
      [],
    )!;
    const dayAt = (o: number) => score.days.find((d) => d.offset === o)!;
    const [now, tomorrow, dayAfter] = [dayAt(0), dayAt(1), dayAt(2)] as const;
    expect(now.level).toBe("dry");
    expect(tomorrow.level).toBe("muddy");
    expect(dayAfter.wetness).toBeLessThan(tomorrow.wetness);
    expect(dayAfter.wetness).toBeGreaterThan(0.05); // still not fully dry

    expect(now.confidence.factors.map((f) => f.id)).not.toContain("forecast_day");
    for (const day of [tomorrow, dayAfter]) {
      const factor = day.confidence.factors.find((f) => f.id === "forecast_day");
      expect(factor?.delta).toBe(day.offset * -10);
    }
    expect(dayAfter.confidence.score).toBeLessThan(now.confidence.score);
  });

  it("shows the worst point and its section name", () => {
    // Rain only in the Top point's cell.
    const wetHour = stamp(NOW - 2 * HOUR_MS);
    const rain = new Map([["267:458", new Map([[wetHour, 1.0]])]]);
    const now = scoreTrail(TRAIL, POINTS, rain, omBoth(), NOW, [])!.days.find(
      (d) => d.offset === 0,
    )!;
    expect(now.level).toBe("muddy");
    expect(now.worst_point).toBe("Top");
  });

  it("returns null when a point has no Open-Meteo axis (keep the previous score)", () => {
    const omOnlyFirst = new Map([["demo-trail#trailhead", omHours()]]);
    expect(scoreTrail(TRAIL, POINTS, new Map(), omOnlyFirst, NOW, [])).toBeNull();
  });

  it("carries the trail's county into the score, and omits it when NULL", () => {
    const scored = scoreTrail(TRAIL, POINTS, new Map(), omBoth(), NOW, [])!;
    expect(scored.county).toBe("Salt Lake County");

    const noCounty = scoreTrail({ ...TRAIL, county: null }, POINTS, new Map(), omBoth(), NOW, [])!;
    expect("county" in noCounty).toBe(false);
  });

  it("carries map pins, Trailhead first, whatever the row order", () => {
    const scored = scoreTrail(TRAIL, [...POINTS].reverse(), new Map(), omBoth(), NOW, [])!;
    expect(scored.points).toEqual([
      { label: "Trailhead", lat: 40.5, lon: -111.6 },
      { label: "Top", lat: 40.6, lon: -111.7 },
    ]);
  });
});

describe("trailPins", () => {
  it("rounds to 5 decimals and falls back to the point id for a missing label", () => {
    expect(
      trailPins([
        { id: "t#b", label: null, lat: 40.123456789, lon: -111.987654321 },
        { id: "t#a", label: "Top", lat: 40, lon: -111 },
      ]),
    ).toEqual([
      { label: "Top", lat: 40, lon: -111 },
      { label: "t#b", lat: 40.12346, lon: -111.98765 },
    ]);
  });
});

describe("scoreTrail — rider reports feed confidence (M5)", () => {
  const report = (
    verdict: "yes" | "wetter" | "drier",
    ageH: number,
  ): { verdict: "yes" | "wetter" | "drier"; createdMs: number } => ({
    verdict,
    createdMs: NOW - ageH * HOUR_MS,
  });
  const nowFactors = (reports: Parameters<typeof scoreTrail>[5]) =>
    scoreTrail(TRAIL, POINTS, new Map(), omBoth(), NOW, reports)!.days.find(
      (d) => d.offset === 0,
    )!.confidence.factors;

  it("an agreeing report within 24 h adds the full riders_agree factor", () => {
    expect(nowFactors([report("yes", 2)])).toContainEqual({
      id: "riders_agree",
      delta: 20,
    });
  });

  it("a 24–48 h-old agreeing report counts at half weight", () => {
    expect(nowFactors([report("yes", 30)])).toContainEqual({
      id: "riders_agree",
      delta: 10,
    });
  });

  it("an expired report (>48 h) no longer moves confidence", () => {
    const ids = nowFactors([report("yes", 50)]).map((f) => f.id);
    expect(ids).not.toContain("riders_agree");
  });

  it("a disagreeing (wetter) report subtracts", () => {
    expect(nowFactors([report("wetter", 2)])).toContainEqual({
      id: "rider_disagrees",
      delta: -20,
    });
  });

  it("wetter and drier together add the reports_conflict penalty", () => {
    expect(nowFactors([report("wetter", 2), report("drier", 3)])).toContainEqual({
      id: "reports_conflict",
      delta: -15,
    });
  });

  it("a rain event after the report resets it (worst point's cell rain)", () => {
    // Reported 10 h ago; 0.5 in fell 5 h ago in both cells: the report
    // stops counting, so riders_agree must not appear.
    const wetHour = stamp(NOW - 5 * HOUR_MS);
    const rain = new Map([
      ["264:462", new Map([[wetHour, 0.5]])],
      ["267:458", new Map([[wetHour, 0.5]])],
    ]);
    const factors = scoreTrail(TRAIL, POINTS, rain, omBoth(), NOW, [
      report("yes", 10),
    ])!.days.find((d) => d.offset === 0)!.confidence.factors;
    expect(factors.map((f) => f.id)).not.toContain("riders_agree");
  });
});

describe("mergeSnapshot — the single scores_latest row", () => {
  const scored: TrailScore = {
    id: "demo-trail",
    name: "Demo Trail",
    days: [],
    scored_utc: new Date(NOW).toISOString(),
  };

  it("replaces this chunk's trails and keeps every other trail", () => {
    const other: TrailScore = { ...scored, id: "other-trail", name: "Other" };
    const existing = mergeSnapshot(EMPTY_SNAPSHOT, [other], NOW - HOUR_MS);
    const merged = mergeSnapshot(existing, [scored], NOW);
    expect(Object.keys(merged.trails).sort()).toEqual(["demo-trail", "other-trail"]);
    expect(merged.trails["other-trail"]).toEqual(other);
    expect(merged.updated_utc).toBe(new Date(NOW).toISOString());
  });

  it("keeps pre-county entries as-is when newer scores carry county", () => {
    // An old snapshot entry scored before the county field existed.
    const legacy: TrailScore = { ...scored, id: "legacy-trail", name: "Legacy" };
    expect("county" in legacy).toBe(false);
    const existing = mergeSnapshot(EMPTY_SNAPSHOT, [legacy], NOW - HOUR_MS);
    const withCounty: TrailScore = { ...scored, county: "Utah County" };
    const merged = mergeSnapshot(existing, [withCounty], NOW);
    expect(merged.trails["legacy-trail"]).toEqual(legacy);
    expect(merged.trails["demo-trail"]!.county).toBe("Utah County");
  });

  it("produces the full snapshot shape for a scored trail", () => {
    const real = scoreTrail(TRAIL, POINTS, new Map(), omBoth(), NOW, [])!;
    const snapshot = mergeSnapshot(null, [real], NOW);
    const entry = snapshot.trails["demo-trail"]!;
    expect(entry.name).toBe("Demo Trail");
    expect(entry.days.map((d) => d.offset)).toEqual([0, 1, 2]);
    for (const day of entry.days) {
      expect(day).toMatchObject({
        level: expect.any(String),
        wetness: expect.any(Number),
        worst_point: expect.any(String),
        confidence: {
          score: expect.any(Number),
          band: expect.stringMatching(/^(high|medium|low)$/),
          factors: expect.any(Array),
        },
      });
    }
  });
});

describe("historyRows", () => {
  it("emits one hourly 'now' row per trail, keyed on the hour-ending stamp", () => {
    const score = scoreTrail(TRAIL, POINTS, new Map(), omBoth(), NOW + 25 * 60_000, [])!;
    const rows = historyRows([score], NOW + 25 * 60_000); // 15:25 -> hour 15:00
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trail_id: "demo-trail",
      ts_utc: "2026-10-23T15:00:00Z",
      level: score.days[0]!.level,
      wetness: score.days[0]!.wetness,
      confidence: score.days[0]!.confidence.score,
    });
  });
});

describe("scoreTrail — a tuned tau_mult changes the recompute (M6 AC3)", () => {
  it("gives different wetness and level for tau_mult 1.0 vs 3.0 on identical rain", () => {
    // 1.0 in of rain 60 h ago, then dry at 60 °F (no cold slowdown):
    // w = e^(-60 / (24 × mult)) — prime at mult 1, muddy at mult 3.
    const rainHour = stamp(NOW - 60 * HOUR_MS);
    const rain = new Map([
      ["264:462", new Map([[rainHour, 1.0]])],
      ["267:458", new Map([[rainHour, 1.0]])],
    ]);
    const slow = { ...TRAIL, tau_mult: 3.0 };
    const base = scoreTrail(TRAIL, POINTS, rain, omBoth(), NOW, [])!;
    const tuned = scoreTrail(slow, POINTS, rain, omBoth(), NOW, [])!;
    const nowDay = (s: TrailScore) => s.days.find((d) => d.offset === 0)!;
    expect(nowDay(tuned).wetness).toBeGreaterThan(nowDay(base).wetness);
    expect(nowDay(base).level).toBe("prime");
    expect(nowDay(tuned).level).toBe("muddy");
  });
});
