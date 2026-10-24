import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { dailySalt, hashIp, postReport } from "./reports";
import type { Env } from "./score-job";

const NOW = Date.UTC(2026, 9, 23, 15, 0);
const RAW_IP = "203.0.113.9";

/** A snapshot where trail-1 has a today score (wetness 0.22, soft). */
const SNAPSHOT_JSON = JSON.stringify({
  updated_utc: "2026-10-23T14:00:00.000Z",
  trails: {
    "trail-1": {
      id: "trail-1",
      name: "Trail One",
      days: [
        {
          offset: 0,
          level: "soft",
          wetness: 0.22,
          worst_point: "Trailhead",
          confidence: { score: 60, band: "medium", factors: [] },
        },
      ],
      scored_utc: "2026-10-23T14:00:00.000Z",
    },
  },
});

interface FakeData {
  trailExists: boolean;
  snapshotJson: string | null;
  deviceCount: number;
  ipCount: number;
}

interface FakeStatement {
  sql: string;
  binds: unknown[];
  bind: (...args: unknown[]) => FakeStatement;
  run: () => Promise<{ results: unknown[] }>;
}

function fakeEnv(data: FakeData): { env: Env; inserts: FakeStatement[] } {
  const inserts: FakeStatement[] = [];
  const prepare = (sql: string): FakeStatement => {
    const stmt: FakeStatement = {
      sql,
      binds: [],
      bind: (...args: unknown[]) => {
        stmt.binds = args;
        return stmt;
      },
      run: async () => {
        inserts.push(stmt);
        return { results: [] };
      },
    };
    return stmt;
  };
  const batch = async (stmts: FakeStatement[]) =>
    stmts.map((s) => {
      if (s.sql.includes("FROM trails"))
        return { results: data.trailExists ? [{ id: "trail-1" }] : [] };
      if (s.sql.includes("FROM scores_latest"))
        return { results: data.snapshotJson ? [{ json: data.snapshotJson }] : [] };
      if (s.sql.includes("device_id = ?")) return { results: [{ n: data.deviceCount }] };
      if (s.sql.includes("ip_hash = ?")) return { results: [{ n: data.ipCount }] };
      throw new Error(`unexpected batch sql: ${s.sql}`);
    });
  const env: Env = {
    ADMIN_SECRET: "x",
    TURNSTILE_SECRET: "test-turnstile-secret",
    REPORT_IP_SALT_SECRET: "test-salt-secret",
    DB: { prepare, batch } as unknown as D1Database,
  };
  return { env, inserts };
}

const happyEnv = () =>
  fakeEnv({ trailExists: true, snapshotJson: SNAPSHOT_JSON, deviceCount: 0, ipCount: 0 });

const body = (overrides: Record<string, unknown> = {}) => ({
  trailId: "trail-1",
  verdict: "yes",
  tags: ["Tacky"],
  deviceId: "11111111-2222-3333-4444-555555555555",
  turnstileToken: "XXXX.DUMMY.TOKEN",
  ...overrides,
});

const request = (payload: unknown) =>
  new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": RAW_IP },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

let siteverify: ReturnType<typeof vi.fn>;

beforeEach(() => {
  siteverify = vi.fn(async () => Response.json({ success: true }));
  vi.stubGlobal("fetch", siteverify);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/reports — happy path", () => {
  it("verifies the token server-side, inserts the report, returns 201", async () => {
    const { env, inserts } = happyEnv();
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(201);

    // siteverify was called with the secret and the token, nothing else.
    expect(siteverify).toHaveBeenCalledTimes(1);
    const [url, init] = siteverify.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = init.body as URLSearchParams;
    expect(form.get("secret")).toBe("test-turnstile-secret");
    expect(form.get("response")).toBe("XXXX.DUMMY.TOKEN");

    // One insert carrying verdict, tags JSON, device id, the model's
    // wetness/level at report time, and a created_utc inside the UTC day.
    expect(inserts).toHaveLength(1);
    const binds = inserts[0]!.binds;
    expect(inserts[0]!.sql).toContain("INSERT INTO reports");
    expect(binds).toContain("trail-1");
    expect(binds).toContain("yes");
    expect(binds).toContain(JSON.stringify(["Tacky"]));
    expect(binds).toContain("11111111-2222-3333-4444-555555555555");
    expect(binds).toContain(0.22);
    expect(binds).toContain("soft");
    expect(binds.some((b) => typeof b === "string" && /^2026-10-23T/.test(b))).toBe(true);
  });

  it("stores null model wetness/level when the trail has no score yet", async () => {
    const { env, inserts } = fakeEnv({
      trailExists: true,
      snapshotJson: null,
      deviceCount: 0,
      ipCount: 0,
    });
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(201);
    expect(inserts[0]!.binds.filter((b) => b === null)).toHaveLength(2);
  });
});

