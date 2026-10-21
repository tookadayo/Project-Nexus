-- Native configuration revisions, not member answers or sessions. Published
-- flow_versions remain immutable and are created only by explicit commit.
CREATE TABLE onboarding_flow_workspaces (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),head_id uuid NOT NULL,
 label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE onboarding_flow_drafts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 workspace_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 slot text NOT NULL CHECK(slot IN ('MAIN','HYBRID')),
 base_flow_id uuid,base_settings_revision integer NOT NULL CHECK(base_settings_revision>=0),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND pg_column_size(definition)<=262144),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,workspace_id,revision),
 FOREIGN KEY(organization_id,guild_id,workspace_id) REFERENCES onboarding_flow_workspaces ON DELETE CASCADE
);
ALTER TABLE onboarding_flow_workspaces ADD CONSTRAINT onboarding_flow_head
 FOREIGN KEY(organization_id,guild_id,head_id) REFERENCES onboarding_flow_drafts(organization_id,guild_id,id)
 DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION reject_onboarding_draft_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Onboarding drafts are immutable revisions'; END $$;
CREATE TRIGGER immutable_onboarding_draft BEFORE UPDATE ON onboarding_flow_drafts FOR EACH ROW EXECUTE FUNCTION reject_onboarding_draft_update();
CREATE TABLE onboarding_flow_publications (
 organization_id uuid NOT NULL,guild_id text NOT NULL,draft_id uuid NOT NULL,
 flow_version_id uuid NOT NULL,settings_revision integer NOT NULL CHECK(settings_revision>0),
 published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,draft_id),
 FOREIGN KEY(organization_id,guild_id,draft_id) REFERENCES onboarding_flow_drafts ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,flow_version_id) REFERENCES flow_versions ON DELETE CASCADE
);
-- Extend the existing minimal authoring-operation identity purpose. No payload
-- or new personal-data class is copied into the native configuration tables.
-- Discover these two single-column checks rather than assuming generated names.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='lifecycle_web_requests'::regclass AND contype='c'
  AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='lifecycle_web_requests'::regclass AND attname='domain')]::smallint[]
 LOOP EXECUTE format('ALTER TABLE lifecycle_web_requests DROP CONSTRAINT %I',c.conname); END LOOP;
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='lifecycle_web_requests'::regclass AND contype='c'
  AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='lifecycle_web_requests'::regclass AND attname='operation')]::smallint[]
 LOOP EXECUTE format('ALTER TABLE lifecycle_web_requests DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE lifecycle_web_requests ADD CONSTRAINT alpha16_authoring_domain_check CHECK(domain IN ('experiment','intervention','onboarding_flow'));
ALTER TABLE lifecycle_web_requests ADD CONSTRAINT alpha16_authoring_operation_check CHECK(operation IN ('DRAFT','PUBLISH','EXPERIMENT_CONTROL','EVALUATE_RESULT','INTERVENTION_APPROVE','INTERVENTION_CANCEL','INTERVENTION_SWITCH','FLOW_DRAFT_SAVE','FLOW_DRAFT_DELETE','FLOW_DRAFT_PUBLISH'));
