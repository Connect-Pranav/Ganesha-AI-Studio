-- Ganesha Brain: long-term memory, a skills library, and missions (Think → Plan → Execute)
-- that chain several agents and deliver results to free connectors after owner approval. Additive.
-- Rollback: migrations/rollback/0021_brain.down.sql
CREATE TABLE IF NOT EXISTS brain_memory (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  agent_id    TEXT,
  fact        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('owner','chat','mission')),
  pinned      INTEGER NOT NULL DEFAULT 0,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brain_memory_scope ON brain_memory(scope, updated_at);

CREATE TABLE IF NOT EXISTS brain_skills (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  instructions  TEXT NOT NULL,
  brand         TEXT NOT NULL DEFAULT 'studio',
  uses          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id            TEXT PRIMARY KEY,
  goal          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('planning','awaiting_approval','running','done','failed','rejected','cancelled')),
  thinking      TEXT,
  criteria_json TEXT NOT NULL DEFAULT '[]',
  deliver_json  TEXT NOT NULL DEFAULT '[]',
  result        TEXT,
  error         TEXT,
  engine        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status, updated_at);

CREATE TABLE IF NOT EXISTS mission_steps (
  id           TEXT PRIMARY KEY,
  mission_id   TEXT NOT NULL,
  idx          INTEGER NOT NULL,
  agent_id     TEXT NOT NULL,
  title        TEXT NOT NULL,
  instruction  TEXT NOT NULL,
  skill_id     TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  output       TEXT,
  check_json   TEXT,
  engine       TEXT,
  model        TEXT,
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mission_steps_mission ON mission_steps(mission_id, idx);

CREATE TABLE IF NOT EXISTS mission_deliveries (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL,
  target      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  url         TEXT,
  message     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_deliveries_mission ON mission_deliveries(mission_id);
