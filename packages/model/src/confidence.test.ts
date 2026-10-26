import { describe, expect, it } from "vitest";
import { confidence, type ConfidenceInput } from "./confidence";

function input(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    agreeingReports: 0,
    disagreeingReports: 0,
    reportsConflict: false,
    sourceDivergenceIn: 0,
    elevationMeters: 1500,
    hoursSinceRain: 24, // between 12 and 72: neither rain factor applies
    tunedReportCount: 0,
    forecastDayOffset: 0,
    // Mid-Prime: 1.74x from both boundaries, so no line-distance factor.
    level: "prime",
    wetness: 0.087,
    ...overrides,
  };
}

describe("confidence", () => {
  it("starts at 60 (medium) with no factors", () => {
    expect(confidence(input())).toEqual({
      score: 60,
      band: "medium",
      factors: [],
    });
  });

  it("adds +20 per agreeing report, capped at +40", () => {
    expect(confidence(input({ agreeingReports: 1 })).score).toBe(80);
    expect(confidence(input({ agreeingReports: 2 })).score).toBe(100);
    const capped = confidence(
      input({ agreeingReports: 3, forecastDayOffset: 2 }),
    );
    expect(capped.score).toBe(80); // 60 + 40 (capped) - 20
    expect(capped.factors).toContainEqual({ id: "riders_agree", delta: 40 });
  });

  it("takes §6.3-weighted (fractional) report counts as-is (M5 decision 5)", () => {
    // A lone half-weight (24–48 h old) agreeing report: +10, not +20.
    const half = confidence(input({ agreeingReports: 0.5 }));
    expect(half.factors).toContainEqual({ id: "riders_agree", delta: 10 });
    // A half-weight disagreeing report: −10.
    const halfDisagree = confidence(input({ disagreeingReports: 0.5 }));
    expect(halfDisagree.factors).toContainEqual({ id: "rider_disagrees", delta: -10 });
  });

  it("subtracts 20 per disagreeing report", () => {
    const one = confidence(input({ disagreeingReports: 1 }));
    expect(one.score).toBe(40);
    expect(one.factors).toContainEqual({ id: "rider_disagrees", delta: -20 });
    expect(confidence(input({ disagreeingReports: 2 })).score).toBe(20);
  });

  it("subtracts 15 when reports disagree with each other", () => {
    const c = confidence(input({ reportsConflict: true }));
    expect(c.score).toBe(45);
    expect(c.factors).toContainEqual({ id: "reports_conflict", delta: -15 });
  });

  it("subtracts 15 only when Stage IV and Open-Meteo differ by more than 0.25 in", () => {
    expect(confidence(input({ sourceDivergenceIn: 0.25 })).score).toBe(60);
    const c = confidence(input({ sourceDivergenceIn: 0.26 }));
    expect(c.score).toBe(45);
    expect(c.factors).toContainEqual({ id: "sources_diverge", delta: -15 });
  });

  it("subtracts 15 only above 2400 m", () => {
    expect(confidence(input({ elevationMeters: 2400 })).score).toBe(60);
    const c = confidence(input({ elevationMeters: 2401 }));
    expect(c.score).toBe(45);
    expect(c.factors).toContainEqual({ id: "high_elevation", delta: -15 });
  });

  it("subtracts 10 under 12 h since rain, adds 10 over 72 h", () => {
    const recent = confidence(input({ hoursSinceRain: 11 }));
    expect(recent.score).toBe(50);
    expect(recent.factors).toContainEqual({ id: "recent_rain", delta: -10 });
    expect(confidence(input({ hoursSinceRain: 12 })).score).toBe(60);
    expect(confidence(input({ hoursSinceRain: 72 })).score).toBe(60);
    const dry = confidence(input({ hoursSinceRain: 73 }));
    expect(dry.score).toBe(70);
    expect(dry.band).toBe("high");
    expect(dry.factors).toContainEqual({ id: "long_dry", delta: 10 });
  });

  it("counts no rain on record as long-dry", () => {
    expect(confidence(input({ hoursSinceRain: null })).score).toBe(70);
  });

  it("adds 10 once the trail is tuned (5+ reports in tau_mult)", () => {
    expect(confidence(input({ tunedReportCount: 4 })).score).toBe(60);
    const c = confidence(input({ tunedReportCount: 5 }));
    expect(c.score).toBe(70);
    expect(c.factors).toContainEqual({ id: "trail_tuned", delta: 10 });
  });

  it("subtracts 10 per forecast day", () => {
    expect(confidence(input({ forecastDayOffset: 1 })).score).toBe(50);
    const dayAfter = confidence(input({ forecastDayOffset: 2 }));
    expect(dayAfter.score).toBe(40);
    expect(dayAfter.factors).toContainEqual({ id: "forecast_day", delta: -20 });
  });

  it("clamps the score to 0–100", () => {
    expect(
      confidence(
        input({ agreeingReports: 2, hoursSinceRain: 100, tunedReportCount: 5 }),
      ).score,
    ).toBe(100);
    expect(
      confidence(
        input({
          disagreeingReports: 3,
          reportsConflict: true,
          elevationMeters: 3000,
          forecastDayOffset: 2,
        }),
      ).score,
    ).toBe(0);
  });

  it("groups bands: High >= 70, Medium 40–69, Low < 40", () => {
    expect(confidence(input({ hoursSinceRain: 100 })).band).toBe("high"); // 70
    expect(confidence(input({ disagreeingReports: 1 })).band).toBe("medium"); // 40
    expect(
      confidence(input({ disagreeingReports: 1, reportsConflict: true })).band,
    ).toBe("low"); // 25
  });

  describe("distance from the line between two levels", () => {
    it("subtracts 20 when wetness is within 15% of a level boundary", () => {
      for (const [level, wetness] of [
        ["prime", 0.052], // just above Dry/Prime (0.05)
        ["prime", 0.14], // just below Prime/Soft (0.15)
        ["soft", 0.16],
        ["muddy", 0.37], // just above Soft/Muddy (0.35)
      ] as const) {
        const c = confidence(input({ level, wetness }));
        expect(c.factors).toContainEqual({ id: "near_line", delta: -20 });
        expect(c.score).toBe(40);
      }
    });

    it("subtracts 10 when it is 15-40% from a boundary", () => {
      const c = confidence(input({ level: "prime", wetness: 0.065 })); // 1.3x
      expect(c.factors).toContainEqual({ id: "close_to_line", delta: -10 });
      expect(c.score).toBe(50);
    });

    it("adds 10 for a call more than 2x from any boundary", () => {
      for (const [level, wetness] of [
        ["dry", 0.01],
        ["dry", 0],
        ["muddy", 0.9],
      ] as const) {
        const c = confidence(input({ level, wetness }));
        expect(c.factors).toContainEqual({ id: "clear_call", delta: 10 });
        expect(c.score).toBe(70);
      }
    });

    it("adds nothing in between", () => {
      expect(confidence(input({ level: "soft", wetness: 0.23 })).factors).toEqual([]);
    });
  });

  it("gives the dry-spell bonus only to Dry and Prime calls", () => {
    expect(confidence(input({ level: "prime", hoursSinceRain: 100 })).factors).toContainEqual({
      id: "long_dry",
      delta: 10,
    });
    for (const [level, wetness] of [
      ["soft", 0.23],
      ["muddy", 0.5],
    ] as const) {
      const c = confidence(input({ level, wetness, hoursSinceRain: 100 }));
      expect(c.factors.map((f) => f.id)).not.toContain("long_dry");
    }
  });

  it("marks snow as an estimate and skips the line-distance factors", () => {
    const c = confidence(input({ level: "snow", wetness: 0.36 }));
    expect(c.factors).toEqual([{ id: "snow_estimate", delta: -10 }]);
    expect(c.score).toBe(50);
  });
});
