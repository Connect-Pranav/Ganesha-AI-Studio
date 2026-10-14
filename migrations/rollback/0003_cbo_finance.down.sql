-- Rollback for 0003_cbo_finance.sql (destroys CBO/CFO data; export first).
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS workflow_meta;
DROP TABLE IF EXISTS task_meta;
DROP TABLE IF EXISTS cost_ledger;
DROP TABLE IF EXISTS budget_reservations;
DROP TABLE IF EXISTS cost_estimates;
DROP TABLE IF EXISTS provider_pricing;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS studio_settings;
