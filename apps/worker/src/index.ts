// Worker entry: /api/* routes + the two cron triggers (spec §7.3): the
// 10-minute score job and the nightly tune job.

import { postReport } from "./reports";
import { runScoreJob, type Env } from "./score-job";
import { runTuneJob } from "./tune-job";
import { EMPTY_SNAPSHOT } from "./snapshot";
import { getTrailDetail } from "./trail-detail";

/** 5-minute cache (spec §9: /api/scores, cache 5 min). */
const SCORES_CACHE_CONTROL = "public, max-age=300";

// Cron strings, matched byte-for-byte against wrangler.toml's [triggers]
// (Cloudflare hands the firing cron's string to `scheduled` as event.cron).
/** §7.3 cron 1: score job, one chunk per run. */
export const SCORE_CRON = "*/10 * * * *";
/** §7.3 cron 2: nightly tune at 10:00 UTC — 03:00 MST / 04:00 MDT (ticket
 *  C-20261023-M6 decision 5: one fixed UTC hour, documented, no DST code). */
export const TUNE_CRON = "0 10 * * *";

/** Constant-time string compare: XOR-fold over the longer length, so the
 *  time depends on the secret's length only, not on where it differs. */
export function secretsEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function getScores(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT json FROM scores_latest WHERE id = 1",
  ).first<{ json: string }>();
  return new Response(row?.json ?? JSON.stringify(EMPTY_SNAPSHOT), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": SCORES_CACHE_CONTROL,
    },
  });
}

/** The /api/admin/* guard: 401 unless x-admin-secret matches. */
function adminUnauthorized(request: Request, env: Env): Response | null {
  const secret = request.headers.get("x-admin-secret");
  if (!env.ADMIN_SECRET || !secret || !secretsEqual(secret, env.ADMIN_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function postAdminScores(request: Request, env: Env): Promise<Response> {
  const unauthorized = adminUnauthorized(request, env);
  if (unauthorized) return unauthorized;
  // Optional ?chunk= override: run a specific chunk instead of the one the
  // current 10-minute slot selects (manual recompute / testing).
  const chunkParam = new URL(request.url).searchParams.get("chunk");
  const chunk = chunkParam === null ? undefined : Number(chunkParam);
  if (chunk !== undefined && !Number.isInteger(chunk)) {
    return Response.json({ error: "chunk must be an integer" }, { status: 400 });
  }
  const result = await runScoreJob(env, Date.now(), chunk);
  return Response.json(result);
}

/** Manual tune-job trigger, so §6.4 tuning can run without waiting for the
 *  nightly cron (same guard as /api/admin/scores). */
async function postAdminTune(request: Request, env: Env): Promise<Response> {
  const unauthorized = adminUnauthorized(request, env);
  if (unauthorized) return unauthorized;
  const result = await runTuneJob(env, Date.now());
  return Response.json(result);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/scores" && request.method === "GET") {
      return getScores(env);
    }
    const trailMatch = url.pathname.match(/^\/api\/trails\/([^/]+)$/);
    if (trailMatch && request.method === "GET") {
      let id: string;
      try {
        id = decodeURIComponent(trailMatch[1]!);
      } catch {
        // Malformed percent-encoding (e.g. /api/trails/%): no trail can have
        // this id, so answer like any other unknown id instead of throwing.
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return getTrailDetail(env, id, Date.now());
    }
    if (url.pathname === "/api/reports" && request.method === "POST") {
      return postReport(request, env, Date.now());
    }
    if (url.pathname === "/api/admin/scores" && request.method === "POST") {
      return postAdminScores(request, env);
    }
    if (url.pathname === "/api/admin/tune" && request.method === "POST") {
      return postAdminTune(request, env);
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Dispatch on the firing cron's string. Anything that isn't the tune
    // cron — including the empty string `wrangler dev --test-scheduled`
    // sends — runs the score job, the pre-M6 default.
    const job =
      event.cron === TUNE_CRON
        ? runTuneJob(env, event.scheduledTime)
        : runScoreJob(env, event.scheduledTime);
    ctx.waitUntil(job);
  },
} satisfies ExportedHandler<Env>;
