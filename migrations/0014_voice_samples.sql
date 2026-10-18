-- Ganesha AI Studio — uploaded voice recordings (reference voices) per brand (additive).
-- Audio bytes live in the MEDIA KV namespace under voice/<id>; this table holds the metadata.
-- Rollback: migrations/rollback/0014_voice_samples.down.sql
CREATE TABLE IF NOT EXISTS voice_samples (
  id          TEXT PRIMARY KEY,
  brand       TEXT NOT NULL DEFAULT 'studio' CHECK (brand IN ('studio','littleloop','sunverse','foliocraft')),
  name        TEXT NOT NULL,
  media_key   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (brand, name)
);
