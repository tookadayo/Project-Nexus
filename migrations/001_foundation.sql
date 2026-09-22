CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE guilds (organization_id uuid NOT NULL REFERENCES organizations(id), guild_id text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,guild_id));
CREATE TABLE guild_settings (organization_id uuid NOT NULL, guild_id text NOT NULL, revision integer NOT NULL DEFAULT 0,
 settings jsonb NOT NULL, PRIMARY KEY(organization_id,guild_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE member_identity_map (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL,
 lookup_hash text NOT NULL, encrypted_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id), UNIQUE(organization_id,guild_id,lookup_hash), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE membership_episodes (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, identity_id uuid NOT NULL,
 joined_at timestamptz NOT NULL, left_at timestamptz, context text NOT NULL CHECK(context IN ('PRODUCTION','TEST','PREVIEW')),
 PRIMARY KEY(organization_id,guild_id,id), UNIQUE(organization_id,guild_id,identity_id,joined_at,context),
 FOREIGN KEY(organization_id,guild_id,identity_id) REFERENCES member_identity_map ON DELETE CASCADE,
 CHECK(left_at IS NULL OR left_at>=joined_at));
CREATE TABLE flow_versions (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, version integer NOT NULL,
 definition jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id), UNIQUE(organization_id,guild_id,version), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE FUNCTION reject_flow_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published flows are immutable'; END $$;
CREATE TRIGGER immutable_flow BEFORE UPDATE ON flow_versions FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
CREATE TABLE flow_sessions (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, episode_id uuid NOT NULL,
 flow_version_id uuid NOT NULL, revision integer NOT NULL DEFAULT 0, state jsonb NOT NULL, context text NOT NULL CHECK(context IN ('PRODUCTION','TEST','PREVIEW')),
 PRIMARY KEY(organization_id,guild_id,id), FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,flow_version_id) REFERENCES flow_versions ON DELETE CASCADE);
CREATE TABLE event_inbox (organization_id uuid NOT NULL, guild_id text NOT NULL, dedupe_key text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,guild_id,dedupe_key), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE lifecycle_events (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, episode_id uuid NOT NULL,
 kind text NOT NULL, occurred_at timestamptz NOT NULL, context text NOT NULL CHECK(context IN ('PRODUCTION','TEST','PREVIEW')), data jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(organization_id,guild_id,id), FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE);
CREATE INDEX lifecycle_time ON lifecycle_events(organization_id,guild_id,occurred_at);
CREATE TABLE action_outbox (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, dedupe_key text NOT NULL,
 kind text NOT NULL, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,guild_id,id),
 UNIQUE(organization_id,guild_id,dedupe_key), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE nexus_role_grants (organization_id uuid NOT NULL, guild_id text NOT NULL, episode_id uuid NOT NULL, role_id text NOT NULL,
 action_id uuid NOT NULL, source text NOT NULL DEFAULT 'ONBOARDING', flow_version_id uuid NOT NULL, node_id text NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,episode_id,role_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,action_id) REFERENCES action_outbox ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,flow_version_id) REFERENCES flow_versions ON DELETE CASCADE);
CREATE TABLE settings_panels (organization_id uuid NOT NULL, guild_id text NOT NULL, channel_id text NOT NULL, message_id text NOT NULL,
 PRIMARY KEY(organization_id,guild_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE component_tokens (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, actor_hash text,
 intent jsonb NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(organization_id,guild_id,id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE interaction_jobs (organization_id uuid NOT NULL, guild_id text NOT NULL, id text NOT NULL, encrypted_payload text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE telemetry_health (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, started_at timestamptz NOT NULL,
 ended_at timestamptz, reason text NOT NULL, PRIMARY KEY(organization_id,guild_id,id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE audit_logs (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, actor text NOT NULL, action text NOT NULL,
 source text NOT NULL CHECK(source IN ('DISCORD_PANEL','WEB_DASHBOARD','SYSTEM')), before_value jsonb, after_value jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now(), request_id text NOT NULL, PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE deletion_requests (organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, identity_id uuid,
 requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE daily_guild_metrics (organization_id uuid NOT NULL, guild_id text NOT NULL, day date NOT NULL, metrics jsonb NOT NULL,
 PRIMARY KEY(organization_id,guild_id,day), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
