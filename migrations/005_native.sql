-- Additive rollout: existing questionnaire installations keep fallback behavior.
UPDATE guild_settings SET settings=settings || jsonb_build_object('onboardingMode',
 CASE WHEN settings->>'flowVersionId' IS NOT NULL OR settings->>'onboardingEnabled'='true' THEN 'fallback' ELSE 'auto' END)
 WHERE NOT settings ? 'onboardingMode';

CREATE TABLE guild_capabilities (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, profile jsonb NOT NULL,
 checked_at timestamptz NOT NULL, PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX capabilities_latest ON guild_capabilities(organization_id,guild_id,checked_at DESC);
CREATE TABLE guild_config_revisions (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, domain text NOT NULL,
 version integer NOT NULL, definition jsonb NOT NULL, hash text NOT NULL, author text NOT NULL,
 state text NOT NULL CHECK(state IN ('draft','published')), published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id), UNIQUE(organization_id,guild_id,domain,version),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE FUNCTION immutable_published_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.state='published' THEN RAISE EXCEPTION 'Published revisions are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_config_revision BEFORE UPDATE ON guild_config_revisions FOR EACH ROW EXECUTE FUNCTION immutable_published_revision();
CREATE TABLE guild_config_heads (
 organization_id uuid NOT NULL, guild_id text NOT NULL, domain text NOT NULL, revision_id uuid NOT NULL,
 PRIMARY KEY(organization_id,guild_id,domain),
 FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES guild_config_revisions ON DELETE CASCADE
);
CREATE TABLE native_snapshot_jobs (
 organization_id uuid NOT NULL, guild_id text NOT NULL, episode_id uuid NOT NULL, checkpoint text NOT NULL,
 due_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','succeeded','unavailable')),
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, last_error text,
 PRIMARY KEY(organization_id,guild_id,episode_id,checkpoint),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE INDEX native_jobs_due ON native_snapshot_jobs(state,due_at);
CREATE TABLE native_member_snapshots (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL, episode_id uuid NOT NULL,
 flags bigint NOT NULL, pending boolean, observed_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE TABLE native_lifecycle_state (
 organization_id uuid NOT NULL, guild_id text NOT NULL, episode_id uuid NOT NULL,
 native_onboarding_first_observed_started_at timestamptz,
 native_onboarding_first_observed_completed_at timestamptz,
 home_actions_first_observed_started_at timestamptz,
 home_actions_first_observed_completed_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,episode_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE TABLE data_coverage_snapshots (
 organization_id uuid NOT NULL, guild_id text NOT NULL, signal text NOT NULL, observed_at timestamptz NOT NULL,
 expected integer, observed integer, status text NOT NULL CHECK(status IN ('healthy','degraded','incomplete','unavailable')),
 PRIMARY KEY(organization_id,guild_id,signal,observed_at), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
