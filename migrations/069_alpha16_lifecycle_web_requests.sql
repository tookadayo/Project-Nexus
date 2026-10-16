-- This ledger has no operational lifetime default. Production writes remain
-- disabled until LIFECYCLE_WEB_REQUEST has an explicit purpose-specific policy.
CREATE TABLE lifecycle_web_requests (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL,
 actor_hash text NOT NULL, domain text NOT NULL CHECK(domain IN ('experiment','intervention')),
 operation text NOT NULL, fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 state text NOT NULL CHECK(state IN ('PREPARED','CLAIMED','COMPLETED')),
 result jsonb, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(expires_at>created_at), CHECK(result IS NULL OR jsonb_typeof(result)='object'),
 CHECK(operation IN ('DRAFT','PUBLISH','EXPERIMENT_CONTROL','EVALUATE_RESULT','INTERVENTION_APPROVE','INTERVENTION_CANCEL','INTERVENTION_SWITCH')),
 CHECK((state='COMPLETED')=(result IS NOT NULL))
);
CREATE INDEX lifecycle_web_requests_expiry ON lifecycle_web_requests(expires_at);
