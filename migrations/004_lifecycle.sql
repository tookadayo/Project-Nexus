CREATE UNIQUE INDEX lifecycle_message_unique ON lifecycle_events(organization_id,guild_id,context,(data->>'messageId')) WHERE kind='message.sent';
CREATE UNIQUE INDEX lifecycle_once_per_episode ON lifecycle_events(organization_id,guild_id,episode_id,context,kind) WHERE kind IN ('member.joined','member.rejoined','member.left','activation.completed');
CREATE TABLE member_lifecycle_state (organization_id uuid NOT NULL, guild_id text NOT NULL, episode_id uuid NOT NULL, context text NOT NULL, activated_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,episode_id), FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE);
