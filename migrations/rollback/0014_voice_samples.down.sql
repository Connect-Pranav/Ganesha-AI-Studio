-- Rollback for 0014_voice_samples.sql (KV objects under voice/* are left; delete them separately if needed)
DROP TABLE IF EXISTS voice_samples;
