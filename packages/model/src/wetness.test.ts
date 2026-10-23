import { describe, expect, it } from "vitest";
import { WETNESS } from "./config";
import { tauEff, walkWetness } from "./wetness";

describe("tauEff", () => {
  it("leaves tau unchanged at or above 55 °F", () => {
    expect(tauEff(24, 55)).toBe(24);
    expect(tauEff(24, 80)).toBe(24);
  });

  it("slows drying below 55 °F: tau * (1 + (55 - tempF) / 10)", () => {
    expect(tauEff(24, 45)).toBeCloseTo(48, 10); // (1 + 10/10) = 2
    expect(tauEff(24, 54)).toBeCloseTo(26.4, 10); // (1 + 1/10) = 1.1
    expect(tauEff(12, 25)).toBeCloseTo(48, 10); // (1 + 30/10) = 4
  });
});

describe("walkWetness", () => {
  it("returns the initial wetness for an empty hour list", () => {
    expect(walkWetness([], 24, 0.2)).toBe(0.2);
    expect(walkWetness([], 24)).toBe(0);
  });

  it("decays one warm dry hour by exp(-1/tau)", () => {
    // 0.2 * exp(-1/24) = 0.19183789...
    expect(walkWetness([{ tempF: 70, precipIn: 0 }], 24, 0.2)).toBeCloseTo(
      0.2 * Math.exp(-1 / 24),
      12,
    );
  });

  it("decays slower in the cold", () => {
    const warm = walkWetness([{ tempF: 70, precipIn: 0 }], 24, 0.2);
    const cold = walkWetness([{ tempF: 45, precipIn: 0 }], 24, 0.2);
    expect(cold).toBeCloseTo(0.2 * Math.exp(-1 / 48), 12);
    expect(cold).toBeGreaterThan(warm);
  });

  it("adds precipitation after the decay, per the §4.2 formula", () => {
    // w = 0.1 * exp(-1/24) + 0.2 = 0.29591894...; the wrong order
    // ((0.1 + 0.2) * exp(-1/24)) would give 0.28775...
    expect(walkWetness([{ tempF: 70, precipIn: 0.2 }], 24, 0.1)).toBeCloseTo(
      0.1 * Math.exp(-1 / 24) + 0.2,
      12,
    );
  });

  it("walks hours in order, past and future alike", () => {
    // Hour 1: 0 * exp(-1/24) + 0.3 = 0.3; hour 2: 0.3 * exp(-1/48) + 0
    const result = walkWetness(
      [
        { tempF: 70, precipIn: 0.3 },
        { tempF: 45, precipIn: 0 },
      ],
      24,
    );
    expect(result).toBeCloseTo(0.3 * Math.exp(-1 / 48), 12);
  });

  it("keeps the 240 h window as the configured constant", () => {
    expect(WETNESS.windowHours).toBe(240);
  });
});
