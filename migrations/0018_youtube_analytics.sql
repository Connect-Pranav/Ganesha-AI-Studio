-- Ganesha AI Studio — YouTube Analytics connection for Sunverse (watch time). Additive.
-- The owner signs in with Google once; only the refresh token is stored, AES-GCM encrypted.
-- Rollback: migrations/rollback/0018_youtube_analytics.down.sql
CREATE TABLE IF NOT EXISTS yt_auth (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  token_enc      TEXT NOT NULL,
  iv             TEXT NOT NULL,
  channel_id     TEXT,
  channel_title  TEXT,
  created_at     TEXT NOT NULL,
  refreshed_at   TEXT
);

CREATE TABLE IF NOT EXISTS yt_oauth_state (
  state       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

-- Last watch-time report (owner-only), so the page does not call YouTube on every view.
CREATE TABLE IF NOT EXISTS yt_watch_cache (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  data_json   TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);
