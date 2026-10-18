-- Ganesha AI Studio — OpenAI Responses API integration (additive).
-- provider_calls has no columns for cached/reasoning tokens, request IDs or the responsible agent, and
-- migrations may not ALTER tables, so those details live in a side table keyed by provider_calls.id.
-- studio_prefs is a small key/value store for owner choices such as the LittleLoop script engine.
-- Rollback: migrations/rollback/0013_openai.down.sql
CREATE TABLE IF NOT EXISTS provider_call_details (
  call_id              TEXT PRIMARY KEY,
  cached_input_tokens  INTEGER,
  reasoning_tokens     INTEGER,
  request_id           TEXT,
  agent_id             TEXT,
  workflow_id          TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pcd_agent ON provider_call_details(agent_id, created_at);
CREATE TABLE IF NOT EXISTS studio_prefs (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
