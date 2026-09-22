CREATE TABLE reply_receipts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,reply_message_id text NOT NULL,episode_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,reply_message_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE TABLE experiment_controls (
 organization_id uuid NOT NULL,guild_id text NOT NULL,revision_id uuid NOT NULL,state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','paused','stopped')),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,revision_id),FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES guild_config_revisions ON DELETE CASCADE
);
