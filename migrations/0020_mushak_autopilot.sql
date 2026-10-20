-- Ganesha AI Studio — MUSHAK autopilot: a growth cycle every few hours with a full record of what
-- went in (inputs), what was planned and why (plan), and what came out (outputs). Additive.
-- Rollback: migrations/rollback/0020_mushak_autopilot.down.sql
CREATE TABLE IF NOT EXISTS growth_settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  autopilot    INTEGER NOT NULL DEFAULT 1,
  every_hours  INTEGER NOT NULL DEFAULT 4 CHECK (every_hours BETWEEN 1 AND 24),
  max_steps    INTEGER NOT NULL DEFAULT 8 CHECK (max_steps BETWEEN 1 AND 30),
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_cycles (
  id            TEXT PRIMARY KEY,
  trigger_kind  TEXT NOT NULL CHECK (trigger_kind IN ('schedule','manual')),
  status        TEXT NOT NULL CHECK (status IN ('running','done','partial','skipped','failed')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  inputs_json   TEXT NOT NULL DEFAULT '{}',
  plan_json     TEXT NOT NULL DEFAULT '[]',
  outputs_json  TEXT,
  summary       TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_growth_cycles_time ON growth_cycles(started_at);
