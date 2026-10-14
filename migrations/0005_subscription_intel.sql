-- Ganesha AI Studio — Subscription Intelligence (additive; safe on an existing database).
-- Every row carries where it came from (source), when (retrieved/synced) and a status from the
-- availability model: LIVE, RECENT, IMPORTED, CALCULATED, ESTIMATED, UNAVAILABLE, NEEDS_AUTHORIZATION, ERROR.
-- Rollback: migrations/rollback/0005_subscription_intel.down.sql

-- Current value of one field for one service/record (e.g. claude · consumer_subscription · next_renewal).
CREATE TABLE IF NOT EXISTS sub_facts (
  id            TEXT PRIMARY KEY,
  service       TEXT NOT NULL,
  record        TEXT NOT NULL,
  field         TEXT NOT NULL,
  value_json    TEXT,
  unit          TEXT,
  status        TEXT NOT NULL CHECK (status IN ('LIVE','RECENT','IMPORTED','CALCULATED','ESTIMATED','UNAVAILABLE','NEEDS_AUTHORIZATION','ERROR')),
  source        TEXT NOT NULL,
  retrieved_at  TEXT NOT NULL,
  window_start  TEXT,
  window_end    TEXT,
  confidence    TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  note          TEXT,
  UNIQUE (service, record, field)
);

-- Invoices / receipts / provider cost buckets. dedupe_key prevents double counting across imports and syncs.
CREATE TABLE IF NOT EXISTS billing_records (
  id            TEXT PRIMARY KEY,
  service       TEXT NOT NULL,
  record        TEXT NOT NULL CHECK (record IN ('consumer_subscription','api_billing')),
  description   TEXT,
  period_start  TEXT,
  period_end    TEXT,
  paid_on       TEXT,
  amount        REAL NOT NULL,
  tax           REAL,
  currency      TEXT NOT NULL,
  amount_inr    REAL,
  fx_rate       REAL,
  status        TEXT NOT NULL CHECK (status IN ('LIVE','RECENT','IMPORTED')),
  source        TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_service ON billing_records(service, record, paid_on);

-- Provider-reported (or imported) usage. One row per natural key; a LIVE row replaces an IMPORTED one.
CREATE TABLE IF NOT EXISTS usage_ledger (
  id            TEXT PRIMARY KEY,
  service       TEXT NOT NULL,
  record        TEXT NOT NULL CHECK (record IN ('subscription_usage','api_usage')),
  day           TEXT NOT NULL DEFAULT '',
  window_start  TEXT,
  window_end    TEXT,
  model         TEXT NOT NULL DEFAULT '',
  feature       TEXT NOT NULL DEFAULT '',
  unit          TEXT NOT NULL,
  consumed      REAL,
  remaining     REAL,
  limit_value   REAL,
  reset_at      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('LIVE','RECENT','IMPORTED')),
  source        TEXT NOT NULL,
  synced_at     TEXT NOT NULL,
  UNIQUE (service, record, day, model, feature, unit)
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_ledger(service, day);

CREATE TABLE IF NOT EXISTS sync_runs (
  id           TEXT PRIMARY KEY,
  service      TEXT NOT NULL,
  adapter      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('ok','error','needs_authorization','unavailable')),
  rows         INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_service ON sync_runs(service, started_at);

-- Why the CBO picked a provider for a task (candidates, scores, reason).
CREATE TABLE IF NOT EXISTS dispatch_decisions (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL,
  chosen_provider  TEXT,
  candidates_json  TEXT NOT NULL,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_task ON dispatch_decisions(task_id, created_at);
