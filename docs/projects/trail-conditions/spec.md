# Trail Conditions (working name) — Build Plan v1

A free public website that shows **mountain bike trail conditions** (dry, prime, soft, muddy, snow) for **Salt Lake County, Utah County, and Wasatch County**, Utah.

Conditions come from **weather + radar + soil data**. Riders can **confirm or correct** a condition with no login. Each trail shows a **confidence marker**.

Cost target: **$0 per month.**

---

## 1. Goals and non-goals

**Goals (v1)**
- Show a condition and a confidence for each trail, for **now, tomorrow, and the day after**.
- Let riders send a quick report: **Yes / Wetter / Drier**, plus optional tags.
- Use rider reports to raise or lower confidence, and to tune each trail's drying speed over time.
- Stay inside free tiers.

**Non-goals (v1)**
- No user accounts or login.
- No Facebook data or scraping.
- No ads, no subscriptions. (Open-Meteo is free only for non-commercial use.)
- No native mobile app. The site must work well on a phone.
- No trail closures from land managers (v2 idea).

---

## 2. Area and trail list

### 2.1 Counties
- Salt Lake County
- Utah County
- Wasatch County

Note: Park City and Round Valley are in **Summit County**, so they are out of scope for v1.

### 2.2 Find trails with OpenStreetMap (one-time script)
Do **not** type coordinates by hand. Write a script `scripts/discover-trails.ts` that:

1. Queries the **Overpass API** for the three county boundaries (`boundary=administrative`, `admin_level=6`).
2. Inside those boundaries, gets:
   - `route=mtb` relations
   - `highway=path|track` ways with `mtb:scale`, `mtb:scale:imba`, or `bicycle=designated|yes`
3. Groups results into **trail systems** (for example, "Corner Canyon"), using relation names, `name` tags, and distance clustering.
4. For each system, picks **sample points**: the trailhead (lowest point) and the high point. Elevation matters a lot (Wasatch Crest vs. Corner Canyon).
5. Writes `data/trail-candidates.csv` so a human (Spencer) can review it.

After review, the approved list goes in `data/trails.json`.

Respect the Overpass usage policy: run this script by hand, not on a schedule.

### 2.3 Seed list to check against (verify names and areas)
Use this list to check that discovery found the main systems. It is **not** a source of coordinates.

- **Salt Lake County:** Corner Canyon (Draper), Bonneville Shoreline Trail sections, Mill Creek Canyon (Pipeline, Big Water, Great Western), Wasatch Crest, Butterfield Canyon and Herriman trails (Yellow Fork, Rose Canyon), Brighton / Solitude resort trails
- **Utah County:** Lambert Park (Alpine), Traverse Mountain (Lehi), American Fork Canyon (Tibble Fork, Ridge trails), Eagle Mountain trails, Bonneville Shoreline (Orem / Provo), Hobble Creek (Springville)
- **Wasatch County:** Wasatch Mountain State Park (Midway), Soldier Hollow, Jordanelle State Park, Coyote Canyon (Heber), Deer Valley Mayflower area

### 2.4 Enrich each trail (one-time script)
`scripts/enrich-trails.ts` adds these fields to each sample point:
- **Soil** from USDA Soil Data Access (sand %, clay %, rock fragment %, hydrologic group, drainage class)
- **Elevation** (Open-Meteo returns it, or use OSM / USGS)
- **Stage IV grid cell** (`gridi`, `gridj` from the IEM API), so trails in the same ~4 km cell share one radar call

---

## 3. Data sources (all free)

| Data | Source | Use | Notes |
|---|---|---|---|
| Past rain, hourly | Iowa Environmental Mesonet (IEM) Stage IV: `https://mesonet.agron.iastate.edu/json/stage4.py?lat=..&lon=..&valid=YYYY-MM-DD&tz=America/Denver` | Main source for past rain | Radar + gauges, bias-corrected. ~1–2 h delay. No key. CORS open. Save results; don't fetch the same day twice. |
| Forecast + temps | Open-Meteo `https://api.open-meteo.com/v1/forecast` | Future rain, temperature, snowfall, snow depth. Fills the last 1–2 h before Stage IV arrives | Free for non-commercial use: 10,000 calls/day, 5,000/hour, 600/min. Supports **many locations in one call**. Pass `elevation=` for each point. Use **hourly** data only (daily totals did not match hourly in testing). CC-BY 4.0. |
| Soil | USDA NRCS Soil Data Access `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest` | Drying speed per trail | One-time lookup. SQL query below. |
| Trails | OpenStreetMap Overpass API | Trail list and points | One-time, by hand. ODbL; credit OSM. |

**Not used:** Synoptic / MesoWest. Its free plan is only for .edu accounts.

