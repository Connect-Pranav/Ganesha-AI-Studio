-- Ganesha AI Studio — GANESHA GROWTH AI (lead generation, CRM, approval-gated outreach). Additive.
-- Brands are limited by CHECK to the three authorised Growth brands; no other brand can be stored.
-- Rollback: migrations/rollback/0017_growth.down.sql

-- Owner edits to a brand's Growth configuration (defaults live in worker/growth/brands.mjs).
CREATE TABLE IF NOT EXISTS growth_brand_config (
  brand        TEXT PRIMARY KEY CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  config_json  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_campaigns (
  id               TEXT PRIMARY KEY,
  brand            TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  name             TEXT NOT NULL,
  objective        TEXT NOT NULL CHECK (objective IN ('sponsorship','licensing','partnership','distribution','customer_acquisition','creator_collaboration')),
  segment          TEXT NOT NULL DEFAULT 'business' CHECK (segment IN ('business','individual')),
  audience         TEXT NOT NULL DEFAULT '',
  geography        TEXT NOT NULL DEFAULT '',
  criteria         TEXT NOT NULL DEFAULT '',
  threshold        INTEGER NOT NULL DEFAULT 60 CHECK (threshold BETWEEN 0 AND 100),
  daily_job_limit  INTEGER NOT NULL DEFAULT 20 CHECK (daily_job_limit BETWEEN 1 AND 500),
  max_leads        INTEGER NOT NULL DEFAULT 50 CHECK (max_leads BETWEEN 1 AND 5000),
  budget_inr       REAL NOT NULL DEFAULT 0 CHECK (budget_inr >= 0),
  research_depth   TEXT NOT NULL DEFAULT 'standard' CHECK (research_depth IN ('light','standard','deep')),
  channel          TEXT NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual','email')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','cancelled','completed')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (brand, name)
);
CREATE INDEX IF NOT EXISTS idx_growth_campaigns_brand ON growth_campaigns(brand, status);

CREATE TABLE IF NOT EXISTS growth_leads (
  id                  TEXT PRIMARY KEY,
  brand               TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  campaign_id         TEXT REFERENCES growth_campaigns(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  org_type            TEXT NOT NULL DEFAULT 'company' CHECK (org_type IN ('company','person','creator','agency','platform','community','other')),
  website             TEXT,
  dedupe_key          TEXT NOT NULL,
  contact_name        TEXT,
  contact_role        TEXT,
  contact_email       TEXT,
  geography           TEXT,
  category            TEXT,
  sources_json        TEXT NOT NULL DEFAULT '[]',
  evidence            TEXT NOT NULL DEFAULT '',
  researched_at       TEXT,
  score               INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  score_json          TEXT,
  confidence          TEXT CHECK (confidence IS NULL OR confidence IN ('low','medium','high')),
  stage               TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','researching','qualified','outreach_drafted','pending_approval','approved','sent','replied','meeting_scheduled','proposal','negotiation','won','lost','suppressed')),
  lost_reason         TEXT,
  owner               TEXT NOT NULL DEFAULT 'owner',
  next_action         TEXT,
  follow_up_at        TEXT,
  contact_permission  TEXT NOT NULL DEFAULT 'unknown' CHECK (contact_permission IN ('unknown','business_public','opted_in','denied')),
  origin              TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','import','discovery','demo')),
  last_activity_at    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (brand, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_growth_leads_brand_stage ON growth_leads(brand, stage);
CREATE INDEX IF NOT EXISTS idx_growth_leads_campaign ON growth_leads(campaign_id);

-- Every stage change, edit, research run, approval and send — the lead's audit trail.
CREATE TABLE IF NOT EXISTS growth_activities (
  id          TEXT PRIMARY KEY,
  brand       TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  lead_id     TEXT REFERENCES growth_leads(id) ON DELETE CASCADE,
  campaign_id TEXT,
  kind        TEXT NOT NULL,
  from_stage  TEXT,
  to_stage    TEXT,
  note        TEXT,
  data_json   TEXT,
  actor       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_activities_lead ON growth_activities(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_growth_activities_brand ON growth_activities(brand, created_at);

-- Outreach drafts. Approval is bound to content_hash: any edit after approval invalidates it.
CREATE TABLE IF NOT EXISTS growth_drafts (
  id                 TEXT PRIMARY KEY,
  brand              TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  lead_id            TEXT NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  campaign_id        TEXT,
  kind               TEXT NOT NULL DEFAULT 'first_contact' CHECK (kind IN ('first_contact','follow_up','reply')),
  channel            TEXT NOT NULL CHECK (channel IN ('manual','email')),
  recipient          TEXT NOT NULL,
  subject            TEXT NOT NULL DEFAULT '',
  body               TEXT NOT NULL,
  personalization    TEXT NOT NULL DEFAULT '',
  content_hash       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected','sending','sent','failed','cancelled')),
  approved_hash      TEXT,
  approved_by        TEXT,
  approved_at        TEXT,
  rejected_reason    TEXT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  sent_at            TEXT,
  delivery_json      TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_drafts_status ON growth_drafts(brand, status);

-- Opt-outs and do-not-contact entries. brand '*' applies to every Growth brand.
CREATE TABLE IF NOT EXISTS growth_suppressions (
  id          TEXT PRIMARY KEY,
  brand       TEXT NOT NULL CHECK (brand IN ('*','littleloop','sunverse','foliocraft')),
  kind        TEXT NOT NULL CHECK (kind IN ('email','domain')),
  value       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (brand, kind, value)
);

-- Replies pasted or received, with their classification.
CREATE TABLE IF NOT EXISTS growth_replies (
  id              TEXT PRIMARY KEY,
  brand           TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  lead_id         TEXT NOT NULL REFERENCES growth_leads(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  classification  TEXT CHECK (classification IS NULL OR classification IN ('interested','meeting_request','pricing_inquiry','objection','follow_up','not_interested','out_of_office','unsubscribe','unclear')),
  summary         TEXT,
  next_action     TEXT,
  needs_review    INTEGER NOT NULL DEFAULT 1,
  received_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- Meetings and follow-up tasks. A meeting is "confirmed" only when the owner says so.
CREATE TABLE IF NOT EXISTS growth_tasks (
  id          TEXT PRIMARY KEY,
  brand       TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  lead_id     TEXT REFERENCES growth_leads(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('task','meeting')),
  title       TEXT NOT NULL,
  due_at      TEXT,
  confirmed   INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_tasks_brand ON growth_tasks(brand, done);

-- Agent job log: what ran, for which brand/campaign, status, tokens and cost.
CREATE TABLE IF NOT EXISTS growth_jobs (
  id             TEXT PRIMARY KEY,
  brand          TEXT NOT NULL CHECK (brand IN ('littleloop','sunverse','foliocraft')),
  campaign_id    TEXT,
  lead_id        TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('discover','research','qualify','draft','classify_reply')),
  agent_id       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','blocked')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  provider       TEXT,
  model          TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cost_usd       REAL,
  error          TEXT,
  summary        TEXT,
  created_at     TEXT NOT NULL,
  finished_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_growth_jobs_campaign ON growth_jobs(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_growth_jobs_brand ON growth_jobs(brand, created_at);
