// Wire types for the worker's JSON plus thin fetch wrappers. The snapshot
// shape is produced by apps/worker/src/snapshot.ts (its header calls the
// JSON "M4's input contract") and /api/trails/:id is documented in
// apps/worker/src/trail-detail.ts. The types are redeclared here because
// apps/web must not import from apps/worker (the worker type-checks against
// @cloudflare/workers-types); level and confidence types come from the
// shared model package.

import type { Confidence, ConditionLevel } from "@trail-conditions/model";

export interface ScoredDay {
  /** 0 = now, 1 = tomorrow, 2 = day after. */
  offset: 0 | 1 | 2;
  level: ConditionLevel;
  note?: string;
  wetness: number;
  worst_point: string;
  confidence: Confidence;
}

export interface TrailScore {
  id: string;
  name: string;
  /** Absent on entries scored before the field existed. */
  county?: string;
  days: ScoredDay[];
  scored_utc: string;
}

export interface Snapshot {
  updated_utc: string | null;
  trails: Record<string, TrailScore>;
}

export type SoilLabel = "sandy" | "clay" | "loam";

export interface TrailDetail {
  id: string;
  name: string;
  county: string | null;
  /** tau_base_h * tau_mult, hours. */
  drying_hours: number | null;
  /** null = no soil survey data for this trail's points. */
  soil: SoilLabel | null;
  /** [] until the score job has covered this trail. */
  days: ScoredDay[];
  scored_utc: string | null;
  /** null = no rain at or above the model's rain threshold in the cached
   *  history (the normal dry-spell state). */
  last_rain: { ts_utc: string; precip_in: number } | null;
  reports_since_rain: number;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchScores = (): Promise<Snapshot> => getJson<Snapshot>("/api/scores");

export const fetchTrail = (id: string): Promise<TrailDetail> =>
  getJson<TrailDetail>(`/api/trails/${encodeURIComponent(id)}`);
