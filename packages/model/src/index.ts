// Pure mud-model functions. The Worker, the backtest, and the tests all
// import from this package — no I/O, no Date.now(), no environment access.

export type Level = "dry" | "prime" | "soft" | "muddy";

// Wetness thresholds from the spec (docs/projects/trail-conditions/spec.md §4.3).
// Starting values; keep every tunable number in this one place.
export const LEVEL_THRESHOLDS = {
  prime: 0.05,
  soft: 0.15,
  muddy: 0.35,
} as const;

export function levelFromWetness(w: number): Level {
  if (w >= LEVEL_THRESHOLDS.muddy) return "muddy";
  if (w >= LEVEL_THRESHOLDS.soft) return "soft";
  if (w >= LEVEL_THRESHOLDS.prime) return "prime";
  return "dry";
}
