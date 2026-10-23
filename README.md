# Trail Conditions

A free public website that shows mountain bike trail conditions (dry, prime, soft, muddy, snow)
for Salt Lake, Utah, and Wasatch counties, Utah. Conditions come from weather + radar + soil
data; riders confirm or correct them with no login.

The full build plan lives in [docs/projects/trail-conditions/spec.md](docs/projects/trail-conditions/spec.md).

## Layout

```
apps/web          React + TS (Vite), Cloudflare Pages
apps/worker       Cloudflare Worker: /api/* + cron, D1 migrations
packages/model    Pure model + confidence functions (shared)
scripts           discover-trails.ts, enrich-trails.ts, backtest.ts
data              trails.json, trail-candidates.csv
fixtures          Saved API responses for the backtest
```

## Commands

```
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @trail-conditions/web dev      # web dev server
pnpm --filter @trail-conditions/worker dev   # wrangler dev
```

## Data credits

Open-Meteo (CC-BY 4.0) · Iowa Environmental Mesonet · USDA NRCS · © OpenStreetMap contributors
