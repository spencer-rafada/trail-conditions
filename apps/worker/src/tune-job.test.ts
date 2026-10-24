// Tune job (§6.4/§7.3 cron 2): the seeded three-trail scenario, the nightly
// deletions, the subrequest budget, and the tau/reports_used wiring between
// the tune job and the score job (ticket C-20261023-M6 AC1, AC3, AC6).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTuneJob } from "./tune-job";
import { runScoreJob, type Env } from "./score-job";
import { HOUR_MS, stamp } from "./time";

// "Now": 10:00 UTC = the nightly trigger's hour (03:00 MST).
const NOW = Date.UTC(2026, 9, 23, 10, 0);
const NOW_ISO = new Date(NOW).toISOString();
const iso = (ageHours: number) => new Date(NOW - ageHours * HOUR_MS).toISOString();

interface FakeStatement {
  sql: string;
  binds: unknown[];
  bind: (...args: unknown[]) => FakeStatement;
}

interface FakeData {
  trails: { id: string; tau_mult: number }[];
  reports: { trail_id: string; created_utc: string; verdict: string }[];
}

/** Fake D1 capturing every batch's statements (reports.test.ts pattern). */
function fakeEnv(data: FakeData): { env: Env; batches: FakeStatement[][] } {
  const batches: FakeStatement[][] = [];
  const prepare = (sql: string): FakeStatement => {
    const stmt: FakeStatement = {
      sql,
      binds: [],
      bind: (...args: unknown[]) => {
        stmt.binds = args;
        return stmt;
      },
    };
    return stmt;
  };
  const batch = async (stmts: FakeStatement[]) => {
    batches.push(stmts);
    return stmts.map((s) => {
      if (s.sql.includes("FROM trails")) return { results: data.trails };
      if (s.sql.includes("FROM reports") && s.sql.startsWith("SELECT"))
        return { results: data.reports };
      return { results: [] };
    });
  };
  const env: Env = {
    ADMIN_SECRET: "x",
    TURNSTILE_SECRET: "t",
    REPORT_IP_SALT_SECRET: "s",
    DB: { prepare, batch } as unknown as D1Database,
  };
  return { env, batches };
}

/** AC1's seeded scenario: wetter-majority, drier-majority, too-few trails. */
const seeded = (): FakeData => ({
  trails: [
    { id: "wet-trail", tau_mult: 1.0 },
    { id: "dry-trail", tau_mult: 2.0 },
    { id: "few-trail", tau_mult: 1.0 },
  ],
  reports: [
    { trail_id: "wet-trail", created_utc: iso(5), verdict: "wetter" },
    { trail_id: "wet-trail", created_utc: iso(6), verdict: "wetter" },
    { trail_id: "wet-trail", created_utc: iso(7), verdict: "yes" },
    { trail_id: "dry-trail", created_utc: iso(5), verdict: "drier" },
    { trail_id: "dry-trail", created_utc: iso(6), verdict: "drier" },
    { trail_id: "dry-trail", created_utc: iso(7), verdict: "yes" },
    { trail_id: "few-trail", created_utc: iso(5), verdict: "wetter" },
    { trail_id: "few-trail", created_utc: iso(6), verdict: "wetter" },
  ],
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("the tune job must not fetch");
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runTuneJob — seeded three-trail scenario (AC1)", () => {
  it("raises the wetter trail, lowers the drier trail, skips the thin one", async () => {
    const { env, batches } = fakeEnv(seeded());
    const result = await runTuneJob(env, NOW);

    expect(batches).toHaveLength(2); // one read batch, one write batch
    const writes = batches[1]!;
    const updates = writes.filter((s) => s.sql.startsWith("UPDATE trails"));
    expect(updates.map((s) => s.binds)).toEqual([
      [1.0 * 1.1, 3, "wet-trail"],
      [2.0 * 0.9, 3, "dry-trail"],
    ]);

    const history = writes.filter((s) => s.sql.includes("INSERT INTO tau_history"));
    expect(history.map((s) => s.binds)).toEqual([
      ["wet-trail", NOW_ISO, 1.0, 1.0 * 1.1, 3],
      ["dry-trail", NOW_ISO, 2.0, 2.0 * 0.9, 3],
    ]);

    // The too-few trail (2 reports < floor 3) writes nothing at all.
    expect(writes.some((s) => s.binds.includes("few-trail"))).toBe(false);
    expect(result.trailsSeen).toBe(3);
    expect(result.trailsTuned).toBe(2);
  });

  it("keeps reports_used cumulative in SQL (decision 3)", async () => {
    const { env, batches } = fakeEnv(seeded());
    await runTuneJob(env, NOW);
    const update = batches[1]!.find((s) => s.sql.startsWith("UPDATE trails"))!;
    expect(update.sql).toBe(
      "UPDATE trails SET tau_mult = ?, reports_used = reports_used + ? WHERE id = ?",
    );
  });

  it("reads reports from the 30-day window", async () => {
    const { env, batches } = fakeEnv(seeded());
    await runTuneJob(env, NOW);
    const read = batches[0]!.find((s) => s.sql.includes("FROM reports"))!;
    expect(read.binds).toEqual([iso(30 * 24)]);
  });
});

