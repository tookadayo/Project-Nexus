CREATE TABLE server_verification_challenges (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL,
 code_digest text NOT NULL UNIQUE, issuer_hash text NOT NULL, issuer_rate_key text NOT NULL,
 issuer_identity_ciphertext text NOT NULL, created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0), last_attempt_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds(organization_id,guild_id) ON DELETE CASCADE,
 CHECK(expires_at>created_at)
);
CREATE INDEX verification_issuer_window ON server_verification_challenges(issuer_rate_key,created_at);
CREATE INDEX verification_guild_window ON server_verification_challenges(organization_id,guild_id,created_at);
CREATE TABLE server_web_links (
 organization_id uuid NOT NULL, guild_id text NOT NULL,
 verified_at timestamptz NOT NULL, verified_by_hash text, verified_by_identity_ciphertext text,
 revoked_at timestamptz, updated_at timestamptz NOT NULL, revision uuid NOT NULL,
 PRIMARY KEY(organization_id,guild_id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds(organization_id,guild_id) ON DELETE CASCADE
);
CREATE TABLE server_verification_limits (
 key_digest text PRIMARY KEY, window_started_at timestamptz NOT NULL,
 attempt_count integer NOT NULL CHECK(attempt_count>=0), updated_at timestamptz NOT NULL
);
