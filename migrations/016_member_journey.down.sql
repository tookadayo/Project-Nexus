ALTER TABLE weekly_summary_deliveries DROP COLUMN IF EXISTS status_note;
DROP TABLE IF EXISTS guild_command_sync;
ALTER TABLE weekly_summary_deliveries DROP COLUMN IF EXISTS lease_until;
DROP INDEX IF EXISTS lifecycle_channel_time;
DROP INDEX IF EXISTS membership_join_time;
DROP INDEX IF EXISTS lifecycle_episode_time;
