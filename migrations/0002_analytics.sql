-- Ganesha AI Studio — brand analytics snapshots (additive).
-- Each row is one real fetch from a platform API. Keeping every fetch gives
-- true growth history (no estimated or back-filled numbers).
-- Rollback: migrations/rollback/0002_analytics.down.sql

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id            TEXT PRIMARY KEY,
  brand         TEXT NOT NULL,
  source        TEXT NOT NULL,          -- e.g. 'youtube_data_api'
  account_ref   TEXT NOT NULL,          -- channel handle / id
  fetched_at    TEXT NOT NULL,
  data_json     TEXT NOT NULL,          -- channel totals + per-video public statistics
  insights_json TEXT,                   -- SOMA written analysis of this snapshot (optional)
  insights_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_analytics_brand ON analytics_snapshots(brand, fetched_at);
