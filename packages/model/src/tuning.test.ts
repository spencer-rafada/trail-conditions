// Pins the §6.4 tuning rule and ticket C-20261023-M6 decision 1 ("many" =
// strict majority of the window's reports, 'yes' counts toward n).

import { describe, expect, it } from "vitest";
import { TUNING } from "./config";
import { tuneTauMult, type TuningReport } from "./tuning";
import type { ReportVerdict } from "./reports";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.UTC(2026, 9, 23, 10, 0);

const report = (verdict: ReportVerdict, ageHours = 5): TuningReport => ({
  verdict,
  createdMs: NOW - ageHours * HOUR_MS,
});

const many = (verdict: ReportVerdict, count: number): TuningReport[] =>
  Array.from({ length: count }, () => report(verdict));

describe("TUNING constants", () => {
  it("carries the §6.4 numbers", () => {
    expect(TUNING).toEqual({
      windowDays: 30,
      minReports: 3,
      raiseStep: 1.1,
      lowerStep: 0.9,
      multMin: 0.5,
      multMax: 3.0,
    });
  });
});

describe("tuneTauMult — steps", () => {
  it("raises ×1.1 on a wetter strict majority ('yes' counts toward n)", () => {
    const result = tuneTauMult(1.0, [...many("wetter", 2), report("yes")], NOW);
    expect(result.newMult).toBeCloseTo(1.1, 12);
    expect(result.nReports).toBe(3);
  });

  it("lowers ×0.9 on a drier strict majority", () => {
    const result = tuneTauMult(2.0, [...many("drier", 2), report("yes")], NOW);
    expect(result.newMult).toBeCloseTo(1.8, 12);
    expect(result.nReports).toBe(3);
  });

  it("steps from the current multiplier, not from 1.0", () => {
    const result = tuneTauMult(1.21, many("wetter", 3), NOW);
    expect(result.newMult).toBeCloseTo(1.331, 12);
  });
});

describe("tuneTauMult — 'many' is a strict majority (decision 1)", () => {
  it("does not change on exactly half (2 wetter of 4)", () => {
    const result = tuneTauMult(1.0, [...many("wetter", 2), ...many("yes", 2)], NOW);
    expect(result.newMult).toBeNull();
    expect(result.nReports).toBe(4);
  });

  it("changes just past half (3 wetter of 5)", () => {
    const result = tuneTauMult(1.0, [...many("wetter", 3), ...many("yes", 2)], NOW);
    expect(result.newMult).toBeCloseTo(1.1, 12);
    expect(result.nReports).toBe(5);
  });

  it("does not change on a wetter/drier tie", () => {
    const result = tuneTauMult(1.0, [...many("wetter", 3), ...many("drier", 3)], NOW);
    expect(result.newMult).toBeNull();
    expect(result.nReports).toBe(6);
  });

  it("does not change when no direction has a majority", () => {
    const reports = [report("wetter"), report("drier"), report("yes")];
    expect(tuneTauMult(1.0, reports, NOW)).toEqual({ newMult: null, nReports: 3 });
  });
});

describe("tuneTauMult — 3-report floor", () => {
  it("does not change below 3 reports, even unanimous", () => {
    expect(tuneTauMult(1.0, many("wetter", 2), NOW)).toEqual({
      newMult: null,
      nReports: 2,
    });
  });

  it("changes at exactly 3 reports", () => {
    const result = tuneTauMult(1.0, many("wetter", 3), NOW);
    expect(result.newMult).toBeCloseTo(1.1, 12);
    expect(result.nReports).toBe(3);
  });
});

describe("tuneTauMult — 30-day window", () => {
  it("counts a report exactly 30 days old", () => {
    const reports = Array.from({ length: 3 }, () => ({
      verdict: "wetter" as const,
      createdMs: NOW - 30 * DAY_MS,
    }));
    const result = tuneTauMult(1.0, reports, NOW);
    expect(result.newMult).toBeCloseTo(1.1, 12);
    expect(result.nReports).toBe(3);
  });

  it("ignores a report older than 30 days (drops n below the floor)", () => {
    const reports = [
      ...many("wetter", 2),
      { verdict: "wetter" as const, createdMs: NOW - 30 * DAY_MS - 1 },
    ];
    expect(tuneTauMult(1.0, reports, NOW)).toEqual({ newMult: null, nReports: 2 });
  });

  it("ignores a report from the future (clock skew)", () => {
    const reports = [
      ...many("wetter", 2),
      { verdict: "wetter" as const, createdMs: NOW + 1 },
    ];
    expect(tuneTauMult(1.0, reports, NOW)).toEqual({ newMult: null, nReports: 2 });
  });
});

describe("tuneTauMult — 0.5–3.0 clamp", () => {
  it("clamps a raise to 3.0", () => {
    const result = tuneTauMult(2.9, many("wetter", 3), NOW);
    expect(result.newMult).toBe(3.0);
  });

  it("clamps a lower to 0.5", () => {
    const result = tuneTauMult(0.52, many("drier", 3), NOW);
    expect(result.newMult).toBe(0.5);
  });

  it("reports no change when already at the max (nothing to log)", () => {
    expect(tuneTauMult(3.0, many("wetter", 3), NOW)).toEqual({
      newMult: null,
      nReports: 3,
    });
  });

  it("reports no change when already at the min", () => {
    expect(tuneTauMult(0.5, many("drier", 3), NOW)).toEqual({
      newMult: null,
      nReports: 3,
    });
  });
});
