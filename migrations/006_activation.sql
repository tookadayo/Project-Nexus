CREATE TABLE activation_members (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,revision_id uuid NOT NULL,activated_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,episode_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES guild_config_revisions ON DELETE CASCADE
);
CREATE TABLE member_observable_state (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,roles text[] NOT NULL DEFAULT '{}',
 roles_observed_at timestamptz,voice_channel_id text,voice_started_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,episode_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
