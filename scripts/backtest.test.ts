import { describe, expect, it } from "vitest";
import { buildBacktestTable, loadCaseFixtures } from "./backtest";
import { CASES } from "./backtest-cases";

describe("backtest (spec §4.4, from committed fixtures)", () => {
  it("reproduces the v3-result column exactly, including the known misses", () => {
    const fixtures = new Map(
      [...new Set(CASES.map((c) => c.point.slug))].map((slug) => [
        slug,
        loadCaseFixtures(slug),
      ]),
    );
    const rows = buildBacktestTable(fixtures);

    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.computed)).toEqual([
      "muddy", // Wasatch Crest 2026-10-17
      "muddy", // Wasatch Crest 2026-10-18
      "prime", // Wasatch Crest 2026-10-21
      "soft", // Spinal Tap 2026-10-18
      "dry", // JEM 2026-10-19 (known miss: riders said Muddy)
      "muddy", // Butterfield 2026-08-29
      "muddy", // Deer Valley 2026-09-19 (known miss: riders said Hero dirt)
      "prime", // Lehi's Dream 2026-05-01
    ]);
    for (const row of rows) {
      expect(row.computed).toBe(row.expected);
    }
  });
});
