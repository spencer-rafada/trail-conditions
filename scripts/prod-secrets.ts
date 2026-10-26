/**
 * Set the Worker's three production secrets. Hand-run, after the first
 * `pnpm prod:deploy`:
 *
 *   pnpm prod:secrets
 *
 * ADMIN_SECRET and REPORT_IP_SALT_SECRET are generated here and piped
 * straight into `wrangler secret put`, so they are never printed.
 * ADMIN_SECRET is also saved to apps/worker/.prod-admin-secret (gitignored,
 * owner-only) for `pnpm prod:fill-scores`; keep a copy in your password
 * manager. TURNSTILE_SECRET is the secret key from your Turnstile widget:
 * wrangler asks you to paste it.
 *
 * Re-running rotates the generated secrets. Rotating the salt secret only
 * changes how future report IPs are hashed (today's per-IP limit restarts).
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = path.join(root, "apps/worker");
const ADMIN_SECRET_FILE = path.join(worker, ".prod-admin-secret");

function putSecret(name: string, value?: string): void {
  console.log(`── ${name}`);
  execFileSync("pnpm", ["exec", "wrangler", "secret", "put", name], {
    cwd: worker,
    input: value,
    stdio: value === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  });
}

function main(): void {
  const admin = randomBytes(32).toString("hex");
  putSecret("ADMIN_SECRET", admin);
  writeFileSync(ADMIN_SECRET_FILE, `${admin}\n`, { mode: 0o600 });
  chmodSync(ADMIN_SECRET_FILE, 0o600);
  console.log(`   saved to ${path.relative(root, ADMIN_SECRET_FILE)} (gitignored)`);

  putSecret("REPORT_IP_SALT_SECRET", randomBytes(32).toString("hex"));

  console.log("Paste the SECRET key from your Turnstile widget (not the site key):");
  putSecret("TURNSTILE_SECRET");
  console.log("\nAll three secrets are set.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
