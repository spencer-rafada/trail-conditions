/**
 * Production deploy. Hand-run, never from CI or a ship run:
 *
 *   pnpm prod:deploy
 *
 * Refuses to deploy with the placeholder D1 id or without the real
 * Turnstile site key, then builds the site and runs `wrangler deploy`. One
 * Worker serves the built site and /api/* from the same address (see the
 * [assets] block in apps/worker/wrangler.toml).
 *
 *   pnpm prod:deploy --first
 *
 * The very first deploy, before the Turnstile widget exists (the widget
 * needs the URL this deploy prints): skips the site key check. Everything
 * but rider reports works until the next plain `pnpm prod:deploy`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseIdIsPlaceholder, productionSiteKey } from "./launch-checks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => {
  const p = path.join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

function main(): void {
  const problems: string[] = [];
  if (databaseIdIsPlaceholder(read("apps/worker/wrangler.toml"))) {
    problems.push(
      "apps/worker/wrangler.toml still has the placeholder database_id. Run " +
        "`pnpm exec wrangler d1 create trail-conditions` in apps/worker and paste the id it prints.",
    );
  }
  const first = process.argv.includes("--first");
  const site = productionSiteKey(read("apps/web/.env.production"), process.env);
  if (!site.ok && !first) problems.push(site.reason);
  if (problems.length > 0) {
    console.error(`Not deploying:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }
  if (!site.ok) {
    console.warn(
      "⚠ --first: deploying without the real Turnstile site key. Rider reports won't work\n" +
        "  until you add the key to apps/web/.env.production and run pnpm prod:deploy again.",
    );
  }

  const env = site.ok ? { ...process.env, VITE_TURNSTILE_SITEKEY: site.key } : process.env;
  console.log("── Building the site…");
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit", env });
  console.log("── Deploying the Worker (site + API + crons)…");
  execFileSync("pnpm", ["exec", "wrangler", "deploy"], {
    cwd: path.join(root, "apps/worker"),
    stdio: "inherit",
    env,
  });
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
