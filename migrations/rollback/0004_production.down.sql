-- Rollback for 0004_production.sql (destroys production data; export first).
DROP TABLE IF EXISTS prompt_templates;
DROP TABLE IF EXISTS learning_progress;
DROP TABLE IF EXISTS provider_jobs;
DROP TABLE IF EXISTS media_assets;
DROP TABLE IF EXISTS scene_versions;
DROP TABLE IF EXISTS scenes;
DROP TABLE IF EXISTS productions;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS voice_assignments;
DROP TABLE IF EXISTS voice_profile_settings;
