-- Rollback for 0011_instagram_auth.sql
DROP TABLE IF EXISTS ig_oauth_state;
DROP TABLE IF EXISTS ig_auth;
