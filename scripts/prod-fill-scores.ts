/**
 * Score every trail right away instead of waiting up to 3 hours for the
 * 10-minute cron to walk all chunks. Hand-run after a deploy:
 *
 *   pnpm prod:fill-scores https://trail-conditions-worker.<you>.workers.dev
 *
 * Uses ADMIN_SECRET from the environment, else the file pnpm prod:secrets
 * saved (apps/worker/.prod-admin-secret).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NUM_CHUNKS } from "../apps/worker/src/chunking";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretFile = path.join(root, "apps/worker/.prod-admin-secret");

async function main(): Promise<void> {
  const base = process.argv[2]?.replace(/\/+$/, "");
  // https only, so ADMIN_SECRET never crosses the network in the clear;
  // http://localhost is allowed for trying it against `wrangler dev`.
  if (!base || !/^(https:\/\/|http:\/\/localhost[:/]|http:\/\/localhost$)/.test(base)) {
    console.error("Usage: pnpm prod:fill-scores https://<your worker URL>");
    process.exitCode = 1;
    return;
  }
  const secret =
    process.env.ADMIN_SECRET?.trim() ||
    (existsSync(secretFile) ? readFileSync(secretFile, "utf8").trim() : "");
  if (!secret) {
    console.error("No ADMIN_SECRET: run pnpm prod:secrets first, or set ADMIN_SECRET.");
    process.exitCode = 1;
    return;
  }

  for (let chunk = 0; chunk < NUM_CHUNKS; chunk++) {
    const res = await fetch(`${base}/api/admin/scores?chunk=${chunk}`, {
      method: "POST",
      headers: { "x-admin-secret": secret },
    });
    if (res.status === 401) {
      console.error("The Worker rejected ADMIN_SECRET (401). Re-run pnpm prod:secrets.");
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.error(`chunk ${chunk}: HTTP ${res.status} ${await res.text()}`);
      process.exitCode = 1;
      continue;
    }
    const body = (await res.json()) as { trailsScored?: number };
    console.log(`chunk ${chunk + 1}/${NUM_CHUNKS}: ${body.trailsScored ?? "?"} trails scored`);
  }

  const snapshot = (await (await fetch(`${base}/api/scores`)).json()) as {
    trails?: Record<string, unknown>;
  };
  console.log(`\n${Object.keys(snapshot.trails ?? {}).length} trails are live at ${base}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
