-- Rollback for 0018_youtube_analytics.sql
DROP TABLE IF EXISTS yt_watch_cache;
DROP TABLE IF EXISTS yt_oauth_state;
DROP TABLE IF EXISTS yt_auth;
