-- Ganesha AI Studio — CBO chat history (additive). One running conversation the owner can clear.
-- Rollback: migrations/rollback/0009_cbo_chat.down.sql
CREATE TABLE IF NOT EXISTS cbo_chat (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  engine      TEXT,
  model       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbo_chat_time ON cbo_chat(created_at);
