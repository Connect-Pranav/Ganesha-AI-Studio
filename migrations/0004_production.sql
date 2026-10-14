-- Ganesha AI Studio — voice library, characters, scenes, media assets, provider jobs (additive).
-- Rollback: migrations/rollback/0004_production.down.sql

-- The 10 signature profiles are defined in worker/voices.mjs; this holds owner configuration.
CREATE TABLE IF NOT EXISTS voice_profile_settings (
  profile_id         TEXT PRIMARY KEY,
  provider           TEXT,
  provider_voice_id  TEXT,
  favorite           INTEGER NOT NULL DEFAULT 0,
  preview_ref        TEXT,
  updated_at         TEXT NOT NULL
);

-- Approved voice per project role or per character. Locked rows need explicit confirmation to change.
CREATE TABLE IF NOT EXISTS voice_assignments (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('project','character')),
  scope_ref     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'main',
  profile_id    TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('speech','singing')),
  locked        INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  reason        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (scope, scope_ref, role)
);

CREATE TABLE IF NOT EXISTS characters (
  id                    TEXT PRIMARY KEY,
  brand                 TEXT NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  appearance            TEXT NOT NULL DEFAULT '',
  wardrobe              TEXT NOT NULL DEFAULT '',
  personality           TEXT NOT NULL DEFAULT '',
  language              TEXT NOT NULL DEFAULT '',
  style_constraints     TEXT NOT NULL DEFAULT '',
  reference_assets_json TEXT NOT NULL DEFAULT '[]',
  approved              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (brand, name)
);

-- A production project groups scenes (optionally linked to a workflow).
CREATE TABLE IF NOT EXISTS productions (
  id            TEXT PRIMARY KEY,
  brand         TEXT NOT NULL,
  title         TEXT NOT NULL,
  format        TEXT NOT NULL,
  pillar        TEXT NOT NULL,
  method        TEXT NOT NULL,
  workflow_id   TEXT,
  brief         TEXT NOT NULL DEFAULT '',
  requirements_json TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','in_production','qc','approved','exported','cancelled')),
  deadline      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id              TEXT PRIMARY KEY,
  production_id   TEXT NOT NULL,
  ord             INTEGER NOT NULL,
  title           TEXT NOT NULL,
  prompt          TEXT NOT NULL DEFAULT '',
  characters_json TEXT NOT NULL DEFAULT '[]',
  voice_json      TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','prompt_ready','manual_generation','generated','approved','rejected')),
  version         INTEGER NOT NULL DEFAULT 1,
  qc_json         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenes_production ON scenes(production_id, ord);

CREATE TABLE IF NOT EXISTS scene_versions (
  id              TEXT PRIMARY KEY,
  scene_id        TEXT NOT NULL,
  version         INTEGER NOT NULL,
  prompt          TEXT NOT NULL,
  characters_json TEXT NOT NULL,
  voice_json      TEXT NOT NULL,
  reason          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (scene_id, version)
);

-- References to files that live elsewhere (Flow, Canva, Drive, YouTube). No binaries in D1.
CREATE TABLE IF NOT EXISTS media_assets (
  id             TEXT PRIMARY KEY,
  production_id  TEXT,
  scene_id       TEXT,
  brand          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('image','video','audio','design','document','other')),
  provider       TEXT NOT NULL,
  external_ref   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','verified','missing','rejected')),
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_production ON media_assets(production_id);

-- External generation jobs. 'manual_handoff' = the owner runs it in the provider's own app.
CREATE TABLE IF NOT EXISTS provider_jobs (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  kind           TEXT NOT NULL,
  production_id  TEXT,
  scene_id       TEXT,
  status         TEXT NOT NULL CHECK (status IN ('prepared','manual_handoff','submitted','running','succeeded','failed','cancelled')),
  external_id    TEXT,
  request_json   TEXT NOT NULL DEFAULT '{}',
  result_json    TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_production ON provider_jobs(production_id, status);

CREATE TABLE IF NOT EXISTS learning_progress (
  module_id   TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('not_started','in_progress','done')),
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  body_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
