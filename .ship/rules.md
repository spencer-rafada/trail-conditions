# trail-conditions rules

Hard rules for this codebase. Every ship agent reads this file after ship's own rules.
Keep it under 3 KB: one rule per line, each something an agent can act on. The Friday
learn loop proposes additions as pull requests; nothing lands here without review.

## Stack

- Package manager: pnpm. Never use another one in this repo.
- pnpm workspace: apps/web (Vite + React, Cloudflare Pages), apps/worker (Cloudflare Worker + D1), packages/model (pure functions).
- TypeScript strict everywhere; tests are Vitest, run from the repo root with `pnpm test`.
- All model and confidence logic lives in packages/model as pure functions — no I/O, no Date.now(), no env access. The Worker, the backtest, and the tests import the same code.
- Every tunable number (tau rules, wetness thresholds, confidence factors) lives in one config module in packages/model, never scattered as inline constants.

## Never

- Never use Node APIs in apps/worker; it runs on Cloudflare Workers.
- Never run `wrangler deploy` or create/modify Cloudflare resources from a ship run; deploys are manual.
- Never store a raw IP; reports store only sha256(ip + daily salt).
- Never call Overpass, USDA SDA, or other discovery APIs from scheduled code; discovery/enrichment scripts run by hand only.
- Never fetch the same Stage IV day twice; cache hours in D1 (rain_hourly).
- Never edit data/trails.json by hand in a ship run; it is the human-reviewed trail list.

## Always

- Design for Workers Free tier: <= 50 subrequests and ~10 ms CPU per invocation; batch Open-Meteo calls (many locations per call) and group radar fetches by Stage IV grid cell.
- Use hourly Open-Meteo data only (daily totals proved unreliable); Stage IV is the past-rain source of truth, Open-Meteo fills gaps and the future.
- Keep the credits footer on the site: Open-Meteo (CC-BY 4.0), Iowa Environmental Mesonet, USDA NRCS, © OpenStreetMap contributors.
- The spec is docs/projects/trail-conditions/spec.md; when a ticket and the spec disagree, stop and flag it — do not pick one.
