-- Ganesha AI Studio — CBO Autopilot: goals the CBO proposes or starts on its own (additive).
-- Rollback: migrations/rollback/0006_autopilot.down.sql
CREATE TABLE IF NOT EXISTS autopilot_proposals (
  id            TEXT PRIMARY KEY,
  day           TEXT NOT NULL,
  brand         TEXT NOT NULL,
  template      TEXT NOT NULL,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  est_inr       REAL,
  est_usd       REAL,
  status        TEXT NOT NULL CHECK (status IN ('proposed','started','rejected','expired')),
  decided_by    TEXT,
  workflow_id   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (day, template)
);
CREATE INDEX IF NOT EXISTS idx_autopilot_day ON autopilot_proposals(day, status);
