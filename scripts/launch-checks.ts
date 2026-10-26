/**
 * Preflight checks for a production deploy (pure; used by scripts/deploy.ts).
 * They catch the two mistakes that deploy "successfully" and then break the
 * live site: a build without the real Turnstile site key (every rider report
 * fails against the real secret), and the local-only placeholder D1 id.
 */

/** Cloudflare's published always-pass test site key: fine locally, never live. */
export const TEST_SITE_KEY = "1x00000000000000000000AA";

const SITE_KEY_VAR = "VITE_TURNSTILE_SITEKEY";

export type SiteKeyCheck = { ok: true; key: string } | { ok: false; reason: string };

/** The site key a production build will use: the environment variable if
 *  set, else the first uncommented line in apps/web/.env.production. */
export function productionSiteKey(
  envFile: string,
  env: Readonly<Record<string, string | undefined>>,
): SiteKeyCheck {
  let key = env[SITE_KEY_VAR]?.trim() ?? "";
  if (!key) {
    for (const line of envFile.split(/\r?\n/)) {
      const m = line.match(/^\s*VITE_TURNSTILE_SITEKEY\s*=\s*(.*?)\s*$/);
      if (m) {
        key = m[1]!.replace(/^["']|["']$/g, "");
        break;
      }
    }
  }
  if (!key) {
    return {
      ok: false,
      reason: `No Turnstile site key. Set ${SITE_KEY_VAR} in apps/web/.env.production (it's public; commit it).`,
    };
  }
  if (key === TEST_SITE_KEY) {
    return {
      ok: false,
      reason: `${SITE_KEY_VAR} is Cloudflare's test key; use the real site key from your Turnstile widget.`,
    };
  }
  return { ok: true, key };
}

/** True while wrangler.toml still has the local-only all-zero D1 id. */
export function databaseIdIsPlaceholder(wranglerToml: string): boolean {
  const m = wranglerToml.match(/database_id\s*=\s*"([^"]*)"/);
  return !m || /^[0-]*$/.test(m[1]!);
}
