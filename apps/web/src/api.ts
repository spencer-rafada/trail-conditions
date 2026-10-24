// Wire types for the worker's JSON plus thin fetch wrappers. The snapshot
// shape is produced by apps/worker/src/snapshot.ts (its header calls the
// JSON "M4's input contract") and /api/trails/:id is documented in
// apps/worker/src/trail-detail.ts. The types are redeclared here because
// apps/web must not import from apps/worker (the worker type-checks against
// @cloudflare/workers-types); level and confidence types come from the
// shared model package.

import type { Confidence, ConditionLevel, ReportVerdict } from "@trail-conditions/model";

export interface ScoredDay {
  /** 0 = now, 1 = tomorrow, 2 = day after. */
  offset: 0 | 1 | 2;
  level: ConditionLevel;
  note?: string;
  wetness: number;
  worst_point: string;
  confidence: Confidence;
}

/** One map pin (a trail sample point), Trailhead first. */
export interface TrailPin {
  label: string;
  lat: number;
  lon: number;
}

export interface TrailScore {
  id: string;
  name: string;
  /** Absent on entries scored before the field existed. */
  county?: string;
  days: ScoredDay[];
  scored_utc: string;
  /** Absent until the worker that sends pins is deployed and has rescored
   *  the trail; the map hides itself when no trail has pins. */
  points?: TrailPin[];
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
  /** Absent from workers deployed before map pins existed. */
  points?: TrailPin[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" }, ...init });
  if (!res.ok) throw new ApiError(res.status, `GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchScores = (): Promise<Snapshot> => getJson<Snapshot>("/api/scores");

/** `fresh: true` bypasses the browser's HTTP cache (the API sends
 *  max-age=300) — the post-submit refetch must show the new report count. */
export const fetchTrail = (
  id: string,
  opts: { fresh?: boolean } = {},
): Promise<TrailDetail> =>
  getJson<TrailDetail>(
    `/api/trails/${encodeURIComponent(id)}`,
    opts.fresh ? { cache: "no-store" } : undefined,
  );

/** POST /api/reports body (spec §9). */
export interface ReportPayload {
  trailId: string;
  verdict: ReportVerdict;
  tags: string[];
  deviceId: string;
  turnstileToken: string;
}

/** Submit a rider report. Throws ApiError carrying the server's polite
 *  message (409 daily duplicate, 429 network limit, 403 verification). */
export async function postReport(payload: ReportPayload): Promise<void> {
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `POST /api/reports: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === "string" && body.message.length > 0) {
        message = body.message;
      }
    } catch {
      // no JSON body; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
}
