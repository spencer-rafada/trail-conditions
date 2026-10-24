import { describe, expect, it } from "vitest";
import { CONFIDENCE, REPORTS } from "./config";
import {
  aggregateReports,
  deviceLimitExceeded,
  ipLimitExceeded,
  rainResetsReport,
  reportAgrees,
  reportWeight,
  type ActiveReport,
  type RainHourSample,
} from "./reports";

const HOUR_MS = 3_600_000;
const NOW = Date.UTC(2026, 9, 23, 15, 30); // mid-hour, so boundaries are exact in hours
const hoursAgo = (h: number) => NOW - h * HOUR_MS;

describe("reportWeight — §6.3 age windows", () => {
  it("full weight for 0–24 h, half for 24–48 h, expired after", () => {
    expect(reportWeight(hoursAgo(0), NOW)).toBe(1);
    expect(reportWeight(hoursAgo(23.99), NOW)).toBe(1);
    expect(reportWeight(hoursAgo(24), NOW)).toBe(REPORTS.halfWeight);
    expect(reportWeight(hoursAgo(47.99), NOW)).toBe(REPORTS.halfWeight);
    expect(reportWeight(hoursAgo(48), NOW)).toBe(0);
    expect(reportWeight(hoursAgo(72), NOW)).toBe(0);
  });

  it("a report from the future carries no weight", () => {
    expect(reportWeight(NOW + HOUR_MS, NOW)).toBe(0);
  });
});

describe("rainResetsReport — §6.3 'new rain resets reports' (decision 3)", () => {
  const report = hoursAgo(10);
  const rain = (endHoursAgo: number, precipIn: number): RainHourSample => ({
    endMs: hoursAgo(endHoursAgo),
    precipIn,
  });

  it("a qualifying rain hour after the report resets it", () => {
    expect(rainResetsReport(report, [rain(2, 0.3)])).toBe(true);
  });

  it("rain before the report does not reset it", () => {
    expect(rainResetsReport(report, [rain(12, 0.3)])).toBe(false);
  });

  it("sub-threshold drizzle does not reset, even repeated", () => {
    expect(rainResetsReport(report, [rain(2, 0.05), rain(3, 0.08)])).toBe(false);
  });

  it("exactly the threshold does not reset (spec says '> 0.1 in'; decision 5a pins the shared CONFIDENCE.rainEventMinIn)", () => {
    expect(rainResetsReport(report, [rain(2, CONFIDENCE.rainEventMinIn)])).toBe(false);
    expect(rainResetsReport(report, [rain(2, CONFIDENCE.rainEventMinIn + 0.01)])).toBe(
      true,
    );
  });

  it("no rain at all never resets", () => {
    expect(rainResetsReport(report, [])).toBe(false);
  });
});

describe("reportAgrees — decision 1: yes agrees, corrections disagree", () => {
  it("maps the three verdicts", () => {
    expect(reportAgrees("yes")).toBe(true);
    expect(reportAgrees("wetter")).toBe(false);
    expect(reportAgrees("drier")).toBe(false);
  });
});

describe("aggregateReports — §6.3 weights into §5 inputs (decision 5)", () => {
  const r = (verdict: ActiveReport["verdict"], ageH: number): ActiveReport => ({
    verdict,
    createdMs: hoursAgo(ageH),
  });

  it("weights agreeing reports: full + half", () => {
    const agg = aggregateReports([r("yes", 2), r("yes", 30)], [], NOW);
    expect(agg.agreeingReports).toBe(1.5);
    expect(agg.disagreeingReports).toBe(0);
    expect(agg.reportsConflict).toBe(false);
  });

  it("weights disagreeing reports the same way", () => {
    const agg = aggregateReports([r("wetter", 30)], [], NOW);
    expect(agg.disagreeingReports).toBe(REPORTS.halfWeight);
    expect(agg.agreeingReports).toBe(0);
  });

  it("drops expired reports entirely", () => {
    const agg = aggregateReports([r("yes", 49), r("wetter", 72)], [], NOW);
    expect(agg).toEqual({
      agreeingReports: 0,
      disagreeingReports: 0,
      reportsConflict: false,
    });
  });

  it("a rain event after a report stops it counting (rain-reset)", () => {
    const rain: RainHourSample[] = [{ endMs: hoursAgo(5), precipIn: 0.5 }];
    // Reported 10 h ago, rained 5 h ago: reset. Reported 2 h ago: still counts.
    const agg = aggregateReports([r("yes", 10), r("yes", 2)], rain, NOW);
    expect(agg.agreeingReports).toBe(1);
  });

  it("conflict only when wetter and drier are both active (decision 2)", () => {
    expect(aggregateReports([r("wetter", 1), r("drier", 2)], [], NOW).reportsConflict).toBe(
      true,
    );
    // yes vs wetter is a model disagreement, not riders contradicting each other
    expect(aggregateReports([r("yes", 1), r("wetter", 2)], [], NOW).reportsConflict).toBe(
      false,
    );
    // an expired "drier" cannot conflict with a live "wetter"
    expect(aggregateReports([r("wetter", 1), r("drier", 50)], [], NOW).reportsConflict).toBe(
      false,
    );
    // a rain-reset "drier" cannot conflict either
    const rain: RainHourSample[] = [{ endMs: hoursAgo(5), precipIn: 0.5 }];
    expect(
      aggregateReports([r("wetter", 1), r("drier", 10)], rain, NOW).reportsConflict,
    ).toBe(false);
  });
});

describe("limit predicates — §6.2", () => {
  it("device: the second report for a trail on the same day is a duplicate", () => {
    expect(deviceLimitExceeded(0)).toBe(false);
    expect(deviceLimitExceeded(REPORTS.maxPerTrailPerDevicePerDay)).toBe(true);
  });

  it("ip hash: the 21st report of the day is over the limit", () => {
    expect(ipLimitExceeded(REPORTS.maxPerIpHashPerDay - 1)).toBe(false);
    expect(ipLimitExceeded(REPORTS.maxPerIpHashPerDay)).toBe(true);
  });
});
