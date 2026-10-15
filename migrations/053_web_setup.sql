-- Web-only setup candidates never become the settings source of truth.
CREATE TABLE web_setup_drafts (
  organization_id uuid NOT NULL,
  guild_id text NOT NULL,
  id uuid NOT NULL,
  actor_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  settings_revision integer NOT NULL,
  settings jsonb NOT NULL,
  applied_revision integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
  PRIMARY KEY(organization_id,guild_id,id)
);
CREATE INDEX web_setup_drafts_expiry ON web_setup_drafts(expires_at);
CREATE TABLE web_setup_requests (
  organization_id uuid NOT NULL,
  guild_id text NOT NULL,
  actor_hash text NOT NULL,
  id uuid NOT NULL,
  operation text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
  PRIMARY KEY(organization_id,guild_id,actor_hash,id)
);
CREATE INDEX web_setup_requests_expiry ON web_setup_requests(expires_at);
CREATE TABLE web_setup_install_requests (
  organization_id uuid NOT NULL,
  guild_id text NOT NULL,
  id uuid NOT NULL,
  actor_hash text NOT NULL,
  bot_absent_at timestamptz NOT NULL,
  notice_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
  PRIMARY KEY(organization_id,guild_id,id)
);
CREATE INDEX web_setup_install_requests_expiry ON web_setup_install_requests(expires_at);
