-- Ganesha AI Studio — Instagram connection via "Connect Instagram" (Instagram API with Instagram Login).
-- The long-lived token is stored AES-GCM-encrypted with a key derived from the IG_APP_SECRET Worker secret.
-- Rollback: migrations/rollback/0011_instagram_auth.down.sql
CREATE TABLE IF NOT EXISTS ig_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  token_enc     TEXT NOT NULL,
  iv            TEXT NOT NULL,
  ig_user_id    TEXT,
  username      TEXT,
  expires_at    TEXT,
  refreshed_at  TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ig_oauth_state (
  state       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);
