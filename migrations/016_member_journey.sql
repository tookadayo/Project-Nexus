CREATE INDEX IF NOT EXISTS lifecycle_episode_time ON lifecycle_events(organization_id,guild_id,episode_id,occurred_at);
CREATE INDEX IF NOT EXISTS membership_join_time ON membership_episodes(organization_id,guild_id,joined_at) WHERE context='PRODUCTION';
CREATE INDEX IF NOT EXISTS lifecycle_channel_time ON lifecycle_events(organization_id,guild_id,(data->>'channelId'),occurred_at) WHERE context='PRODUCTION';
ALTER TABLE weekly_summary_deliveries ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE weekly_summary_deliveries ADD COLUMN IF NOT EXISTS status_note text;
CREATE TABLE IF NOT EXISTS guild_command_sync(organization_id uuid NOT NULL,guild_id text NOT NULL,definition_hash text NOT NULL,registered_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
