import { describe, expect, it } from "vitest";
import { tauBase, tauTrail, type SoilProfile } from "./tau";

function soil(overrides: Partial<SoilProfile> = {}): SoilProfile {
  return {
    sandPct: 40,
    clayPct: 20,
    fragGt10Pct: 0,
    frag3to10Pct: 0,
    hydrologicGroup: "B",
    ...overrides,
  };
}

describe("tauBase", () => {
  it("gives sandy soil 12 h at the 60% boundary", () => {
    expect(tauBase(soil({ sandPct: 60 }))).toBe(12);
    expect(tauBase(soil({ sandPct: 59.9 }))).toBe(24);
  });

  it("gives clayey soil 48 h at the 30% boundary", () => {
    expect(tauBase(soil({ clayPct: 30 }))).toBe(48);
    expect(tauBase(soil({ clayPct: 29.9 }))).toBe(24);
  });

  it("prefers the sand rule when both sand and clay qualify", () => {
    expect(tauBase(soil({ sandPct: 60, clayPct: 30 }))).toBe(12);
  });

  it("defaults to 24 h", () => {
    expect(tauBase(soil())).toBe(24);
  });

  it("applies the rock-fragment x0.75 at the summed 15% boundary", () => {
    expect(tauBase(soil({ fragGt10Pct: 10, frag3to10Pct: 5 }))).toBe(18);
    expect(tauBase(soil({ fragGt10Pct: 10, frag3to10Pct: 4.9 }))).toBe(24);
  });

  it("applies hydrologic group multipliers (D x1.2, A x0.8, others none)", () => {
    expect(tauBase(soil({ hydrologicGroup: "D" }))).toBeCloseTo(28.8, 10);
    expect(tauBase(soil({ hydrologicGroup: "A" }))).toBeCloseTo(19.2, 10);
    expect(tauBase(soil({ hydrologicGroup: "C" }))).toBe(24);
  });

  it("uses the drained (first) letter of a dual group like A/D", () => {
    expect(tauBase(soil({ hydrologicGroup: "A/D" }))).toBeCloseTo(19.2, 10);
  });

  it("stacks multipliers on the base", () => {
    // sand 70 -> 12, frags 20 -> x0.75, group A -> x0.8
    expect(
      tauBase(
        soil({
          sandPct: 70,
          fragGt10Pct: 15,
          frag3to10Pct: 5,
          hydrologicGroup: "A",
        }),
      ),
    ).toBeCloseTo(7.2, 10);
  });

  it("treats missing soil data as the default branch, no multipliers", () => {
    expect(
      tauBase({
        sandPct: null,
        clayPct: null,
        fragGt10Pct: null,
        frag3to10Pct: null,
        hydrologicGroup: null,
      }),
    ).toBe(24);
  });
});

describe("tauTrail", () => {
  it("multiplies tauBase by tau_mult, default 1.0", () => {
    expect(tauTrail(soil())).toBe(24);
    expect(tauTrail(soil(), 1.5)).toBe(36);
    expect(tauTrail(soil({ sandPct: 60 }), 0.5)).toBe(6);
  });
});
