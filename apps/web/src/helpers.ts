// Pure UI helpers (AC5): no DOM, no Date.now() — "now" is always injected.
// Level and confidence semantics come from @trail-conditions/model.

import {
  CONFIDENCE,
  LEVEL_SEVERITY,
  type Confidence,
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

const LEVEL_COLORS: Record<ConditionLevel, string> = {
  dry: "#a07c3e",
  prime: "#2e7d32",
  soft: "#e07b26",
  muddy: "#b3261e",
  snow: "#2b6cb0",
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

/** Rider count behind "✔ N riders confirmed today", from the riders_agree
 *  confidence factor (delta = count * agreePerReport, capped upstream). */
export function ridersConfirmed(conf: Confidence): number {
  const factor = conf.factors.find((f) => f.id === "riders_agree");
  return factor ? Math.round(factor.delta / CONFIDENCE.agreePerReport) : 0;
}
