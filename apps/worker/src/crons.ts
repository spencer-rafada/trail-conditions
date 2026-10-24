// Cron strings, matched byte-for-byte against wrangler.toml's [triggers]
// (Cloudflare hands the firing cron's string to `scheduled` as event.cron).
// They live outside src/index.ts on purpose: workerd treats every named
// export of the entry module as an entrypoint and refuses a string value,
// so exporting them from the entry broke `wrangler dev` and deploys.

/** §7.3 cron 1: score job, one chunk per run. */
export const SCORE_CRON = "*/10 * * * *";
/** §7.3 cron 2: nightly tune at 10:00 UTC — 03:00 MST / 04:00 MDT (ticket
 *  C-20261023-M6 decision 5: one fixed UTC hour, documented, no DST code). */
export const TUNE_CRON = "0 10 * * *";
