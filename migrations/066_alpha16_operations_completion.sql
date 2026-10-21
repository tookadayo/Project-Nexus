-- Additive Web/domain completion. No report generation, deletion, authorization
-- grant, or external delivery is performed by this schema migration.
ALTER TABLE operations_teams ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE operations_organizations ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE operations_org_guilds ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE operations_interventions ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE report_runs ALTER COLUMN schedule_id DROP NOT NULL;
ALTER TABLE report_runs ADD COLUMN run_kind text NOT NULL DEFAULT 'SCHEDULED' CHECK(run_kind IN ('SCHEDULED','MANUAL'));
ALTER TABLE report_runs ADD COLUMN manual_template_id uuid;
ALTER TABLE report_runs ADD COLUMN requested_by_actor_hash text;
ALTER TABLE report_runs ADD COLUMN requested_by_actor_ciphertext text;
ALTER TABLE report_runs ADD COLUMN request_fingerprint text CHECK(request_fingerprint~'^[a-f0-9]{64}$');
ALTER TABLE report_runs ADD COLUMN manual_input jsonb;
ALTER TABLE report_runs ADD COLUMN result_payload jsonb;
ALTER TABLE report_runs ADD COLUMN result_expires_at timestamptz;
ALTER TABLE report_runs ADD COLUMN completed_at timestamptz;
ALTER TABLE report_runs ADD COLUMN state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0);
ALTER TABLE report_runs ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE report_runs ADD FOREIGN KEY(organization_id,guild_id,manual_template_id) REFERENCES report_templates DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE report_runs ADD CHECK((run_kind='SCHEDULED' AND schedule_id IS NOT NULL AND manual_template_id IS NULL) OR (run_kind='MANUAL' AND schedule_id IS NULL AND manual_template_id IS NOT NULL));
ALTER TABLE report_runs ADD CHECK(run_kind='SCHEDULED' OR (action_id IS NULL AND delivery_id IS NULL));
ALTER TABLE report_runs ADD CHECK(manual_input IS NULL OR pg_column_size(manual_input)<=1048576);
ALTER TABLE report_runs ADD CHECK(result_payload IS NULL OR pg_column_size(result_payload)<=1048576);
CREATE INDEX report_manual_pending ON report_runs(requested_at,id) WHERE run_kind='MANUAL' AND state='PENDING';
-- Referenced team removal must not silently null an approval requirement or
-- cascade-delete a configured destination. Deferral preserves an authorized
-- whole-guild cleanup transaction, which removes its children explicitly.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.contype='f' AND c.confrelid='operations_team_bindings'::regclass LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.relname,item.conname);
 END LOOP;
END $$;
ALTER TABLE attention_items ADD FOREIGN KEY(organization_id,guild_id,assigned_team_id) REFERENCES operations_team_bindings DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE operations_interventions ADD FOREIGN KEY(organization_id,guild_id,assigned_team_id) REFERENCES operations_team_bindings DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE integration_destinations ADD FOREIGN KEY(organization_id,guild_id,team_id) REFERENCES operations_team_bindings DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE playbooks ADD FOREIGN KEY(organization_id,guild_id,review_team_id) REFERENCES operations_team_bindings DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE operations_requests ADD COLUMN erased_at timestamptz;
ALTER TABLE operations_audit_events ADD COLUMN retention_class text;
ALTER TABLE operations_audit_events ADD COLUMN expires_at timestamptz;
ALTER TABLE operations_audit_events ADD CHECK(retention_class IS NULL OR (retention_class='ALPHA16_MINIMAL_OPERATION' AND expires_at IS NOT NULL AND expires_at<=occurred_at+interval '336 hours'));
-- An erased form is not an operational outcome. Suppress the legacy generic
-- transition event before it can enqueue ticketUpdated or wake a Wait.
CREATE OR REPLACE FUNCTION nexus_attention_update_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reason='REQUEST_DELETED' THEN RETURN NEW; END IF;
 IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.version IS DISTINCT FROM OLD.version)
  AND NOT(NEW.status='RESOLVED' AND NEW.status IS DISTINCT FROM OLD.status) THEN
  INSERT INTO operations_domain_events(organization_id,guild_id,event_type,dedupe_key,data)
  VALUES(NEW.organization_id,NEW.guild_id,'attention.updated','attention:'||NEW.message_id||':'||NEW.version,
   jsonb_build_object('attentionKey',NEW.message_id,'state',NEW.status,'version',NEW.version)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
