-- ADD03/04: purpose-specific policy must be provided before any writer runs.
-- No retention default is inferred from Fact, Suggestion, Run or audit classes.
CREATE TABLE automation_template_definitions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),name text,
 state text NOT NULL CHECK(state IN ('ACTIVE','DELETED')),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK(expires_at>created_at),CHECK(name IS NULL OR char_length(name) BETWEEN 1 AND 80),
 CHECK((state='ACTIVE' AND name IS NOT NULL) OR (state='DELETED' AND name IS NULL))
);
CREATE TABLE automation_template_revisions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,template_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),definition jsonb NOT NULL,definition_hash text NOT NULL,
 source_flow_id text,source_revision integer,
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,template_id,version),
 FOREIGN KEY(organization_id,guild_id,template_id) REFERENCES automation_template_definitions ON DELETE CASCADE,
 CHECK(jsonb_typeof(definition)='object'),CHECK(pg_column_size(definition)<=262144),
 CHECK(definition_hash ~ '^[0-9a-f]{64}$'),CHECK(expires_at>created_at),
 CHECK((source_flow_id IS NULL)=(source_revision IS NULL))
);
CREATE TABLE personal_preferences (
 organization_id uuid NOT NULL,guild_id text NOT NULL,actor_hash text NOT NULL,
 version integer NOT NULL CHECK(version>0),settings jsonb,
 state text NOT NULL CHECK(state IN ('ACTIVE','RESET')),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,actor_hash),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK(char_length(actor_hash) BETWEEN 1 AND 180),CHECK(expires_at>created_at),
 CHECK((state='RESET' AND settings IS NULL) OR (state='ACTIVE' AND jsonb_typeof(settings)='object' AND pg_column_size(settings)<=1024))
);
-- Prepared request IDs are minted by the server. Missing/expired rows fail
-- closed, so a deleted request ID cannot become a new operation.
CREATE TABLE personalization_requests (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,actor_hash text NOT NULL,
 operation text NOT NULL,fingerprint text NOT NULL,resource_id uuid,
 state text NOT NULL DEFAULT 'PREPARED' CHECK(state IN ('PREPARED','COMPLETED')),
 result jsonb,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK(operation IN ('TEMPLATE_CREATE','TEMPLATE_UPDATE','TEMPLATE_COPY','TEMPLATE_DELETE','TEMPLATE_DRAFT','PREFERENCE_SAVE','PREFERENCE_RESET')),
 CHECK(fingerprint ~ '^[0-9a-f]{64}$'),CHECK(char_length(actor_hash) BETWEEN 1 AND 180),
 CHECK(expires_at>created_at),CHECK(result IS NULL OR pg_column_size(result)<=2048)
);
CREATE INDEX automation_template_expiry ON automation_template_definitions(expires_at);
CREATE INDEX personal_preference_expiry ON personal_preferences(expires_at);
CREATE INDEX personalization_request_expiry ON personalization_requests(expires_at);
