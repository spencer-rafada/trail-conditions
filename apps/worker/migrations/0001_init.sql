-- M3: full D1 schema, spec §8 verbatim (tables and the three indexes).
-- Applied locally only: wrangler d1 migrations apply trail-conditions --local

CREATE TABLE trails (
  id TEXT PRIMARY KEY, name TEXT, system TEXT, county TEXT,
  osm_ref TEXT, tau_base_h REAL, tau_mult REAL DEFAULT 1.0,
  reports_used INTEGER DEFAULT 0
);

CREATE TABLE trail_points (
  id TEXT PRIMARY KEY, trail_id TEXT, label TEXT,       -- "Trailhead", "Top"
  lat REAL, lon REAL, elev_m REAL,
  sand REAL, clay REAL, rock REAL, hydgrp TEXT, drainage TEXT,
  cell_id TEXT                                          -- "gridi:gridj"
);

CREATE TABLE rain_hourly (cell_id TEXT, ts_utc TEXT, precip_in REAL, source TEXT,
  PRIMARY KEY (cell_id, ts_utc));

CREATE TABLE scores_latest (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT, updated_utc TEXT);

CREATE TABLE score_history (trail_id TEXT, ts_utc TEXT, wetness REAL, level TEXT, confidence INTEGER,
  PRIMARY KEY (trail_id, ts_utc));                      -- "now" only, hourly

CREATE TABLE reports (
  id TEXT PRIMARY KEY, trail_id TEXT, created_utc TEXT,
  verdict TEXT CHECK (verdict IN ('yes','wetter','drier')),
  tags TEXT,                                            -- JSON array
  device_id TEXT, ip_hash TEXT,
  model_wetness REAL, model_level TEXT
);

CREATE TABLE tau_history (trail_id TEXT, ts_utc TEXT, old_mult REAL, new_mult REAL, n_reports INTEGER);

CREATE INDEX idx_reports_trail_created ON reports (trail_id, created_utc);
CREATE INDEX idx_reports_device_trail_created ON reports (device_id, trail_id, created_utc);
CREATE INDEX idx_reports_ip_created ON reports (ip_hash, created_utc);
