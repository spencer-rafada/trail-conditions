// Pure UI helpers (AC5): no DOM, no Date.now() — "now" is always injected.
// Level and confidence semantics come from @trail-conditions/model.

import {
  CONFIDENCE,
  LEVEL_SEVERITY,
  type Confidence,
  type ConfidenceBand,
  type ConditionLevel,
} from "@trail-conditions/model";
import type { ScoredDay, TrailScore } from "./api";

export type Tab = "Salt Lake" | "Utah" | "Wasatch";
export const TABS: readonly Tab[] = ["Salt Lake", "Utah", "Wasatch"];

export const today = (trail: TrailScore): ScoredDay | undefined =>
  trail.days.find((d) => d.offset === 0);

/** Best conditions first: LEVEL_SEVERITY ascending (the spec's own
 *  Dry · Prime · Soft · Muddy · Snow order), then confidence score
 *  descending, then name — deterministic for equal scores. Entries without
 *  a today score sink to the end. Returns a copy. */
export function sortBestFirst(trails: readonly TrailScore[]): TrailScore[] {
  const severity = (trail: TrailScore): number => {
    const day = today(trail);
    return day ? LEVEL_SEVERITY[day.level] : Number.MAX_SAFE_INTEGER;
  };
  const score = (trail: TrailScore): number => today(trail)?.confidence.score ?? 0;
  return [...trails].sort(
    (a, b) =>
      severity(a) - severity(b) ||
      score(b) - score(a) ||
      a.name.localeCompare(b.name),
  );
}

/** "12 min ago" / "2 h ago" / "1 d ago"; under a minute (or a timestamp
 *  ahead of the injected now, clock skew) is "just now". */
export function updatedAgo(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

// Chips render white text at ~12.5–16px, so every background must keep
// WCAG AA 4.5:1 against white (ratios below computed with WCAG relative
// luminance; the unit test re-derives them).
const LEVEL_COLORS: Record<ConditionLevel, string> = {
  dry: "#8a6a2f", // tan/brown, white 5.02:1
  prime: "#2e7d32", // white 5.13:1
  soft: "#b35a00", // orange, white 4.80:1
  muddy: "#b3261e", // white 6.54:1
  snow: "#2b6cb0", // white 5.42:1
};

const LEVEL_LABELS: Record<ConditionLevel, string> = {
  dry: "Dry",
  prime: "Prime",
  soft: "Soft",
  muddy: "Muddy",
  snow: "Snow",
};

export function levelColor(level: ConditionLevel): string {
  return LEVEL_COLORS[level];
}

export function levelLabel(level: ConditionLevel): string {
  return LEVEL_LABELS[level];
}

// One-character marks for map pins, so a pin never relies on color alone.
const LEVEL_SYMBOLS: Record<ConditionLevel, string> = {
  dry: "D",
  prime: "P",
  soft: "S",
  muddy: "M",
  snow: "❄",
};

export function levelSymbol(level: ConditionLevel): string {
  return LEVEL_SYMBOLS[level];
}

/** Display casing for the model's confidence bands. */
export const BAND_LABELS: Record<ConfidenceBand, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** "Rideable now" = today's level is dry or prime (ticket decision: soft is
 *  marginal, and the disclaimer tells riders to stay off muddy trails). */
export function isRideable(trail: TrailScore): boolean {
  const day = today(trail);
  return day !== undefined && (day.level === "dry" || day.level === "prime");
}

const TAB_BY_COUNTY: Record<string, Tab> = {
  "Salt Lake County": "Salt Lake",
  "Utah County": "Utah",
  "Wasatch County": "Wasatch",
};

/** Null = the trail can't be placed on a tab (missing or unexpected county,
 *  e.g. a snapshot entry scored before the county field existed). */
export function tabForCounty(county: string | undefined): Tab | null {
  return county === undefined ? null : (TAB_BY_COUNTY[county] ?? null);
}

/** The explore view framed on this county (Home's ?tab= jump); null when
 *  the county isn't one of the three. */
export function countyExploreHref(county: string | null | undefined): string | null {
  const tab = tabForCounty(county ?? undefined);
  return tab ? `/?${new URLSearchParams({ tab }).toString()}` : null;
}

