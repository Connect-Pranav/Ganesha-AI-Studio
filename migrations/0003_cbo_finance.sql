-- Ganesha AI Studio — GANESHA CBO / CFO layer (additive; safe on an existing database).
-- Rollback: migrations/rollback/0003_cbo_finance.down.sql

-- Key/value studio settings: dispatch pause, approval thresholds, FX rate, provider billing tier.
CREATE TABLE IF NOT EXISTS studio_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Spending limits in INR. scope_ref: '' for monthly_total, provider id, workflow id, or '*' for every task.
CREATE TABLE IF NOT EXISTS budgets (
  id               TEXT PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('monthly_total','provider','project','task')),
  scope_ref        TEXT NOT NULL DEFAULT '',
  limit_inr        REAL NOT NULL CHECK (limit_inr >= 0),
  warn_pct         REAL NOT NULL DEFAULT 80,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (scope, scope_ref)
);

-- Owner-entered or owner-corrected prices. Seeded verified prices live in worker/finance.mjs.
CREATE TABLE IF NOT EXISTS provider_pricing (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_per_mtok  REAL,
  output_per_mtok REAL,
  cache_read_per_mtok REAL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  effective_from  TEXT NOT NULL DEFAULT '1970-01-01',
  effective_to    TEXT,
  free_tier       INTEGER NOT NULL DEFAULT 0,
  source_url      TEXT NOT NULL,
  verified_at     TEXT NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pricing_model ON provider_pricing(provider, model);

-- Preflight estimate per dispatch attempt (or per plan step when task_id is null).
CREATE TABLE IF NOT EXISTS cost_estimates (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT,
  workflow_id        TEXT,
  agent_id           TEXT NOT NULL,
  provider           TEXT,
  model              TEXT,
  est_input_tokens   INTEGER,
  est_output_tokens  INTEGER,
  est_calls          REAL,
  direct_usd         REAL,
  conservative_usd   REAL,
  direct_inr         REAL,
  conservative_inr   REAL,
  duration_sec       INTEGER,
  confidence         TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  decision           TEXT NOT NULL,
  assumptions_json   TEXT NOT NULL DEFAULT '[]',
  pricing_json       TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_estimates_task ON cost_estimates(task_id, created_at);

-- Reservation ledger: money held for a task between dispatch and reconciliation.
CREATE TABLE IF NOT EXISTS budget_reservations (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL,
  workflow_id  TEXT NOT NULL,
  provider     TEXT,
  amount_inr   REAL NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active','consumed','released')),
  created_at   TEXT NOT NULL,
  closed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON budget_reservations(status, provider);

-- Actual cost per task attempt, reconciled from provider_calls.
CREATE TABLE IF NOT EXISTS cost_ledger (
  id             TEXT PRIMARY KEY,
  task_id        TEXT,
  workflow_id    TEXT,
  provider       TEXT NOT NULL,
  model          TEXT,
  purpose        TEXT NOT NULL DEFAULT 'task',
  calls          INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  amount_usd     REAL,
  amount_inr     REAL,
  fx_rate        REAL,
  fx_at          TEXT,
  basis          TEXT NOT NULL,
  estimate_id    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON cost_ledger(created_at, provider);
CREATE INDEX IF NOT EXISTS idx_ledger_task ON cost_ledger(task_id);

-- Task management fields that the tasks table does not have.
CREATE TABLE IF NOT EXISTS task_meta (
  task_id          TEXT PRIMARY KEY,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  deadline         TEXT,
  budget_override  INTEGER NOT NULL DEFAULT 0,
  reassigned_from  TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_meta (
  workflow_id  TEXT PRIMARY KEY,
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  deadline     TEXT,
  updated_at   TEXT NOT NULL
);

-- Consumer subscriptions the owner pays for (not API access).
CREATE TABLE IF NOT EXISTS subscriptions (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  provider         TEXT NOT NULL,
  amount           REAL NOT NULL CHECK (amount >= 0),
  currency         TEXT NOT NULL DEFAULT 'INR',
  amount_inr       REAL,
  billing_cycle    TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  includes_api     INTEGER NOT NULL DEFAULT 0,
  renews_on        TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
