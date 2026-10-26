import { describe, expect, it } from "vitest";
import { calibrateByBand } from "./calibration";

describe("calibrateByBand", () => {
  it("groups reports by the confidence band at report time and counts Yes as a match", () => {
    const result = calibrateByBand([
      { confidence: 80, verdict: "yes" },
      { confidence: 75, verdict: "yes" },
      { confidence: 70, verdict: "wetter" },
      { confidence: 50, verdict: "yes" },
      { confidence: 45, verdict: "drier" },
      { confidence: 20, verdict: "wetter" },
      { confidence: null, verdict: "yes" },
    ]);
    expect(result.bands.high).toEqual({ reports: 3, matched: 2, matchRate: 2 / 3 });
    expect(result.bands.medium).toEqual({ reports: 2, matched: 1, matchRate: 0.5 });
    expect(result.bands.low).toEqual({ reports: 1, matched: 0, matchRate: 0 });
    expect(result.unscored).toBe(1);
  });

  it("reports no rate, not 0%, for a band without reports", () => {
    expect(calibrateByBand([]).bands.high).toEqual({ reports: 0, matched: 0, matchRate: null });
  });
});
