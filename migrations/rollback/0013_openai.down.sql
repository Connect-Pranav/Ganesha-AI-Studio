-- Rollback for 0013_openai.sql
DROP INDEX IF EXISTS idx_pcd_agent;
DROP TABLE IF EXISTS provider_call_details;
DROP TABLE IF EXISTS studio_prefs;
