-- Ganesha AI Studio — Reel Factory: Google Flow render mode (additive).
-- Flow has no API: clips are made in Google Flow (free AI Pro credits), sent to Ganesha with a
-- per-reel upload ticket, joined + QC'd by the runner, then shown for approval as usual.
-- Rollback: migrations/rollback/0008_reels_flow.down.sql
CREATE TABLE IF NOT EXISTS reel_prefs (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  render_mode     TEXT NOT NULL DEFAULT 'flow' CHECK (render_mode IN ('flow','api')),
  flow_model      TEXT NOT NULL DEFAULT 'Veo 3.1 Lite',
  updated_at      TEXT
);
CREATE TABLE IF NOT EXISTS reel_flow (
  reel_id         TEXT PRIMARY KEY,
  stage           TEXT NOT NULL CHECK (stage IN ('awaiting_clips','clips_uploaded','joining')),
  ticket          TEXT NOT NULL UNIQUE,
  ticket_expires  TEXT NOT NULL,
  clips_json      TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reel_flow_stage ON reel_flow(stage);