describe("runTuneJob — nightly deletion (decisions 2 and 6)", () => {
  it("deletes 48 h-old reports and 30-day-old score_history after tuning, same batch", async () => {
    const { env, batches } = fakeEnv(seeded());
    await runTuneJob(env, NOW);
    const writes = batches[1]!;
    // Deletes are the batch's last two statements: tune first, then delete.
    const [reportsDelete, historyDelete] = writes.slice(-2) as [
      FakeStatement,
      FakeStatement,
    ];
    expect(reportsDelete.sql).toBe("DELETE FROM reports WHERE created_utc < ?");
    expect(reportsDelete.binds).toEqual([iso(48)]);
    expect(historyDelete.sql).toBe("DELETE FROM score_history WHERE ts_utc < ?");
    expect(historyDelete.binds).toEqual([stamp(NOW - 30 * 24 * HOUR_MS)]);
  });

  it("still deletes when nothing tunes, and logs no tau_history row", async () => {
    const { env, batches } = fakeEnv({
      trails: [{ id: "few-trail", tau_mult: 1.0 }],
      reports: [
        { trail_id: "few-trail", created_utc: iso(5), verdict: "wetter" },
      ],
    });
    const result = await runTuneJob(env, NOW);
    const writes = batches[1]!;
    expect(writes.map((s) => s.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "DELETE FROM reports",
      "DELETE FROM score_history",
    ]);
    expect(result.trailsTuned).toBe(0);
  });
});

describe("runTuneJob — budget (AC6)", () => {
  it("makes zero fetches and two D1 calls (decision 4: pure D1 work)", async () => {
    const { env } = fakeEnv(seeded());
    const result = await runTuneJob(env, NOW);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.subrequests.fetches).toBe(0);
    expect(result.subrequests.d1Calls).toBe(2);
    // 2 reads + 2 trails × (UPDATE + INSERT) + 2 DELETEs.
    expect(result.subrequests.d1Statements).toBe(8);
  });
});

describe("tau wiring between the tune job and the score job (AC3)", () => {
  it("the score job re-SELECTs tau_mult and reports_used from trails every run", async () => {
    const { env, batches } = fakeEnv({ trails: [], reports: [] });
    await runScoreJob(env, NOW, 0);
    await runScoreJob(env, NOW + HOUR_MS, 0);
    const trailSelects = batches
      .flat()
      .filter((s) => s.sql.startsWith("SELECT") && s.sql.includes("FROM trails"));
    expect(trailSelects).toHaveLength(2);
    for (const select of trailSelects) {
      expect(select.sql).toContain("tau_mult");
      expect(select.sql).toContain("reports_used");
    }
  });

  it("writes the same trails columns the score job reads", async () => {
    const data = seeded();
    const tune = fakeEnv(data);
    await runTuneJob(tune.env, NOW);
    const update = tune.batches[1]!.find((s) => s.sql.startsWith("UPDATE trails"))!;

    const score = fakeEnv({ trails: [], reports: [] });
    await runScoreJob(score.env, NOW, 0);
    const select = score.batches[0]!.find((s) => s.sql.includes("FROM trails"))!;

    // Tune writes trails.tau_mult and trails.reports_used; the score job
    // reads both from the same table (snapshot.ts feeds reports_used to the
    // §5 tuned bonus, pinned in confidence.test.ts).
    for (const column of ["tau_mult", "reports_used"]) {
      expect(update.sql).toMatch(new RegExp(`UPDATE trails SET .*${column}`));
      expect(select.sql).toMatch(new RegExp(`SELECT .*${column}.* FROM trails`));
    }
  });
});
