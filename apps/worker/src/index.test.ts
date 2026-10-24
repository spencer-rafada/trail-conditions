import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { secretsEqual, SCORE_CRON, TUNE_CRON } from "./index";
import type { Env } from "./score-job";

/** Fake env: a D1 stub serving only the scores_latest read. */
function fakeEnv(row: { json: string } | null): Env {
  return {
    ADMIN_SECRET: "test-secret",
    TURNSTILE_SECRET: "test-turnstile-secret",
    REPORT_IP_SALT_SECRET: "test-salt-secret",
    DB: {
      prepare: () => ({ first: async () => row }),
    } as unknown as D1Database,
  };
}

const call = (env: Env, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`http://localhost${path}`, init), env);

describe("GET /api/scores", () => {
  it("serves the scores_latest JSON with 5-minute cache headers", async () => {
    const snapshot = JSON.stringify({ updated_utc: "2026-10-23T15:00:00.000Z", trails: {} });
    const res = await call(fakeEnv({ json: snapshot }), "/api/scores");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.text()).toBe(snapshot);
  });

  it("serves an empty snapshot before the first cron run", async () => {
    const res = await call(fakeEnv(null), "/api/scores");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated_utc: null, trails: {} });
  });
});

describe("GET /api/trails/:id with malformed percent-encoding", () => {
  it("returns the handler's 404 JSON instead of an uncaught URIError", async () => {
    // Both survive URL parsing and match the route regex, but fail decodeURIComponent.
    for (const path of ["/api/trails/%", "/api/trails/%zz"]) {
      const res = await call(fakeEnv(null), path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    }
  });
});

describe("POST /api/admin/scores auth", () => {
  it("rejects a missing or wrong secret with 401 and no recompute", async () => {
    const env = fakeEnv(null); // any DB use beyond the stub would throw
    const missing = await call(env, "/api/admin/scores", { method: "POST" });
    expect(missing.status).toBe(401);
    // shares a prefix with the real secret: a prefix/startsWith compare must fail
    const wrong = await call(env, "/api/admin/scores", {
      method: "POST",
      headers: { "x-admin-secret": "test-secret2" },
    });
    expect(wrong.status).toBe(401);
  });
});

/** Fake D1 for whole-job runs: captures every batched SQL, returns empty
 *  result sets (no trails, no reports — both jobs no-op their writes). */
function captureEnv(): { env: Env; sqls: string[] } {
  const sqls: string[] = [];
  const prepare = (sql: string) => {
    const stmt = { sql, bind: () => stmt };
    return stmt;
  };
  const batch = async (stmts: { sql: string }[]) => {
    for (const s of stmts) sqls.push(s.sql);
    return stmts.map(() => ({ results: [] }));
  };
  return {
    env: {
      ADMIN_SECRET: "test-secret",
      TURNSTILE_SECRET: "test-turnstile-secret",
      REPORT_IP_SALT_SECRET: "test-salt-secret",
      DB: { prepare, batch } as unknown as D1Database,
    },
    sqls,
  };
}

async function runScheduled(cron: string, env: Env): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => tasks.push(p),
  } as unknown as ExecutionContext;
  const event = {
    cron,
    scheduledTime: Date.UTC(2026, 9, 23, 10, 0),
    noRetry: () => {},
  } as ScheduledController;
  await worker.scheduled(event, env, ctx);
  await Promise.all(tasks);
}

describe("scheduled — cron dispatch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no job may fetch in this test");
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pins the constants to the wrangler.toml trigger strings", () => {
    expect(SCORE_CRON).toBe("*/10 * * * *");
    expect(TUNE_CRON).toBe("0 10 * * *");
  });

  it("runs the tune job on the tune cron", async () => {
    const { env, sqls } = captureEnv();
    await runScheduled(TUNE_CRON, env);
    expect(sqls).toContain("DELETE FROM reports WHERE created_utc < ?");
    expect(sqls).toContain("DELETE FROM score_history WHERE ts_utc < ?");
    expect(sqls.join("\n")).not.toContain("FROM trail_points");
  });

  it("runs the score job on the score cron and on the empty cron wrangler dev sends", async () => {
    for (const cron of [SCORE_CRON, ""]) {
      const { env, sqls } = captureEnv();
      await runScheduled(cron, env);
      expect(sqls.join("\n")).toContain("FROM trail_points");
      expect(sqls.join("\n")).not.toContain("DELETE FROM");
    }
  });
});

describe("POST /api/admin/tune", () => {
  it("rejects a missing or wrong secret with 401 and no tune run", async () => {
    const env = fakeEnv(null); // any DB use beyond the stub would throw
    const missing = await call(env, "/api/admin/tune", { method: "POST" });
    expect(missing.status).toBe(401);
    // shares a prefix with the real secret: a prefix/startsWith compare must fail
    const wrong = await call(env, "/api/admin/tune", {
      method: "POST",
      headers: { "x-admin-secret": "test-secret2" },
    });
    expect(wrong.status).toBe(401);
  });

  it("runs the tune job and returns its result on the right secret", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { env } = captureEnv();
    const res = await call(env, "/api/admin/tune", {
      method: "POST",
      headers: { "x-admin-secret": "test-secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      trailsSeen: 0,
      trailsTuned: 0,
      subrequests: { fetches: 0 },
    });
    vi.restoreAllMocks();
  });
});

describe("secretsEqual", () => {
  it("compares full strings regardless of where they differ", () => {
    expect(secretsEqual("abc123", "abc123")).toBe(true);
    expect(secretsEqual("abc123", "xbc123")).toBe(false);
    expect(secretsEqual("abc123", "abc12x")).toBe(false);
    expect(secretsEqual("abc123", "abc1234")).toBe(false);
    expect(secretsEqual("", "")).toBe(true);
  });
});