describe("POST /api/reports — validation and verification", () => {
  it("rejects malformed JSON and missing or invalid fields with 400", async () => {
    const { env, inserts } = happyEnv();
    const bad = [
      "not json{",
      JSON.stringify(body({ trailId: "" })),
      JSON.stringify(body({ verdict: "maybe" })),
      JSON.stringify(body({ tags: ["Gnarly"] })), // not in the §6.1 tag set
      JSON.stringify(body({ tags: "Tacky" })),
      JSON.stringify(body({ deviceId: 7 })),
      JSON.stringify(body({ deviceId: "short" })),
      JSON.stringify(body({ turnstileToken: "" })),
    ];
    for (const payload of bad) {
      const res = await postReport(request(payload), env, NOW);
      expect(res.status).toBe(400);
    }
    expect(inserts).toHaveLength(0);
  });

  it("returns 403 and inserts nothing when siteverify fails", async () => {
    siteverify.mockImplementation(async () => Response.json({ success: false }));
    const { env, inserts } = happyEnv();
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it("returns 404 for an unknown trail", async () => {
    const { env, inserts } = fakeEnv({
      trailExists: false,
      snapshotJson: null,
      deviceCount: 0,
      ipCount: 0,
    });
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });
});

describe("POST /api/reports — §6.2 limits", () => {
  it("409 with a polite message on the second device report for a trail today", async () => {
    const { env, inserts } = fakeEnv({
      trailExists: true,
      snapshotJson: SNAPSHOT_JSON,
      deviceCount: 1,
      ipCount: 1,
    });
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(409);
    const payload = (await res.json()) as { message?: string };
    expect(payload.message).toMatch(/already/i);
    expect(inserts).toHaveLength(0);
  });

  it("429 with a polite message at 20 reports per ip hash per day", async () => {
    const { env, inserts } = fakeEnv({
      trailExists: true,
      snapshotJson: SNAPSHOT_JSON,
      deviceCount: 0,
      ipCount: 20,
    });
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(429);
    const payload = (await res.json()) as { message?: string };
    expect(payload.message).toMatch(/too many/i);
    expect(inserts).toHaveLength(0);
  });
});

describe("AC3 — the raw IP never leaves the hash", () => {
  it("hashIp emits a 64-char hex digest with no IP substring, rotating daily", async () => {
    const salt23 = await dailySalt("test-salt-secret", "2026-10-23");
    const salt24 = await dailySalt("test-salt-secret", "2026-10-24");
    expect(salt23).not.toBe(salt24); // the salt rotates with the UTC date
    const hash = await hashIp(RAW_IP, salt23);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113");
    expect(await hashIp(RAW_IP, salt23)).toBe(hash); // same day: stable
    expect(await hashIp(RAW_IP, salt24)).not.toBe(hash); // next day: different
  });

  it("the insert binds, the response, and the console carry no raw IP", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { env, inserts } = happyEnv();
    const res = await postReport(request(body()), env, NOW);
    expect(res.status).toBe(201);

    const binds = inserts[0]!.binds;
    for (const b of binds) {
      expect(String(b)).not.toContain(RAW_IP);
      expect(String(b)).not.toContain("203.0.113");
    }
    // ip_hash bind is a hex digest, not an address.
    expect(binds.some((b) => typeof b === "string" && /^[0-9a-f]{64}$/.test(b))).toBe(true);
    expect(await res.text()).not.toContain("203.0.113");
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.map(String).join(" ")).not.toContain("203.0.113");
      }
    }
  });

  it("tolerates a missing CF-Connecting-IP header instead of throwing", async () => {
    const { env } = happyEnv();
    const req = new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    });
    const res = await postReport(req, env, NOW);
    expect(res.status).toBe(201);
  });
});

describe("routing", () => {
  it("POST /api/reports reaches the handler", async () => {
    const { env } = happyEnv();
    const res = await worker.fetch(
      new Request("http://localhost/api/reports", {
        method: "POST",
        headers: { "CF-Connecting-IP": RAW_IP },
        body: JSON.stringify(body()),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });
});