### 3.1 Soil query (tested)
```sql
SELECT TOP 1 c.hydgrp, c.drainagecl, ch.sandtotal_r, ch.claytotal_r, ch.fraggt10_r, ch.frag3to10_r
FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(<lon> <lat>)') k
JOIN mapunit mu ON mu.mukey = k.mukey
JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes'
LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0
ORDER BY c.comppct_r DESC
```
POST body: `{"query": "<sql>", "format": "JSON"}`

---

## 4. Mud model (v3, starting values)

Put the model in **pure functions** in `packages/model`. The Worker, the backtest, and the tests all use the same code.

### 4.1 Drying time (tau) per trail
```
tau_base (hours):
  sand >= 60%  -> 12
  clay >= 30%  -> 48
  else         -> 24
  rock fragments (fraggt10 + frag3to10) >= 15%  -> x 0.75
  hydrologic group D -> x 1.2
  hydrologic group A -> x 0.8

tau_trail = tau_base * tau_mult      // tau_mult starts at 1.0; rider reports tune it (section 6.4)
```

### 4.2 Wetness
Walk hour by hour over the **last 240 hours** (10 days), then on into the forecast:
```
tau_eff(hour) = tau_trail * (1 + max(0, 55 - tempF(hour)) / 10)   // cold dries slower
w = w * exp(-1 / tau_eff(hour)) + precip_in(hour)
```
- **Past hours:** Stage IV precipitation. If Stage IV is missing for an hour, use Open-Meteo.
- **Future hours:** Open-Meteo forecast.
- **Temperature:** Open-Meteo, at the sample point's elevation.

### 4.3 Levels
| Wetness `w` | Level | Show as |
|---|---|---|
| < 0.05 | Dry | "Dry / dusty" |
| 0.05 – 0.15 | Prime | "Tacky, hero dirt likely" |
| 0.15 – 0.35 | Soft | "Soft spots, ride with care" |
| >= 0.35 | Muddy | "Muddy, please stay off" |

**Overrides:**
- **Snow:** snowfall >= 0.5 in during the last 48 h, or snow depth > 0 at the point → `Snow`.
- **Freeze:** temp < 32°F and `w >= 0.15` → add the note "Frozen early, muddy when it thaws."

**Trail with several sample points:** use the **worst** point, and show which section is worst.

### 4.4 Backtest fixtures (must reproduce)
Make `npm run backtest`. It runs the model on these real reports and prints a table. Coordinates are approximate.

| Trail | Lat, Lon | Time (America/Denver) | Riders said | v3 result in testing |
|---|---|---|---|---|
| Wasatch Crest | 40.615, -111.585 | 2026-10-17 10:00 | Muddy | Muddy |
| Wasatch Crest | 40.615, -111.585 | 2026-10-18 11:00 | Muddy | Muddy |
| Wasatch Crest | 40.615, -111.585 | 2026-10-21 11:00 | Dry (secondhand) | Prime |
| Spinal Tap (Richfield) | 38.7717, -112.1553 | 2026-10-18 10:00 | Hero dirt | Soft |
| JEM (Hurricane) | 37.165, -113.315 | 2026-10-19 12:00 | Muddy | Dry (known miss) |
| Butterfield | 40.488, -112.08 | 2026-08-29 13:00 | Sloppy | Muddy |
| Deer Valley | 40.62, -111.49 | 2026-09-19 11:00 | Hero dirt | Muddy (known miss) |
| Lehi's Dream | 40.444, -111.853 | 2026-05-01 11:00 | Dry | Prime |

Known misses:
- **JEM:** local riders say it holds water. The soil data says it dries fast. Rider tuning (6.4) should fix this.
- **Deer Valley:** riders called light moisture "hero dirt." The thresholds may be too strict. Do not tune on 8 points; wait for real reports.

Save raw API responses for these cases in `fixtures/`, so the backtest runs offline and gives the same result every time.

---

## 5. Confidence marker

Score 0–100, then group it: **High >= 70, Medium 40–69, Low < 40.** Start at 60.

| Factor | Change |
|---|---|
| Each rider report since the last rain, last 24 h, that **agrees** | +20 (max +40) |
| A rider report that **disagrees** with the model | −20 |
| Reports disagree with each other | −15 |
| Stage IV and Open-Meteo differ by > 0.25 in over the last 72 h | −15 |
| Sample point above 2,400 m (radar beam is blocked more in the mountains) | −15 |
| Less than 12 h since rain > 0.1 in | −10 |
| More than 72 h since rain > 0.1 in | +10 |
| Trail is tuned (5 or more reports used in `tau_mult`) | +10 |
| Forecast day (tomorrow / day after) | −10 per day |

Store the factors with each score, so the UI can show **why** ("2 riders confirmed today," "radar and forecast disagree").

All numbers are starting values. Keep them in one config file.

---

