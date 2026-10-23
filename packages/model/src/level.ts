// Levels, overrides, and the worst-point rule, spec §4.3.

import {
  FREEZE_NOTE,
  LEVEL_SEVERITY,
  LEVEL_THRESHOLDS,
  OVERRIDES,
} from "./config";

export type Level = "dry" | "prime" | "soft" | "muddy";
export type ConditionLevel = Level | "snow";

export function levelFromWetness(w: number): Level {
  if (w >= LEVEL_THRESHOLDS.muddy) return "muddy";
  if (w >= LEVEL_THRESHOLDS.soft) return "soft";
  if (w >= LEVEL_THRESHOLDS.prime) return "prime";
  return "dry";
}

export interface PointConditionInput {
  /** Wetness w at the report hour, from the walk. */
  wetness: number;
  /** Temperature at the report hour, °F. */
  tempF: number;
  /** Total snowfall over the last OVERRIDES.snowfallWindowHours, inches. */
  snowfall48hIn: number;
  /** Snow depth at the point at the report hour; > 0 triggers Snow. */
  snowDepthMeters: number;
}

export interface PointCondition {
  level: ConditionLevel;
  note?: string;
}

export function pointCondition(input: PointConditionInput): PointCondition {
  const snow =
    input.snowfall48hIn >= OVERRIDES.snowfallMinIn || input.snowDepthMeters > 0;
  const level: ConditionLevel = snow ? "snow" : levelFromWetness(input.wetness);

  const frozen =
    input.tempF < OVERRIDES.freezeTempF &&
    input.wetness >= OVERRIDES.freezeWetnessMin;

  return frozen ? { level, note: FREEZE_NOTE } : { level };
}

export interface NamedPointCondition {
  /** Which section of the trail this sample point represents. */
  name: string;
  condition: PointCondition;
}

/** Spec §4.3: a trail with several sample points shows the worst point,
 *  and which section is worst. Ties keep the earliest point. */
export function worstPoint(
  points: readonly NamedPointCondition[],
): NamedPointCondition {
  let worst = points[0];
  if (!worst) throw new Error("worstPoint needs at least one sample point");
  for (const point of points) {
    if (
      LEVEL_SEVERITY[point.condition.level] >
      LEVEL_SEVERITY[worst.condition.level]
    ) {
      worst = point;
    }
  }
  return worst;
}