// --- Verdict: the plain answer to "can I ride it?" ---------------------
// Follows "Rideable now": dry/prime ride, soft is marginal, muddy and snow
// are off (the disclaimer asks riders to stay off muddy trails).

export type Verdict = "ride" | "care" | "off";

export function verdictFor(level: ConditionLevel): Verdict {
  if (level === "dry" || level === "prime") return "ride";
  if (level === "soft") return "care";
  return "off";
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  ride: "Rideable",
  care: "Ride with care",
  off: "Stay off",
};

export const VERDICT_ICONS: Record<Verdict, string> = { ride: "✓", care: "!", off: "✕" };

/** Short ground description after the level name, only where it adds
 *  something: "Prime (tacky)", but plain "Muddy". */
export const LEVEL_DETAILS: Partial<Record<ConditionLevel, string>> = {
  dry: "firm, can be dusty",
  prime: "tacky",
  soft: "soft spots",
};

// --- Confidence: a score out of 100 with words, never a bare percent ----
// It is how sure the estimate is, not a chance of being dry, so it reads
// "72/100" (a % next to a forecast reads as a probability).

export const BAND_WORDS: Record<ConfidenceBand, string> = {
  high: "likely right",
  medium: "could be off",
  low: "rough estimate",
};

/** What each factor means to a rider, from the model's own numbers. */
export function factorText(factor: Confidence["factors"][number]): string {
  switch (factor.id) {
    case "riders_agree": {
      const n = Math.floor(factor.delta / CONFIDENCE.agreePerReport);
      return n > 0 ? `${n} rider${n === 1 ? "" : "s"} confirmed today` : "A rider confirmed recently";
    }
    case "rider_disagrees": {
      const n = Math.max(1, Math.round(factor.delta / CONFIDENCE.disagreePenalty));
      return `${n} rider${n === 1 ? "" : "s"} reported different conditions`;
    }
    case "reports_conflict":
      return "Rider reports disagree";
    case "sources_diverge":
      return "Radar and forecast disagree on recent rain";
    case "high_elevation":
      return "High elevation: radar sees less here";
    case "recent_rain":
      return `Rain in the last ${CONFIDENCE.recentRainMaxHours} h: still changing`;
    case "long_dry":
      return `No real rain in ${CONFIDENCE.longDryMinHours / 24}+ days`;
    case "trail_tuned":
      return "Drying speed tuned by rider reports";
    case "forecast_day":
      return "Forecast day: less certain";
    case "near_line":
      return "Right on the edge of the next level: could go either way";
    case "close_to_line":
      return "Close to the next level";
    case "clear_call":
      return "Clearly this level, not close to another";
    case "snow_estimate":
      return "Snow is estimated from the forecast";
  }
}

/** The two facts that move the score most (riders first), for a card. */
export function topReasons(conf: Confidence, n = 2): { text: string; good: boolean }[] {
  return [...conf.factors]
    .filter((f) => f.id !== "forecast_day")
    .sort(
      (a, b) =>
        Number(b.id === "riders_agree") - Number(a.id === "riders_agree") ||
        Math.abs(b.delta) - Math.abs(a.delta),
    )
    .slice(0, n)
    .map((f) => ({ text: factorText(f), good: f.delta > 0 }));
}

export interface BreakdownRow {
  text: string;
  delta: number;
}

/** Start + each factor = score, for the trail page. `capped` says the sum
 *  went past 0–100 and the score was clamped. */
export function confidenceBreakdown(conf: Confidence): {
  start: number;
  rows: BreakdownRow[];
  score: number;
  capped: boolean;
} {
  const rows = conf.factors.map((f) => ({ text: factorText(f), delta: f.delta }));
  const sum = rows.reduce<number>((t, r) => t + r.delta, CONFIDENCE.start);
  return { start: CONFIDENCE.start, rows, score: conf.score, capped: sum !== conf.score };
}

/** Rider count behind "✔ N riders confirmed today", from the riders_agree
 *  confidence factor (delta = weighted count * agreePerReport, capped
 *  upstream). Floored, not rounded (M5 decision 4): a lone half-weight
 *  (24–48 h old) report must not read as a rider confirmed *today*. */
export function ridersConfirmed(conf: Confidence): number {
  const factor = conf.factors.find((f) => f.id === "riders_agree");
  return factor ? Math.floor(factor.delta / CONFIDENCE.agreePerReport) : 0;
}
