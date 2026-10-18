-- Ganesha AI Studio — consolidated Google Flow prompt packs per finished LittleLoop goal (additive).
-- One row per workflow; regenerated only when the owner asks. Rollback: migrations/rollback/0015_flow_packs.down.sql
CREATE TABLE IF NOT EXISTS flow_packs (
  workflow_id  TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  pack_json    TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
