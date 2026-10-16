-- Native Report configuration revisions only. No generation, scheduling,
-- delivery, source confirmation or operational policy is activated here.
CREATE TABLE report_definition_revisions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 template_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>0),draft_id uuid,draft_version integer,
 source_revision_id uuid,definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND pg_column_size(definition)<=262144),
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 reference_hash text NOT NULL CHECK(reference_hash~'^[a-f0-9]{64}$'),
 reference_metadata jsonb NOT NULL CHECK(jsonb_typeof(reference_metadata)='array' AND pg_column_size(reference_metadata)<=8192),
 actor_hash text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,guild_id,id),
 UNIQUE(organization_id,guild_id,template_id,ordinal),
 UNIQUE(organization_id,guild_id,template_id,id),
 UNIQUE(organization_id,guild_id,template_id,draft_id,id),
 FOREIGN KEY(organization_id,guild_id,template_id) REFERENCES report_templates ON DELETE CASCADE,
 CHECK((draft_id IS NULL AND draft_version IS NULL) OR (draft_id IS NOT NULL AND draft_version>0)),
 FOREIGN KEY(organization_id,guild_id,template_id,source_revision_id) REFERENCES report_definition_revisions(organization_id,guild_id,template_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION nexus_immutable_report_definition_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Privacy can erase only author linkage. Definitions, hashes, native binding,
 -- source provenance and all other columns remain immutable; erased authors
 -- cannot be assigned again, including through a later ordinary config edit.
 IF OLD.actor_hash IS NULL OR NEW.actor_hash IS NOT NULL OR (to_jsonb(NEW)-'actor_hash') IS DISTINCT FROM (to_jsonb(OLD)-'actor_hash') THEN
  RAISE EXCEPTION 'Report definition revisions are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_report_definition_revision BEFORE UPDATE ON report_definition_revisions FOR EACH ROW EXECUTE FUNCTION nexus_immutable_report_definition_revision();
CREATE TABLE report_definition_drafts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,template_id uuid NOT NULL,
 head_revision_id uuid NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 base_template_revision integer NOT NULL CHECK(base_template_revision>0),
 base_content_hash text NOT NULL CHECK(base_content_hash~'^[a-f0-9]{64}$'),
 base_reference_hash text NOT NULL CHECK(base_reference_hash~'^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','COMMITTED')),
 committed_template_revision integer,committed_at timestamptz,
 commit_confirmation_hash text CHECK(commit_confirmation_hash~'^[a-f0-9]{64}$'),committed_live_version text,
 actor_hash text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,template_id,id),
 FOREIGN KEY(organization_id,guild_id,template_id) REFERENCES report_templates ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,template_id,id,head_revision_id) REFERENCES report_definition_revisions(organization_id,guild_id,template_id,draft_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='DRAFT' AND committed_template_revision IS NULL AND committed_at IS NULL AND commit_confirmation_hash IS NULL AND committed_live_version IS NULL) OR (state='COMMITTED' AND committed_template_revision>base_template_revision AND committed_at IS NOT NULL AND commit_confirmation_hash IS NOT NULL AND committed_live_version IS NOT NULL))
);
ALTER TABLE report_definition_revisions ADD FOREIGN KEY(organization_id,guild_id,template_id,draft_id) REFERENCES report_definition_drafts(organization_id,guild_id,template_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX report_definition_draft_template ON report_definition_drafts(organization_id,guild_id,template_id,created_at,id);
ALTER TABLE report_templates ADD COLUMN definition_revision_id uuid;
ALTER TABLE report_templates ADD FOREIGN KEY(organization_id,guild_id,id,definition_revision_id) REFERENCES report_definition_revisions(organization_id,guild_id,template_id,id) DEFERRABLE INITIALLY DEFERRED;
-- Native template edit versions differ from unheaded immutable draft ordinals.
-- This is configuration mapping, with no copied Run/actor/result/timestamp.
CREATE TABLE report_template_definition_bindings (
 organization_id uuid NOT NULL,guild_id text NOT NULL,template_id uuid NOT NULL,
 template_revision integer NOT NULL CHECK(template_revision>0),definition_revision_id uuid NOT NULL,
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),reference_hash text NOT NULL CHECK(reference_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,guild_id,template_id,template_revision),
 FOREIGN KEY(organization_id,guild_id,template_id) REFERENCES report_templates ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,template_id,definition_revision_id) REFERENCES report_definition_revisions(organization_id,guild_id,template_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER immutable_report_template_definition_binding BEFORE UPDATE ON report_template_definition_bindings FOR EACH ROW EXECUTE FUNCTION reject_flow_update();

-- Nullable until a successful native generation supplies actual provenance.
-- next_at/due time must never be used as a prior successful generation time.
ALTER TABLE report_runs ADD COLUMN generated_at timestamptz;
ALTER TABLE report_runs ADD COLUMN generated_source_expires_at timestamptz;
ALTER TABLE report_runs ADD COLUMN definition_revision_id uuid;
ALTER TABLE report_runs ADD COLUMN definition_content_hash text CHECK(definition_content_hash~'^[a-f0-9]{64}$');
ALTER TABLE report_runs ADD COLUMN definition_reference_hash text CHECK(definition_reference_hash~'^[a-f0-9]{64}$');
ALTER TABLE report_runs ADD FOREIGN KEY(organization_id,guild_id,definition_revision_id) REFERENCES report_definition_revisions(organization_id,guild_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE report_runs ADD CHECK(num_nonnulls(generated_at,generated_source_expires_at,definition_revision_id,definition_content_hash,definition_reference_hash) IN (0,5));
ALTER TABLE report_runs ADD CHECK((generated_at IS NULL AND generated_source_expires_at IS NULL) OR (generated_at IS NOT NULL AND generated_source_expires_at>generated_at AND generated_source_expires_at<=generated_at+interval '48 hours' AND definition_revision_id IS NOT NULL AND definition_content_hash IS NOT NULL AND definition_reference_hash IS NOT NULL));