## 6. Rider reports (no login)

### 6.1 Report form
On the trail page: **"Is this right?"** → **Yes / Wetter / Drier**

Optional tags: Hero · Tacky · Dusty · Muddy · Snow · Ice · Closed · Downed tree

Open the form in a **single-focus modal**. One tap to send. Tags are optional.

### 6.2 Spam control
- **Cloudflare Turnstile** on submit. Check the token on the server.
- **Device ID:** a random UUID in `localStorage`.
- **IP:** store only `sha256(ip + daily_salt)`. Never store the raw IP. Rotate the salt every day.
- **Limits:** 1 report per trail per device per day. 20 reports per IP hash per day.
- No free text in v1, so there is nothing to moderate.

### 6.3 How long a report counts
- Full weight for 0–24 h, half weight for 24–48 h, then it expires.
- **New rain resets reports.** If > 0.1 in of rain falls after a report, that report stops counting.

### 6.4 Tune drying speed (nightly job)
For each trail, compare reports to the model's level at report time:
- Riders say **Wetter** many times → raise `tau_mult`.
- Riders say **Drier** many times → lower `tau_mult`.
- Use a small step (for example, ×1.1 or ×0.9 per night). Keep `tau_mult` between **0.5 and 3.0**.
- Need at least 3 reports in the last 30 days before any change.
- Log every change in `tau_history`.

---

## 7. Architecture ($0)

```
Cloudflare Pages      React + TypeScript (Vite) site
Cloudflare Worker     /api/* routes + Cron Triggers
Cloudflare D1         trails, rain cache, scores, reports
Cloudflare Turnstile  bot check on reports
```

### 7.1 Free-tier limits to design around (Workers Free)
- 100,000 requests/day
- **10 ms CPU** per invocation (HTTP and cron). Waiting on `fetch` does not count as CPU.
- **50 subrequests** per invocation
- **5 Cron Triggers** per account
- D1 has daily row read and write limits. From **Sep 1, 2026**, queries fail on free accounts after the limit, until midnight UTC. Use indexes and avoid full table scans.

Check the current numbers in the Cloudflare docs before you build.

### 7.2 Score job design (because of the 50-subrequest limit)
- Group trails by **Stage IV grid cell**. Fetch radar once per cell.
- Save Stage IV hours in D1 (`rain_hourly`). Each run fetches **only today** (and yesterday right after midnight) for each cell.
- Use **one Open-Meteo call with many locations** (split into a few calls if the URL gets too long).
- If the job still needs more than ~40 subrequests, **split the cells into chunks**. Each cron run does one chunk (for example, every 10 minutes, chunk = minute / 10).
- Measure CPU time. If the 10 ms CPU limit is a problem, move the score job to a **GitHub Actions** hourly workflow that POSTs results to `/api/admin/scores`. Note: GitHub turns off scheduled workflows in public repos after 60 days with no repo activity.

### 7.3 Cron triggers
1. Every 10 min: score job (one chunk per run)
2. Nightly 03:00 MT: tune `tau_mult`, delete expired data

---

## 8. Database (D1)

```sql
trails(
  id TEXT PRIMARY KEY, name TEXT, system TEXT, county TEXT,
  osm_ref TEXT, tau_base_h REAL, tau_mult REAL DEFAULT 1.0,
  reports_used INTEGER DEFAULT 0
)
trail_points(
  id TEXT PRIMARY KEY, trail_id TEXT, label TEXT,       -- "Trailhead", "Top"
  lat REAL, lon REAL, elev_m REAL,
  sand REAL, clay REAL, rock REAL, hydgrp TEXT, drainage TEXT,
  cell_id TEXT                                          -- "gridi:gridj"
)
rain_hourly(cell_id TEXT, ts_utc TEXT, precip_in REAL, source TEXT,
  PRIMARY KEY (cell_id, ts_utc))
scores_latest(id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT, updated_utc TEXT)
score_history(trail_id TEXT, ts_utc TEXT, wetness REAL, level TEXT, confidence INTEGER,
  PRIMARY KEY (trail_id, ts_utc))                       -- "now" only, hourly
reports(
  id TEXT PRIMARY KEY, trail_id TEXT, created_utc TEXT,
  verdict TEXT CHECK (verdict IN ('yes','wetter','drier')),
  tags TEXT,                                            -- JSON array
  device_id TEXT, ip_hash TEXT,
  model_wetness REAL, model_level TEXT
)
tau_history(trail_id TEXT, ts_utc TEXT, old_mult REAL, new_mult REAL, n_reports INTEGER)
```
Add indexes on `reports(trail_id, created_utc)`, `reports(device_id, trail_id, created_utc)`, `reports(ip_hash, created_utc)`.

`scores_latest` keeps the whole snapshot in **one row**, so a page load is one row read.

