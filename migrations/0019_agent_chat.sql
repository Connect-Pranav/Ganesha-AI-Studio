-- Ganesha AI Studio — talk to any agent (each agent keeps its own conversation). Additive.
-- Rollback: migrations/rollback/0019_agent_chat.down.sql
CREATE TABLE IF NOT EXISTS agent_chat (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content      TEXT NOT NULL,
  engine       TEXT,
  model        TEXT,
  action_json  TEXT,
  sources_json TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_chat_agent ON agent_chat(agent_id, created_at);
