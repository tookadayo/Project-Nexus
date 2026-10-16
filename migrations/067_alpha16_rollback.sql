-- Expand only: no revision is restored or activated by this migration.
-- This is definition behavior, not a permanent copy of restoration audit history.
ALTER TABLE automation_revisions ADD COLUMN restoration_requires_commit boolean NOT NULL DEFAULT false;
CREATE FUNCTION automation_restore_marker_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.restoration_requires_commit IS DISTINCT FROM OLD.restoration_requires_commit THEN RAISE EXCEPTION 'RULE_IMMUTABLE_PAYLOAD'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_restore_marker_immutable BEFORE UPDATE ON automation_revisions FOR EACH ROW EXECUTE FUNCTION automation_restore_marker_immutable();
CREATE TABLE automation_rollbacks (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,flow_id text NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),prepared_revision integer NOT NULL CHECK(prepared_revision>source_revision),
 base_draft_revision integer NOT NULL CHECK(base_draft_revision>0),base_active_revision integer,base_generation integer NOT NULL CHECK(base_generation>=0),
 state text NOT NULL CHECK(state IN ('PREPARED','APPLIED')),created_at timestamptz NOT NULL,applied_at timestamptz,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,flow_id,prepared_revision),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '14 days'),
 CHECK((state='APPLIED')=(applied_at IS NOT NULL))
);
-- No FK to Run/request/evidence: this is independent minimal operation metadata,
-- and must not prevent their shorter retention/purge.
CREATE INDEX automation_rollback_history ON automation_rollbacks(organization_id,guild_id,flow_id,created_at DESC);
CREATE TRIGGER automation_rollback_immutable BEFORE UPDATE ON automation_rollbacks FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload('state','applied_at');
