-- Ganesha AI Studio — CBO chat extras (additive): thinking summary, research sources, proposed
-- action and the Gemini interaction id that carries the conversation server-side.
-- Rollback: migrations/rollback/0010_cbo_chat_meta.down.sql
CREATE TABLE IF NOT EXISTS cbo_chat_meta (
  msg_id          TEXT PRIMARY KEY,
  interaction_id  TEXT,
  thoughts        TEXT,
  sources_json    TEXT,
  action_json     TEXT,
  mode_json       TEXT
);
