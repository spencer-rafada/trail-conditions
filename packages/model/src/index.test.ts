import { describe, expect, it } from "vitest";
import { levelFromWetness } from "./index";

describe("levelFromWetness", () => {
  it("maps wetness to the spec's levels", () => {
    expect(levelFromWetness(0)).toBe("dry");
    expect(levelFromWetness(0.04)).toBe("dry");
    expect(levelFromWetness(0.05)).toBe("prime");
    expect(levelFromWetness(0.14)).toBe("prime");
    expect(levelFromWetness(0.15)).toBe("soft");
    expect(levelFromWetness(0.34)).toBe("soft");
    expect(levelFromWetness(0.35)).toBe("muddy");
    expect(levelFromWetness(2)).toBe("muddy");
  });
});
