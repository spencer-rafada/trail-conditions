import { describe, expect, it } from "vitest";
import worker, { secretsEqual } from "./index";
import type { Env } from "./score-job";

/** Fake env: a D1 stub serving only the scores_latest read. */
function fakeEnv(row: { json: string } | null): Env {
  return {
    ADMIN_SECRET: "test-secret",
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

describe("secretsEqual", () => {
  it("compares full strings regardless of where they differ", () => {
    expect(secretsEqual("abc123", "abc123")).toBe(true);
    expect(secretsEqual("abc123", "xbc123")).toBe(false);
    expect(secretsEqual("abc123", "abc12x")).toBe(false);
    expect(secretsEqual("abc123", "abc1234")).toBe(false);
    expect(secretsEqual("", "")).toBe(true);
  });
});
