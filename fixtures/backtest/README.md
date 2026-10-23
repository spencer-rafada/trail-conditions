# Backtest fixtures — fetch receipt

Raw API responses for the 8 spec §4.4 backtest cases, saved verbatim.
One-time hand run; the backtest and tests read only these files and
never fetch.

- Command: `pnpm tsx scripts/fetch-backtest-fixtures.ts`
- Started: 2026-10-23T16:00:45.411Z (UTC)
- Finished: 2026-10-23T16:02:07.182Z (UTC)

Notes on axes and units, verified from the raw responses:
- Stage IV `end_valid` is UTC (hour-ending accumulation, inches);
  `tz=America/Denver` only selects the local calendar day.
- Open-Meteo hours are labeled UTC (`timezone=UTC`); temperature_2m is
  °F at the labeled instant; precipitation and snowfall are
  preceding-hour sums in inches; snow_depth is feet (the unit follows precipitation_unit=inch; see hourly_units in the raw responses).
- SDA soil values are strings in `Table` rows:
  hydgrp, drainagecl, sandtotal_r, claytotal_r, fraggt10_r, frag3to10_r.

## Calls, in order

| What | Status | Saved to |
|---|---|---|
| elevation (all points) | HTTP 200 | elevation.json |
| SDA soil wasatch-crest | HTTP 200 | soil/wasatch-crest.json |
| Stage IV wasatch-crest 2026-10-06 | HTTP 200 | stage4/wasatch-crest/2026-10-06.json |
| Stage IV wasatch-crest 2026-10-07 | HTTP 200 | stage4/wasatch-crest/2026-10-07.json |
| Stage IV wasatch-crest 2026-10-08 | HTTP 200 | stage4/wasatch-crest/2026-10-08.json |
| Stage IV wasatch-crest 2026-10-09 | HTTP 200 | stage4/wasatch-crest/2026-10-09.json |
| Stage IV wasatch-crest 2026-10-10 | HTTP 200 | stage4/wasatch-crest/2026-10-10.json |
| Stage IV wasatch-crest 2026-10-11 | HTTP 200 | stage4/wasatch-crest/2026-10-11.json |
| Stage IV wasatch-crest 2026-10-12 | HTTP 200 | stage4/wasatch-crest/2026-10-12.json |
| Stage IV wasatch-crest 2026-10-13 | HTTP 200 | stage4/wasatch-crest/2026-10-13.json |
| Stage IV wasatch-crest 2026-10-14 | HTTP 200 | stage4/wasatch-crest/2026-10-14.json |
| Stage IV wasatch-crest 2026-10-15 | HTTP 200 | stage4/wasatch-crest/2026-10-15.json |
| Stage IV wasatch-crest 2026-10-16 | HTTP 200 | stage4/wasatch-crest/2026-10-16.json |
| Stage IV wasatch-crest 2026-10-17 | HTTP 200 | stage4/wasatch-crest/2026-10-17.json |
| Stage IV wasatch-crest 2026-10-18 | HTTP 200 | stage4/wasatch-crest/2026-10-18.json |
| Stage IV wasatch-crest 2026-10-19 | HTTP 200 | stage4/wasatch-crest/2026-10-19.json |
| Stage IV wasatch-crest 2026-10-20 | HTTP 200 | stage4/wasatch-crest/2026-10-20.json |
| Stage IV wasatch-crest 2026-10-21 | HTTP 200 | stage4/wasatch-crest/2026-10-21.json |
| Open-Meteo forecast wasatch-crest | HTTP 200 | open-meteo/wasatch-crest.json |
| SDA soil spinal-tap | HTTP 200 | soil/spinal-tap.json |
| Stage IV spinal-tap 2026-10-07 | HTTP 200 | stage4/spinal-tap/2026-10-07.json |
| Stage IV spinal-tap 2026-10-08 | HTTP 200 | stage4/spinal-tap/2026-10-08.json |
| Stage IV spinal-tap 2026-10-09 | HTTP 200 | stage4/spinal-tap/2026-10-09.json |
| Stage IV spinal-tap 2026-10-10 | HTTP 200 | stage4/spinal-tap/2026-10-10.json |
| Stage IV spinal-tap 2026-10-11 | HTTP 200 | stage4/spinal-tap/2026-10-11.json |
| Stage IV spinal-tap 2026-10-12 | HTTP 200 | stage4/spinal-tap/2026-10-12.json |
| Stage IV spinal-tap 2026-10-13 | HTTP 200 | stage4/spinal-tap/2026-10-13.json |
| Stage IV spinal-tap 2026-10-14 | HTTP 200 | stage4/spinal-tap/2026-10-14.json |
| Stage IV spinal-tap 2026-10-15 | HTTP 200 | stage4/spinal-tap/2026-10-15.json |
| Stage IV spinal-tap 2026-10-16 | HTTP 200 | stage4/spinal-tap/2026-10-16.json |
| Stage IV spinal-tap 2026-10-17 | HTTP 200 | stage4/spinal-tap/2026-10-17.json |
| Stage IV spinal-tap 2026-10-18 | HTTP 200 | stage4/spinal-tap/2026-10-18.json |
| Open-Meteo forecast spinal-tap | HTTP 200 | open-meteo/spinal-tap.json |
| SDA soil jem | HTTP 200 | soil/jem.json |
| Stage IV jem 2026-10-08 | HTTP 200 | stage4/jem/2026-10-08.json |
| Stage IV jem 2026-10-09 | HTTP 200 | stage4/jem/2026-10-09.json |
| Stage IV jem 2026-10-10 | HTTP 200 | stage4/jem/2026-10-10.json |
| Stage IV jem 2026-10-11 | HTTP 200 | stage4/jem/2026-10-11.json |
| Stage IV jem 2026-10-12 | HTTP 200 | stage4/jem/2026-10-12.json |
| Stage IV jem 2026-10-13 | HTTP 200 | stage4/jem/2026-10-13.json |
| Stage IV jem 2026-10-14 | HTTP 200 | stage4/jem/2026-10-14.json |
| Stage IV jem 2026-10-15 | HTTP 200 | stage4/jem/2026-10-15.json |
| Stage IV jem 2026-10-16 | HTTP 200 | stage4/jem/2026-10-16.json |
| Stage IV jem 2026-10-17 | HTTP 200 | stage4/jem/2026-10-17.json |
| Stage IV jem 2026-10-18 | HTTP 200 | stage4/jem/2026-10-18.json |
| Stage IV jem 2026-10-19 | HTTP 200 | stage4/jem/2026-10-19.json |
| Open-Meteo forecast jem | HTTP 200 | open-meteo/jem.json |
| SDA soil butterfield | HTTP 200 | soil/butterfield.json |
| Stage IV butterfield 2026-08-18 | HTTP 200 | stage4/butterfield/2026-08-18.json |
| Stage IV butterfield 2026-08-19 | HTTP 200 | stage4/butterfield/2026-08-19.json |
| Stage IV butterfield 2026-08-20 | HTTP 200 | stage4/butterfield/2026-08-20.json |
| Stage IV butterfield 2026-08-21 | HTTP 200 | stage4/butterfield/2026-08-21.json |
| Stage IV butterfield 2026-08-22 | HTTP 200 | stage4/butterfield/2026-08-22.json |
| Stage IV butterfield 2026-08-23 | HTTP 200 | stage4/butterfield/2026-08-23.json |
| Stage IV butterfield 2026-08-24 | HTTP 200 | stage4/butterfield/2026-08-24.json |
| Stage IV butterfield 2026-08-25 | HTTP 200 | stage4/butterfield/2026-08-25.json |
| Stage IV butterfield 2026-08-26 | HTTP 200 | stage4/butterfield/2026-08-26.json |
| Stage IV butterfield 2026-08-27 | HTTP 200 | stage4/butterfield/2026-08-27.json |
| Stage IV butterfield 2026-08-28 | HTTP 200 | stage4/butterfield/2026-08-28.json |
| Stage IV butterfield 2026-08-29 | HTTP 200 | stage4/butterfield/2026-08-29.json |
| Open-Meteo forecast butterfield | HTTP 200 | open-meteo/butterfield.json |
| SDA soil deer-valley | HTTP 200 | soil/deer-valley.json |
| Stage IV deer-valley 2026-09-08 | HTTP 200 | stage4/deer-valley/2026-09-08.json |
| Stage IV deer-valley 2026-09-09 | HTTP 200 | stage4/deer-valley/2026-09-09.json |
| Stage IV deer-valley 2026-09-10 | HTTP 200 | stage4/deer-valley/2026-09-10.json |
| Stage IV deer-valley 2026-09-11 | HTTP 200 | stage4/deer-valley/2026-09-11.json |
| Stage IV deer-valley 2026-09-12 | HTTP 200 | stage4/deer-valley/2026-09-12.json |
| Stage IV deer-valley 2026-09-13 | HTTP 200 | stage4/deer-valley/2026-09-13.json |
| Stage IV deer-valley 2026-09-14 | HTTP 200 | stage4/deer-valley/2026-09-14.json |
| Stage IV deer-valley 2026-09-15 | HTTP 200 | stage4/deer-valley/2026-09-15.json |
| Stage IV deer-valley 2026-09-16 | HTTP 200 | stage4/deer-valley/2026-09-16.json |
| Stage IV deer-valley 2026-09-17 | HTTP 200 | stage4/deer-valley/2026-09-17.json |
| Stage IV deer-valley 2026-09-18 | HTTP 200 | stage4/deer-valley/2026-09-18.json |
| Stage IV deer-valley 2026-09-19 | HTTP 200 | stage4/deer-valley/2026-09-19.json |
| Open-Meteo forecast deer-valley | HTTP 200 | open-meteo/deer-valley.json |
| SDA soil lehis-dream | HTTP 200 | soil/lehis-dream.json |
| Stage IV lehis-dream 2026-04-20 | HTTP 200 | stage4/lehis-dream/2026-04-20.json |
| Stage IV lehis-dream 2026-04-21 | HTTP 200 | stage4/lehis-dream/2026-04-21.json |
| Stage IV lehis-dream 2026-04-22 | HTTP 200 | stage4/lehis-dream/2026-04-22.json |
| Stage IV lehis-dream 2026-04-23 | HTTP 200 | stage4/lehis-dream/2026-04-23.json |
| Stage IV lehis-dream 2026-04-24 | HTTP 200 | stage4/lehis-dream/2026-04-24.json |
| Stage IV lehis-dream 2026-04-25 | HTTP 200 | stage4/lehis-dream/2026-04-25.json |
| Stage IV lehis-dream 2026-04-26 | HTTP 200 | stage4/lehis-dream/2026-04-26.json |
| Stage IV lehis-dream 2026-04-27 | HTTP 200 | stage4/lehis-dream/2026-04-27.json |
| Stage IV lehis-dream 2026-04-28 | HTTP 200 | stage4/lehis-dream/2026-04-28.json |
| Stage IV lehis-dream 2026-04-29 | HTTP 200 | stage4/lehis-dream/2026-04-29.json |
| Stage IV lehis-dream 2026-04-30 | HTTP 200 | stage4/lehis-dream/2026-04-30.json |
| Stage IV lehis-dream 2026-05-01 | HTTP 200 | stage4/lehis-dream/2026-05-01.json |
| Open-Meteo archive lehis-dream | HTTP 200 | open-meteo/lehis-dream.json |

## SDA query shape (spec §3.1), per point coordinate

```sql
SELECT TOP 1 c.hydgrp, c.drainagecl, ch.sandtotal_r, ch.claytotal_r, ch.fraggt10_r, ch.frag3to10_r
FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(<lon> <lat>)') k
JOIN mapunit mu ON mu.mukey = k.mukey
JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes'
LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0
ORDER BY c.comppct_r DESC
```
