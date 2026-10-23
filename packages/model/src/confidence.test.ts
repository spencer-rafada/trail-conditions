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
});
