// POST /api/reports (spec §9, §6): body { trailId, verdict, tags[], deviceId,
// turnstileToken }. The token is verified server-side (Turnstile siteverify),
// the caller's IP is reduced to sha256(ip + daily salt) before anything else
// touches it — the raw IP is never stored, logged, or echoed — and the §6.2
// limits answer with polite 409/429 JSON the modal can surface as-is.
//
// Subrequests per invocation: 1 fetch (siteverify) + 3 D1 calls.

import {
  REPORTS,
  deviceLimitExceeded,
  ipLimitExceeded,
  type ReportVerdict,
} from "@trail-conditions/model";
import { utcDayOf } from "./time";
import type { Env } from "./score-job";
import type { Snapshot } from "./snapshot";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const VERDICTS: readonly string[] = ["yes", "wetter", "drier"];
const ALLOWED_TAGS: readonly string[] = REPORTS.tags;

export interface ReportRequestBody {
  trailId: string;
  verdict: ReportVerdict;
  tags: string[];
  deviceId: string;
  turnstileToken: string;
}

/** Strict body validation: §6.1 verdicts and tags only (no free text in v1),
 *  a plausible device UUID, a non-empty token. Null = 400. */
export function parseReportBody(raw: unknown): ReportRequestBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (
    typeof b.trailId !== "string" ||
    b.trailId.length === 0 ||
    b.trailId.length > 200
  ) {
    return null;
  }
  if (typeof b.verdict !== "string" || !VERDICTS.includes(b.verdict)) return null;
  const tags = b.tags === undefined ? [] : b.tags;
  if (!Array.isArray(tags) || tags.length > ALLOWED_TAGS.length) return null;
  for (const tag of tags) {
    if (typeof tag !== "string" || !ALLOWED_TAGS.includes(tag)) return null;
  }
  if (
    typeof b.deviceId !== "string" ||
    b.deviceId.length < 8 ||
    b.deviceId.length > 100
  ) {
    return null;
  }
  if (
    typeof b.turnstileToken !== "string" ||
    b.turnstileToken.length === 0 ||
    b.turnstileToken.length > 4096
  ) {
    return null;
  }
  return {
    trailId: b.trailId,
    verdict: b.verdict as ReportVerdict,
    tags: [...new Set(tags as string[])],
    deviceId: b.deviceId,
    turnstileToken: b.turnstileToken,
  };
}

const encoder = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Daily salt (§6.2 "rotate the salt every day"): HMAC-SHA256 of the UTC
 *  date under a server secret, so the salt changes at UTC midnight and is
 *  unguessable without the secret. */
export async function dailySalt(secret: string, utcDay: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(utcDay)));
}

/** §6.2: store only sha256(ip + daily_salt), hex. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(ip + salt)));
}

const politeJson = (
  status: number,
  error: string,
  message: string,
): Response => Response.json({ error, message }, { status });

export async function postReport(
  request: Request,
  env: Env,
  nowMs: number,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return politeJson(400, "bad_request", "That report didn't come through right. Reload the page and try again.");
  }
  const body = parseReportBody(raw);
  if (!body) {
    return politeJson(400, "bad_request", "That report didn't come through right. Reload the page and try again.");
  }

  // Turnstile: check the token on the server (§6.2).
  let verified = false;
  try {
    const verifyRes = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: body.turnstileToken,
      }),
    });
    if (verifyRes.ok) {
      verified = ((await verifyRes.json()) as { success?: boolean }).success === true;
    }
  } catch {
    verified = false;
  }
  if (!verified) {
    return politeJson(403, "verification_failed", "We couldn't confirm you're human. Close this and try again.");
  }

  // The trail must exist; the current snapshot gives the model's wetness and
  // level at report time (null when the trail hasn't been scored yet).
  const [trailRes, snapshotRes] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT id FROM trails WHERE id = ?").bind(body.trailId),
    env.DB.prepare("SELECT json FROM scores_latest WHERE id = 1"),
  ]);
  if ((trailRes?.results ?? []).length === 0) {
    return politeJson(404, "not_found", "This trail isn't in our list.");
  }
  const snapshotJson = snapshotRes?.results[0]?.json as string | undefined;
  const today = snapshotJson
    ? (JSON.parse(snapshotJson) as Snapshot).trails[body.trailId]?.days.find(
        (d) => d.offset === 0,
      )
    : undefined;

  // Reduce the IP to its daily hash immediately; nothing below sees the raw
  // address. A missing header (local dev) hashes a placeholder.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const utcDay = utcDayOf(nowMs);
  const ipHash = await hashIp(ip, await dailySalt(env.REPORT_IP_SALT_SECRET, utcDay));

  // §6.2 limits, counted since UTC midnight. created_utc is a full ISO
  // string, so `>= "YYYY-MM-DD"` holds exactly for this UTC day's rows.
  const [deviceRes, ipRes] = await env.DB.batch<{ n: number }>([
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reports WHERE device_id = ? AND trail_id = ? AND created_utc >= ?",
    ).bind(body.deviceId, body.trailId, utcDay),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_utc >= ?",
    ).bind(ipHash, utcDay),
  ]);
  if (deviceLimitExceeded(deviceRes?.results[0]?.n ?? 0)) {
    return politeJson(409, "already_reported", "Thanks — you already reported this trail today. Come back tomorrow.");
  }
  if (ipLimitExceeded(ipRes?.results[0]?.n ?? 0)) {
    return politeJson(429, "too_many_reports", "Too many reports from your network today. Try again tomorrow.");
  }

  await env.DB.prepare(
    "INSERT INTO reports (id, trail_id, created_utc, verdict, tags, device_id, ip_hash, model_wetness, model_level)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      body.trailId,
      new Date(nowMs).toISOString(),
      body.verdict,
      JSON.stringify(body.tags),
      body.deviceId,
      ipHash,
      today?.wetness ?? null,
      today?.level ?? null,
    )
    .run();

  return Response.json({ ok: true }, { status: 201 });
}
