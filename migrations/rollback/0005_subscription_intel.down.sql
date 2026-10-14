-- Rollback for 0005_subscription_intel.sql (destroys subscription intelligence data; export first).
DROP TABLE IF EXISTS dispatch_decisions;
DROP TABLE IF EXISTS sync_runs;
DROP TABLE IF EXISTS usage_ledger;
DROP TABLE IF EXISTS billing_records;
DROP TABLE IF EXISTS sub_facts;
