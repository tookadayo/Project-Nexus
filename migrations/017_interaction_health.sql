CREATE TABLE interaction_diagnostics (
 organization_id uuid NOT NULL,
 guild_id text NOT NULL,
 interaction_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('command','component','modal')),
 action text NOT NULL,
 received_at timestamptz NOT NULL,
 acknowledged_at timestamptz,
 completed_at timestamptz,
 result text NOT NULL CHECK(result IN ('received','acknowledged','queued','completed','failed','unknown')),
 error_code text,
 PRIMARY KEY(organization_id,guild_id,interaction_hash),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX interaction_diagnostics_recent ON interaction_diagnostics(organization_id,guild_id,received_at DESC);
