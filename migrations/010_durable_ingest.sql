CREATE TABLE gateway_ingest (
 organization_id uuid NOT NULL,guild_id text NOT NULL,dedupe_key text NOT NULL,subject_hash text,payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,projected_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,dedupe_key),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX gateway_ingest_pending ON gateway_ingest(received_at) WHERE projected_at IS NULL;
