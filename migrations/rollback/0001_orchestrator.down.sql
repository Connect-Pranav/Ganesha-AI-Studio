-- Rollback for 0001_orchestrator.sql. Destroys orchestrator data — export first:
--   npx wrangler d1 export ganesha --remote --output backup.sql
DROP TABLE IF EXISTS agent_settings;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS provider_calls;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS workflows;
