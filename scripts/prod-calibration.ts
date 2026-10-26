/**
 * How often each confidence band matched what riders reported (last 30
 * days). Hand-run, any time:
 *
 *   pnpm prod:calibration https://rideable.srafada.workers.dev
 *
 * A trustworthy marker shows High matching riders more often than Medium,
 * and Medium more than Low. Small counts mean little: wait for dozens of
 * reports per band before tuning CONFIDENCE in packages/model/src/config.ts.
 * Uses ADMIN_SECRET from the environment, else apps/worker/.prod-admin-secret.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretFile = path.join(root, "apps/worker/.prod-admin-secret");

interface Band {
  reports: number;
  matched: number;
  matchRate: number | null;
}

async function main(): Promise<void> {
  const base = process.argv[2]?.replace(/\/+$/, "");
  if (!base || !/^(https:\/\/|http:\/\/localhost[:/]|http:\/\/localhost$)/.test(base)) {
    console.error("Usage: pnpm prod:calibration https://<your worker URL>");
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
  const res = await fetch(`${base}/api/admin/calibration`, {
    headers: { "x-admin-secret": secret },
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exitCode = 1;
    return;
  }
  const body = (await res.json()) as {
    window_days: number;
    bands: Record<"high" | "medium" | "low", Band>;
    unscored: number;
  };
  console.log(`Rider reports vs confidence, last ${body.window_days} days\n`);
  console.log("Band     Reports  Said \"right\"  Match rate");
  for (const band of ["high", "medium", "low"] as const) {
    const b = body.bands[band];
    const rate = b.matchRate === null ? "—" : `${Math.round(b.matchRate * 100)}%`;
    console.log(
      `${band.padEnd(8)} ${String(b.reports).padStart(7)}  ${String(b.matched).padStart(12)}  ${rate.padStart(10)}`,
    );
  }
  if (body.unscored > 0) console.log(`\n(${body.unscored} reports had no stored score)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
