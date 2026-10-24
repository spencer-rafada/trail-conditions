import { describe, expect, it } from "vitest";
import {
  CONFIDENCE,
  type Confidence,
  type ConditionLevel,
} from "@trail-conditions/model";
import type { TrailScore } from "./api";
import {
  isRideable,
  levelColor,
  levelLabel,
  ridersConfirmed,
  sortBestFirst,
  tabForCounty,
  updatedAgo,
} from "./helpers";

const NOW = Date.UTC(2026, 9, 23, 15, 0);

function trail(
  id: string,
  level: ConditionLevel,
  confidenceScore = 60,
  county?: string,
): TrailScore {
  return {
    id,
    name: id,
    ...(county !== undefined && { county }),
    days: [
      {
        offset: 0,
        level,
        wetness: 0.1,
        worst_point: "Trailhead",
        confidence: { score: confidenceScore, band: "medium", factors: [] },
      },
    ],
    scored_utc: new Date(NOW).toISOString(),
  };
}

describe("sortBestFirst (AC: best conditions first)", () => {
  it("orders dry → prime → soft → muddy → snow (LEVEL_SEVERITY ascending)", () => {
    const input = [
      trail("s", "snow"),
      trail("m", "muddy"),
      trail("d", "dry"),
      trail("so", "soft"),
      trail("p", "prime"),
    ];
    expect(sortBestFirst(input).map((t) => t.days[0]!.level)).toEqual([
      "dry",
      "prime",
      "soft",
      "muddy",
      "snow",
    ]);
  });

  it("breaks a level tie by confidence score, highest first, then by name", () => {
    const input = [
      trail("b-low", "prime", 40),
      trail("c-high", "prime", 80),
      trail("a-low", "prime", 40),
    ];
    expect(sortBestFirst(input).map((t) => t.id)).toEqual(["c-high", "a-low", "b-low"]);
  });

  it("does not mutate its input and sinks entries without a today score", () => {
    const noToday: TrailScore = { ...trail("x", "dry"), days: [] };
    const input = [noToday, trail("d", "muddy")];
    expect(sortBestFirst(input).map((t) => t.id)).toEqual(["d", "x"]);
    expect(input.map((t) => t.id)).toEqual(["x", "d"]);
  });
});

describe("updatedAgo (AC: 'Updated N min ago')", () => {
  const at = (msAgo: number) => updatedAgo(new Date(NOW - msAgo).toISOString(), NOW);

  it("formats minutes, hours, and days from the injected now", () => {
    expect(at(30_000)).toBe("just now");
    expect(at(12 * 60_000)).toBe("12 min ago");
    expect(at(2 * 3_600_000 + 5 * 60_000)).toBe("2 h ago");
    expect(at(26 * 3_600_000)).toBe("1 d ago");
  });

  it("treats a timestamp slightly in the future (clock skew) as just now", () => {
    expect(at(-60_000)).toBe("just now");
  });
});

describe("level colors and labels (AC: level color per card)", () => {
  const LEVELS: ConditionLevel[] = ["dry", "prime", "soft", "muddy", "snow"];

  it("maps all five condition levels to five distinct hex colors", () => {
    const colors = LEVELS.map(levelColor);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(colors).size).toBe(5);
  });

  it("labels all five levels with the spec's names", () => {
    expect(LEVELS.map(levelLabel)).toEqual(["Dry", "Prime", "Soft", "Muddy", "Snow"]);
  });

  // The chips render white text (~12.5–16px, not large text), so every level
  // background must hit WCAG AA 4.5:1 against white.
  it("keeps white chip text at AA contrast (>= 4.5:1) on every level color", () => {
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const level of LEVELS) {
      // white is the lighter color, so the ratio is (Lwhite + 0.05) / (Lbg + 0.05)
      const ratio = (1 + 0.05) / (luminance(levelColor(level)) + 0.05);
      expect(ratio, `white on ${level} ${levelColor(level)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("isRideable (AC: 'Rideable now' filter)", () => {
  it("counts dry and prime today as rideable; soft, muddy, and snow not", () => {
    expect(isRideable(trail("a", "dry"))).toBe(true);
    expect(isRideable(trail("b", "prime"))).toBe(true);
    expect(isRideable(trail("c", "soft"))).toBe(false);
    expect(isRideable(trail("d", "muddy"))).toBe(false);
    expect(isRideable(trail("e", "snow"))).toBe(false);
  });

  it("a trail without a today entry is not rideable", () => {
    expect(isRideable({ ...trail("x", "dry"), days: [] })).toBe(false);
  });
});

describe("tabForCounty", () => {
  it("maps the three seeded counties to their tabs and everything else to null", () => {
    expect(tabForCounty("Salt Lake County")).toBe("Salt Lake");
    expect(tabForCounty("Utah County")).toBe("Utah");
    expect(tabForCounty("Wasatch County")).toBe("Wasatch");
    expect(tabForCounty(undefined)).toBeNull();
    expect(tabForCounty("Summit County")).toBeNull();
  });
});

describe("ridersConfirmed", () => {
  const conf = (factors: Confidence["factors"]): Confidence => ({
    score: 60,
    band: "medium",
    factors,
  });

  it("derives the rider count from the riders_agree delta", () => {
    expect(ridersConfirmed(conf([]))).toBe(0);
    expect(
      ridersConfirmed(conf([{ id: "riders_agree", delta: CONFIDENCE.agreePerReport * 2 }])),
    ).toBe(2);
    expect(ridersConfirmed(conf([{ id: "long_dry", delta: 10 }]))).toBe(0);
  });

  it("floors a half-weight delta so yesterday's report can't claim 'today' (M5 decision 4)", () => {
    // A lone 24–48 h-old agreeing report contributes delta 10 (half weight):
    // not a rider confirmed *today*, so the count must floor to 0.
    expect(
      ridersConfirmed(conf([{ id: "riders_agree", delta: CONFIDENCE.agreePerReport / 2 }])),
    ).toBe(0);
    expect(
      ridersConfirmed(conf([{ id: "riders_agree", delta: CONFIDENCE.agreePerReport * 1.5 }])),
    ).toBe(1);
  });

  it("a capped delta reads as the capped rider count", () => {
    expect(
      ridersConfirmed(conf([{ id: "riders_agree", delta: CONFIDENCE.agreeMaxBonus }])),
    ).toBe(CONFIDENCE.agreeMaxBonus / CONFIDENCE.agreePerReport);
  });
});
