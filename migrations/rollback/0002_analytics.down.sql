-- Rollback for 0002_analytics.sql. Destroys analytics history — export first.
DROP TABLE IF EXISTS analytics_snapshots;
