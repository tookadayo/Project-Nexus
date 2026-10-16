-- Non-personal, closed-schema source definitions. CONFIG policy remains an
-- explicit service gate. Definitions do not approve an engine or collect data.
CREATE TABLE rule_native_cohort_revisions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,source_id uuid NOT NULL,id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),base_version integer NOT NULL CHECK(base_version>=0 AND version>base_version),
 draft_parent_revision_id uuid,enabled boolean NOT NULL,kind text NOT NULL
 CHECK(kind IN ('ONBOARDING_FIRST_ACTION','HELP_BACKLOG_COHORT','ENGAGEMENT_CONTINUATION_COHORT','CHANNEL_PARTICIPATION_COHORT','EVENT_RSVP_ATTENDANCE_COHORT')),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,source_id,id),
 UNIQUE(organization_id,guild_id,source_id,version),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,source_id,draft_parent_revision_id)
 REFERENCES rule_native_cohort_revisions(organization_id,guild_id,source_id,id) ON DELETE CASCADE,
 CHECK(draft_parent_revision_id IS NULL OR (base_version>0 AND draft_parent_revision_id<>id))
);
CREATE TABLE rule_native_cohort_heads (
 organization_id uuid NOT NULL,guild_id text NOT NULL,source_id uuid NOT NULL,
 revision_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(organization_id,guild_id,source_id),
 FOREIGN KEY(organization_id,guild_id,source_id,revision_id)
 REFERENCES rule_native_cohort_revisions(organization_id,guild_id,source_id,id) ON DELETE CASCADE
);
CREATE FUNCTION nexus_immutable_native_cohort_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Native cohort revisions are immutable';END $$;
CREATE TRIGGER immutable_native_cohort_revision BEFORE UPDATE ON rule_native_cohort_revisions
 FOR EACH ROW EXECUTE FUNCTION nexus_immutable_native_cohort_revision();
CREATE INDEX rule_native_cohort_expiry ON rule_native_cohort_revisions(expires_at);
CREATE INDEX rule_native_cohort_draft_parent ON rule_native_cohort_revisions(organization_id,guild_id,source_id,draft_parent_revision_id) WHERE draft_parent_revision_id IS NOT NULL;
