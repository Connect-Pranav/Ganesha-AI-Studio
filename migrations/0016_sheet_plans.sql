-- Ganesha AI Studio — Character Sheet Agent runs (LittleLoop): inventory, library matches and Gemini
-- model-sheet prompts for missing characters (additive). Rollback: migrations/rollback/0016_sheet_plans.down.sql
CREATE TABLE IF NOT EXISTS sheet_plans (
  id          TEXT PRIMARY KEY,
  brand       TEXT NOT NULL DEFAULT 'littleloop',
  project     TEXT NOT NULL,
  plan_json   TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
