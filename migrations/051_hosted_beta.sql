-- Additive alpha12 foundation. Public OAuth and operator sessions have no
-- shared session IDs, credential material, authentication key or table.
CREATE TABLE public_oauth_sessions (
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'),
 user_digest text NOT NULL CHECK(user_digest~'^[a-f0-9]{64}$'),
 user_ciphertext text NOT NULL,
 token_ciphertext text,
 access_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
 refresh_owner uuid, refresh_until timestamptz,
 CHECK((refresh_owner IS NULL)=(refresh_until IS NULL))
);
CREATE INDEX oauth_user_sessions ON public_oauth_sessions(user_digest) WHERE revoked_at IS NULL;
CREATE TABLE operator_sessions (
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'),
 credential_epoch uuid NOT NULL,
 csrf_digest text NOT NULL CHECK(csrf_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,revoked_at timestamptz
);
CREATE TABLE operator_login_budget (
 account text PRIMARY KEY CHECK(account='operator'),
 window_start timestamptz NOT NULL,failures integer NOT NULL CHECK(failures>=0)
);
CREATE TABLE operator_audit (
 id uuid PRIMARY KEY,request_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action)<=80),guild_id text,
 result text NOT NULL CHECK(result IN ('SUCCEEDED','DENIED','FAILED')),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=400),
 before_state jsonb,after_state jsonb,occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_audit_recent ON operator_audit(occurred_at DESC);
CREATE TABLE beta_guild_invitations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,
 status text NOT NULL DEFAULT 'REGISTERED' CHECK(status IN ('REGISTERED','ACTIVE','PAUSED','REVOKED','DELETING','DELETED')),
 generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
 guild_name text NOT NULL CHECK(length(guild_name)<=100),
 bot_present boolean NOT NULL,bot_checked_at timestamptz NOT NULL,
 activated_at timestamptz,expires_at timestamptz,
 grant_id uuid REFERENCES entitlement_grants ON DELETE SET NULL,
 limits jsonb NOT NULL DEFAULT '{"monthly":20,"daily":3,"guildPending":2,"globalPending":10}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK(status<>'ACTIVE' OR (activated_at IS NOT NULL AND expires_at IS NOT NULL AND grant_id IS NOT NULL)),
 CHECK(jsonb_typeof(limits)='object' AND limits ?& ARRAY['monthly','daily','guildPending','globalPending']),
 CHECK((limits->>'monthly')::integer BETWEEN 1 AND 20 AND (limits->>'daily')::integer BETWEEN 1 AND 3 AND (limits->>'guildPending')::integer BETWEEN 1 AND 2 AND (limits->>'globalPending')::integer BETWEEN 1 AND 10)
);
CREATE TABLE operator_requests (
 id uuid PRIMARY KEY,fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 guild_id text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
-- Minimal durable deletion intent/tombstone survives erasure of domain data.
CREATE TABLE beta_deletion_jobs (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ERASED','DONE')),
 reason text NOT NULL CHECK(reason IN ('UNLINK','BOT_REMOVED','REVOKED','RETENTION_EXPIRED','DELETE_REQUEST')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 requested_at timestamptz NOT NULL DEFAULT now(),available_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,last_error text CHECK(last_error IS NULL OR last_error='DELETE_RETRY_REQUIRED'),
 UNIQUE(organization_id,guild_id)
);
ALTER TABLE analysis_runs ADD COLUMN beta_generation integer CHECK(beta_generation>=0);