---

## 9. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/scores` | Latest snapshot for all trails (cache 5 min) |
| GET | `/api/trails/:id` | Trail details, "why" factors, report summary since the last rain |
| POST | `/api/reports` | `{ trailId, verdict, tags[], deviceId, turnstileToken }` |
| POST | `/api/admin/scores` | Secret header. For the GitHub Actions fallback, or a manual recompute |

---

## 10. UI (mobile first)

**Home (explore: search first, map and list to go deeper)**
- **Search** at the top: one box, typed or by voice (mic only where the browser supports it). Searches all three counties. Forgiving: typos, plurals, possessives ("lamberts park"). Also matches the names of trails inside a system (`data/trail-names.json`, from the hand-run `pnpm trail-names`), and the card says which one ("Includes Clark's Trail").
- **Phone:** the map fills the screen; search and chips float on top; results sit in a bottom sheet (peek / half / full). **Desktop (>= 900 px):** sidebar (search, chips, list) and the map on the right.
- **Map:** USGS Topo tiles (public domain, no key). One pin per trail at its trailhead, colored **and lettered** by today's level (D · P · S · M · ❄). Tapping a pin highlights its card; on desktop, hovering a card highlights its pin. The map code loads only when the map is shown.
- **List:** when not searching, the trails in the map area, best conditions first (closest first after Near me). Each card shows:
  - Name and level color (Dry · Prime · Soft · Muddy · Snow)
  - Confidence: High / Medium / Low (plus county when searching, distance after Near me)
  - "✔ 2 riders confirmed today," if any
  - A 3-day strip: Today · Tomorrow · Day after
  - "Updated 12 min ago"
- **Chips:** "Rideable now" (filter), "Near me" (asks for location only when tapped; never sent to the server), and Salt Lake · Utah · Wasatch (move the map to that county; they replace the old tabs, and old `?tab=` links still work).
- The URL keeps the search, filter, and map view (`?q=`, `?rideable=1`, `?at=lat,lon,zoom`), so back from a trail page restores them.
- If the snapshot has no pins yet (worker not redeployed), Home falls back to search + list with no map.

**Trail page**
- Level, confidence, and **why**: last rain (amount and time), soil type, drying speed, worst section
- Reports since the last rain
- **"Is this right?"** button → report modal
- **Where:** a small map with the Trailhead and Top pins, and a **Directions to the trailhead** button (Google Maps link; nothing goes through our server)

**Footer (required)**
- Credits: Open-Meteo (CC-BY 4.0), Iowa Environmental Mesonet, USDA NRCS, © OpenStreetMap contributors, USGS The National Map (map tiles)
- Disclaimer: "Estimates only. Check land manager closures. Please stay off muddy trails."

Map view: shipped (see Home). Snapshot entries and `/api/trails/:id` carry `points: { label, lat, lon }[]`, Trailhead first, rounded to 5 decimals.

---

## 11. Repo layout

```
/apps/web          React + TS (Vite), Cloudflare Pages
/apps/worker       Worker: API + cron, wrangler.toml, D1 migrations
/packages/model    Pure model + confidence functions (shared)
/scripts           discover-trails.ts, enrich-trails.ts, backtest.ts
/data              trails.json, trail-candidates.csv
/fixtures          Saved API responses for the backtest
```
Tools: pnpm workspaces, TypeScript strict, Vitest, Wrangler.

---

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo setup | Monorepo builds; `wrangler dev` runs; CI runs tests |
| M1 | Trail discovery + enrichment | `trail-candidates.csv` is ready for review; after review, `trails.json` has soil, elevation, and cell for each point |
| M2 | Model + backtest | `npm run backtest` reproduces the table in 4.4 from fixtures; unit tests pass |
| M3 | Score job + D1 + `/api/scores` | Cron fills `scores_latest`; it stays under the subrequest and CPU limits (measure them) |
| M4 | Web UI | Home and trail page work on a phone, with real data |
| M5 | Reports + Turnstile + confidence | Reports are saved, limited, and change confidence |
| M6 | Nightly tuning | `tau_mult` changes from reports; `tau_history` logs it |
| M7 | Launch | Deployed on Pages; credits shown; soft launch in 1–2 Facebook groups (ask the admins first) |

---

## 13. Risks

- **Radar is weaker in high mountains.** Mitigation: lower confidence above 2,400 m; rider reports.
- **Thresholds come from 8 reports.** Mitigation: log model vs. reports; review after the first 50 reports.
- **No reports at launch.** Mitigation: the model works with zero reports. Ask local riders and trail groups to confirm.
- **Spam with no login.** Mitigation: Turnstile, rate limits, report decay, and the rain reset.
- **Free-tier changes.** Mitigation: keep the score job movable (Worker cron or GitHub Actions).
