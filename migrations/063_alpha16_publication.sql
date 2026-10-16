-- Expand only. No publisher is enabled and no existing publication is migrated
-- into an ACTIVE static generation by this schema change.
CREATE TABLE official_static_publication_heads (
 publication_id uuid PRIMARY KEY REFERENCES official_publications(id),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 active_generation bigint,
 pending_generation bigint,
 withdrawn_generation bigint NOT NULL DEFAULT 0 CHECK(withdrawn_generation>=0),
 withdrawn_source_version integer NOT NULL DEFAULT 0 CHECK(withdrawn_source_version>=0),
 sync_state text NOT NULL DEFAULT 'IDLE' CHECK(sync_state IN ('IDLE','PREPARED','ADMITTED','CONFIRMED','NOT_STARTED','UNKNOWN')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 CHECK(active_generation IS NULL OR active_generation<=generation),
 CHECK(pending_generation IS NULL OR pending_generation>generation)
);
CREATE TABLE official_static_publication_manifests (
 publication_id uuid NOT NULL REFERENCES official_publications(id),
 generation bigint NOT NULL CHECK(generation>0),
 source_version integer NOT NULL CHECK(source_version>0),
 source_row_revision integer NOT NULL CHECK(source_row_revision>=0),
 previous_generation bigint NOT NULL CHECK(previous_generation>=0),
 operation text NOT NULL CHECK(operation IN ('PUBLISH','WITHDRAW')),
 schema_version integer NOT NULL CHECK(schema_version=1),
 artifact_hash text NOT NULL CHECK(artifact_hash~'^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('STAGED','ACTIVE','RETIRED','RETRACTED')),
 effect_state text NOT NULL CHECK(effect_state IN ('PREPARED','ADMITTED','CONFIRMED','NOT_STARTED','UNKNOWN')),
 created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(publication_id,generation),
 FOREIGN KEY(publication_id,source_version) REFERENCES official_publication_revisions(publication_id,revision),
 CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX official_static_one_active ON official_static_publication_manifests(publication_id) WHERE state='ACTIVE';
CREATE INDEX official_static_manifest_expiry ON official_static_publication_manifests(expires_at);
-- The head's withdrawn generation is safety state. Expiry is fail-closed;
-- deleting a head must never automatically recreate an OPEN generation zero.
