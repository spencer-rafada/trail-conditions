# Trail Conditions

A free public website that shows mountain bike trail conditions (dry, prime, soft, muddy, snow)
for Salt Lake, Utah, and Wasatch counties, Utah. Conditions come from weather + radar + soil
data; riders confirm or correct them with no login.

The full build plan lives in [docs/projects/trail-conditions/spec.md](docs/projects/trail-conditions/spec.md).

## Layout

```
apps/web          React + TS (Vite); built into the Worker's static assets
apps/worker       Cloudflare Worker: /api/* + cron, D1 migrations
packages/model    Pure model + confidence functions (shared)
scripts           discover-trails.ts, enrich-trails.ts, trail-names.ts, trail-lines.ts, backtest.ts
data              trails.json, trail-candidates.csv
fixtures          Saved API responses for the backtest
```

## Commands

```
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm backtest                                # offline spec §4.4 backtest from fixtures/
pnpm --filter @trail-conditions/web dev      # web dev server
pnpm --filter @trail-conditions/worker dev   # wrangler dev
pnpm discover-trails   # hand-run only (Overpass + Open-Meteo): writes data/trail-candidates.csv
pnpm trail-names       # hand-run only (Overpass): writes data/trail-names.json (member trail names for search)
pnpm trail-lines       # hand-run only (Overpass): writes data/trail-lines.json (trail lines drawn on the maps)

# local D1 (wrangler commands run inside apps/worker; never pass --remote)
pnpm tsx scripts/seed-d1.ts                  # writes apps/worker/.wrangler/seed.sql from data/trails.json
cd apps/worker
pnpm exec wrangler d1 migrations apply trail-conditions --local
pnpm exec wrangler d1 execute trail-conditions --local --file .wrangler/seed.sql
```

## Local dev against real data

The web dev server proxies `/api/*` to a locally running `wrangler dev`
(default target `http://localhost:8787`; override with
`API_PROXY_TARGET=http://localhost:<port>` when starting vite).

1. Migrate and seed the local D1 (block above).
2. `cd apps/worker && cp .dev.vars.example .dev.vars` and set a local `ADMIN_SECRET`.
   The example file already carries the Turnstile TEST secret and a local
   `REPORT_IP_SALT_SECRET` (see "Rider reports locally" below).
3. `pnpm --filter @trail-conditions/worker dev`
4. Populate the snapshot — one admin recompute per chunk covers all 18 chunks
   (each run makes live Stage IV / Open-Meteo fetches):

   ```
   for i in $(seq 0 17); do
     curl -s -X POST -H "x-admin-secret: $ADMIN_SECRET" \
       "http://localhost:8787/api/admin/scores?chunk=$i"
   done
   ```

   Before the first run, `/api/scores` returns the empty snapshot
   `{"updated_utc":null,"trails":{}}` and the home page shows its empty state.
5. `pnpm --filter @trail-conditions/web dev` and open the printed URL.

## Rider reports locally (Turnstile TEST keys)

POST /api/reports verifies a Cloudflare Turnstile token server-side. Local
dev uses Cloudflare's published always-pass TEST key pair, so the full flow
(modal → token → siteverify → stored row) runs with zero Cloudflare resources:

- Sitekey (web): `1x00000000000000000000AA` — the default in the report
  modal; override with `VITE_TURNSTILE_SITEKEY` when starting vite.
- Secret (worker): `1x0000000000000000000000000000000AA` — set as
  `TURNSTILE_SECRET` in `apps/worker/.dev.vars` (the example file has it).

The real Turnstile key pair is created manually in the Cloudflare dashboard
at M7, never by a ship run. Reports store only `sha256(ip + daily salt)`
(salt = HMAC of `REPORT_IP_SALT_SECRET` and the UTC date); the raw IP is
never stored or logged.

## Deploy (production)

One Worker serves the built site and `/api/*` from the same address (the
`[assets]` block in `apps/worker/wrangler.toml`), on Cloudflare's free plan.
All steps are hand-run; never from CI or a ship run. Run `wrangler` commands
inside `apps/worker`, and the `pnpm prod:*` scripts from the repo root.

One-time setup:

1. `pnpm exec wrangler login` (opens the browser).
2. `pnpm exec wrangler d1 create trail-conditions`, then paste the printed
   `database_id` into `wrangler.toml` and commit it.
3. `pnpm prod:db-setup`: applies migrations and loads `data/trails.json`. It
   refuses to re-seed once trails exist, because re-seeding resets their
   tuning from rider reports (`--force` overrides).
4. `pnpm prod:deploy --first`: the first deploy, which prints your
   `*.workers.dev` URL. `--first` skips the site key check (the Turnstile
   widget needs this URL), so rider reports don't work until step 7.
5. Cloudflare dashboard → Turnstile → add a widget for that hostname. Put
   its **site key** in `apps/web/.env.production` (public; commit it).
6. `pnpm prod:secrets`: generates `ADMIN_SECRET` and
   `REPORT_IP_SALT_SECRET` (saved locally to the gitignored
   `apps/worker/.prod-admin-secret`) and asks you to paste the Turnstile
   **secret key**.
7. `pnpm prod:deploy` again, now with the real site key.
8. `pnpm prod:fill-scores https://<your URL>` scores every trail now
   instead of over the next 3 hours.

Every later release: `pnpm prod:deploy`.

Optional, in `apps/web/.env.production` (both are public values, so commit them):

- `VITE_CARTO_KEY`: a free key from https://carto.com/basemaps/apikey makes the default
  "simple" map CARTO Voyager (Google-style). Without it, the simple map uses
  OpenStreetMap's own tiles.
- `VITE_CF_ANALYTICS_TOKEN`: from Cloudflare dashboard → Web Analytics → Add a site
  (your `*.workers.dev` hostname). Turns on free, cookieless visit counts. Without
  it, no analytics script loads.

## Data credits

Open-Meteo (CC-BY 4.0) · Iowa Environmental Mesonet · USDA NRCS · © OpenStreetMap contributors
