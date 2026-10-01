-- Additive: alpha.3 episodes and envelopes retain their original interpretation.
ALTER TABLE membership_episodes ADD COLUMN engagement_started_at timestamptz;
ALTER TABLE membership_episodes ADD COLUMN screening_pending boolean NOT NULL DEFAULT false;
ALTER TABLE membership_episodes ADD COLUMN is_guest boolean NOT NULL DEFAULT false;
ALTER TABLE membership_episodes ADD COLUMN member_flags integer NOT NULL DEFAULT 0;
CREATE TABLE guild_capability_snapshots (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, snapshot jsonb NOT NULL, checked_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE INDEX capability_snapshot_latest ON guild_capability_snapshots(organization_id,guild_id,checked_at DESC);
CREATE TABLE capability_refresh_jobs (
 organization_id uuid NOT NULL, guild_id text NOT NULL, due_at timestamptz NOT NULL, reason text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,guild_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE discord_surface_state (
 organization_id uuid NOT NULL, guild_id text NOT NULL, channel_id text NOT NULL, parent_id text, channel_type integer NOT NULL, owner_hash text,
 archived boolean NOT NULL DEFAULT false, locked boolean NOT NULL DEFAULT false, created_at timestamptz, tag_ids text[] NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,channel_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE INDEX discord_surface_parent ON discord_surface_state(organization_id,guild_id,parent_id);
CREATE TABLE adaptive_states (
 organization_id uuid NOT NULL, guild_id text NOT NULL, domain text NOT NULL, state_key text NOT NULL, subject_hash text NOT NULL DEFAULT '', target_hash text,
 data jsonb NOT NULL, observed_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,domain,state_key,subject_hash), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE INDEX adaptive_states_subject ON adaptive_states(organization_id,guild_id,subject_hash);
CREATE INDEX adaptive_states_target ON adaptive_states(organization_id,guild_id,target_hash) WHERE target_hash IS NOT NULL;
CREATE INDEX adaptive_states_channel ON adaptive_states(organization_id,guild_id,domain,(data->>'channelId'));
CREATE TABLE adaptive_facts (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, kind text NOT NULL, subject_hash text NOT NULL DEFAULT '', target_hash text,
 episode_id uuid, occurred_at timestamptz NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes(organization_id,guild_id,id) ON DELETE CASCADE);
CREATE INDEX adaptive_facts_window ON adaptive_facts(organization_id,guild_id,occurred_at,kind);
CREATE INDEX adaptive_facts_subject ON adaptive_facts(organization_id,guild_id,subject_hash);
CREATE INDEX adaptive_facts_target ON adaptive_facts(organization_id,guild_id,target_hash) WHERE target_hash IS NOT NULL;
CREATE UNIQUE INDEX adaptive_participation_once ON adaptive_facts(organization_id,guild_id,kind,subject_hash,(data->>'eventId')) WHERE kind='scheduled_event.attended';
CREATE UNIQUE INDEX adaptive_poll_once ON adaptive_facts(organization_id,guild_id,kind,subject_hash,(data->>'messageId')) WHERE kind='poll.participated';
CREATE UNIQUE INDEX adaptive_thread_response_once ON adaptive_facts(organization_id,guild_id,kind,(data->>'channelId')) WHERE kind='thread.response_received';
