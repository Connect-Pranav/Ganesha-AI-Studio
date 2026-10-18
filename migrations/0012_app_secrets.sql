-- Ganesha AI Studio — keys entered in the app's Settings page (additive). Values are AES-GCM encrypted
-- with a key derived from the Worker secret ADMIN_TOKEN; a Worker secret with the same name always wins.
-- Rollback: migrations/rollback/0012_app_secrets.down.sql
CREATE TABLE IF NOT EXISTS app_secrets (
  name        TEXT PRIMARY KEY,
  enc         TEXT NOT NULL,
  iv          TEXT NOT NULL,
  last4       TEXT,
  updated_at  TEXT NOT NULL
);
