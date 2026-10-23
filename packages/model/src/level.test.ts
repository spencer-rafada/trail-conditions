import { describe, expect, it } from "vitest";
import { FREEZE_NOTE } from "./config";
import {
  pointCondition,
  worstPoint,
  type PointConditionInput,
  type PointCondition,
} from "./level";

function input(overrides: Partial<PointConditionInput> = {}): PointConditionInput {
  return {
    wetness: 0.1,
    tempF: 60,
    snowfall48hIn: 0,
    snowDepth: 0,
    ...overrides,
  };
}

describe("pointCondition", () => {
  it("maps wetness to a level when no override applies", () => {
    expect(pointCondition(input({ wetness: 0.4 }))).toEqual({ level: "muddy" });
    expect(pointCondition(input({ wetness: 0.1 }))).toEqual({ level: "prime" });
    expect(pointCondition(input({ wetness: 0.01 }))).toEqual({ level: "dry" });
  });

  it("overrides to snow when 48 h snowfall reaches 0.5 in", () => {
    expect(pointCondition(input({ snowfall48hIn: 0.5 })).level).toBe("snow");
    expect(pointCondition(input({ snowfall48hIn: 0.49 })).level).toBe("prime");
  });

  it("overrides to snow when snow depth is above zero", () => {
    expect(pointCondition(input({ snowDepth: 0.01 })).level).toBe("snow");
    expect(pointCondition(input({ snowDepth: 0 })).level).toBe("prime");
  });

  it("adds the freeze note when temp < 32 °F and w >= 0.15", () => {
    const frozen = pointCondition(input({ tempF: 31, wetness: 0.15 }));
    expect(frozen.level).toBe("soft");
    expect(frozen.note).toBe(FREEZE_NOTE);
  });

  it("adds no freeze note at 32 °F or when w < 0.15", () => {
    expect(pointCondition(input({ tempF: 32, wetness: 0.2 })).note).toBeUndefined();
    expect(pointCondition(input({ tempF: 31, wetness: 0.14 })).note).toBeUndefined();
  });
});

describe("worstPoint", () => {
  const point = (name: string, condition: PointCondition) => ({ name, condition });

  it("picks the most severe point and names its section", () => {
    const worst = worstPoint([
      point("Trailhead", { level: "prime" }),
      point("Summit", { level: "muddy" }),
      point("Mid", { level: "soft" }),
    ]);
    expect(worst.name).toBe("Summit");
    expect(worst.condition.level).toBe("muddy");
  });

  it("ranks snow above muddy", () => {
    const worst = worstPoint([
      point("Trailhead", { level: "muddy" }),
      point("Summit", { level: "snow" }),
    ]);
    expect(worst.name).toBe("Summit");
  });

  it("keeps the earliest point on a tie", () => {
    const worst = worstPoint([
      point("Trailhead", { level: "soft" }),
      point("Summit", { level: "soft" }),
    ]);
    expect(worst.name).toBe("Trailhead");
  });

  it("throws on an empty point list", () => {
    expect(() => worstPoint([])).toThrow();
  });
});
