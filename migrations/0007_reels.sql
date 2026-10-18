-- Ganesha AI Studio — LittleLoop Reel Factory (additive).
-- Character sheets rotate daily; each reel = 2 scenes x 10 s rendered by the GitHub Actions
-- runner (Gemini Omni Flash), stored in KV, shown for approval, then posted to Instagram.
-- Rollback: migrations/rollback/0007_reels.down.sql
CREATE TABLE IF NOT EXISTS reel_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  enabled         INTEGER NOT NULL DEFAULT 0,
  per_day         INTEGER NOT NULL DEFAULT 2,
  daily_cap_usd   REAL NOT NULL DEFAULT 5,
  est_reel_usd    REAL NOT NULL DEFAULT 2.2,
  language        TEXT NOT NULL DEFAULT 'Simple Hinglish (easy Hindi + English) for kids aged 2-8',
  brief           TEXT NOT NULL DEFAULT '',
  updated_at      TEXT
);
CREATE TABLE IF NOT EXISTS reel_sheets (
  id              TEXT PRIMARY KEY,
  brand           TEXT NOT NULL DEFAULT 'littleloop',
  name            TEXT NOT NULL,
  media_key       TEXT NOT NULL,
  mime            TEXT NOT NULL,
  bytes           INTEGER NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  details         TEXT,
  details_status  TEXT NOT NULL DEFAULT 'pending' CHECK (details_status IN ('pending','ready','error')),
  active          INTEGER NOT NULL DEFAULT 1,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (brand, name)
);
CREATE TABLE IF NOT EXISTS reels (
  id              TEXT PRIMARY KEY,
  day             TEXT NOT NULL,
  slot            INTEGER NOT NULL,
  sheet_id        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued','rendering','review','approved','publishing','published','rejected','failed')),
  script_json     TEXT,
  caption         TEXT,
  video_key       TEXT,
  video_bytes     INTEGER,
  video_meta_json TEXT,
  lease_until     TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  ig_container    TEXT,
  ig_media_id     TEXT,
  ig_permalink    TEXT,
  error           TEXT,
  decided_at      TEXT,
  published_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (day, slot)
);
CREATE INDEX IF NOT EXISTS idx_reels_status ON reels(status, day);
