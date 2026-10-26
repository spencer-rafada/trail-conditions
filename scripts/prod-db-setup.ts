/**
 * One-time production database setup. Hand-run, after `wrangler login` and
 * `wrangler d1 create trail-conditions` (with its id in wrangler.toml):
 *
 *   pnpm prod:db-setup
 *
 * Applies the D1 migrations to the remote database, then loads
 * data/trails.json into it (scripts/seed-d1.ts writes the SQL).
 *
 * Re-seeding deletes and recreates every trail row, which resets each
 * trail's tuned tau_mult and reports_used. So once trails exist, this
 * refuses to seed again unless run with --force.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseIdIsPlaceholder } from "./launch-checks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = path.join(root, "apps/worker");
const force = process.argv.includes("--force");

const wrangler = (args: string[], capture = false): string =>
  execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: worker,
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  }) ?? "";

function trailCount(): number {
  const out = wrangler(
    ["d1", "execute", "trail-conditions", "--remote", "--json", "--command", "SELECT COUNT(*) AS n FROM trails"],
    true,
  );
  const parsed = JSON.parse(out) as Array<{ results: Array<{ n: number }> }>;
  return parsed[0]?.results[0]?.n ?? 0;
}

function main(): void {
  if (databaseIdIsPlaceholder(readFileSync(path.join(worker, "wrangler.toml"), "utf8"))) {
    console.error(
      "apps/worker/wrangler.toml still has the placeholder database_id.\n" +
        "Run `pnpm exec wrangler d1 create trail-conditions` in apps/worker and paste the id it prints.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("── Applying migrations to the remote database…");
  wrangler(["d1", "migrations", "apply", "trail-conditions", "--remote"]);

  const existing = trailCount();
  if (existing > 0 && !force) {
    console.log(
      `\nThe remote database already has ${existing} trails, so it was not re-seeded.\n` +
        "Re-seeding resets every trail's tuning from rider reports. To do it anyway: pnpm prod:db-setup --force",
    );
    return;
  }

  console.log("── Writing the seed SQL from data/trails.json…");
  execFileSync("pnpm", ["tsx", "scripts/seed-d1.ts"], { cwd: root, stdio: "inherit" });

  console.log("── Loading trails into the remote database…");
  wrangler(["d1", "execute", "trail-conditions", "--remote", "--file", ".wrangler/seed.sql"]);
  console.log(`\nDone: the remote database has ${trailCount()} trails.`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
