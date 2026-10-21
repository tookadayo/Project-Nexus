-- Configuration CAS is distinct from secret versions and dispatch fence epochs.
ALTER TABLE api_credentials ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE webhook_endpoints ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN delivery_gate text NOT NULL DEFAULT 'UNVERIFIED' CHECK(delivery_gate IN ('UNVERIFIED','OPEN','UNKNOWN_BLOCKED')),
  ADD COLUMN safety_epoch bigint NOT NULL DEFAULT 1 CHECK(safety_epoch>0),
  ADD COLUMN safety_expires_at timestamptz,
  ADD COLUMN safety_policy_revision text,
  ADD CONSTRAINT webhook_open_requires_adopted_safety CHECK(delivery_gate<>'OPEN' OR (safety_expires_at IS NOT NULL AND safety_policy_revision IS NOT NULL AND length(safety_policy_revision)>0));
ALTER TABLE webhook_deliveries ADD COLUMN endpoint_revision integer,
  ADD COLUMN endpoint_safety_epoch bigint,
  ADD COLUMN send_admitted_at timestamptz,
  ADD COLUMN request_deadline_at timestamptz,
  ADD CONSTRAINT webhook_admission_deadline CHECK((send_admitted_at IS NULL AND request_deadline_at IS NULL) OR
    (send_admitted_at IS NOT NULL AND request_deadline_at IS NOT NULL AND request_deadline_at>send_admitted_at));
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_state_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_state_check
  CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN','PAUSED_PLAN_LIMIT'));

-- Legacy plan/membership writers also invalidate stale maintenance revisions.
-- Usage counters and safety fencing do not constitute configuration changes.
CREATE FUNCTION nexus_integration_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='api_credentials' THEN
    IF ROW(NEW.name,NEW.scopes,NEW.kind,NEW.state,NEW.token_hash,NEW.prefix)
      IS DISTINCT FROM ROW(OLD.name,OLD.scopes,OLD.kind,OLD.state,OLD.token_hash,OLD.prefix) THEN
      NEW.revision:=GREATEST(NEW.revision,OLD.revision+1); NEW.updated_at:=clock_timestamp();
    END IF;
  ELSE
    IF ROW(NEW.name,NEW.url,NEW.event_types,NEW.state,NEW.secret_version)
      IS DISTINCT FROM ROW(OLD.name,OLD.url,OLD.event_types,OLD.state,OLD.secret_version) THEN
      NEW.revision:=GREATEST(NEW.revision,OLD.revision+1); NEW.updated_at:=clock_timestamp();
    END IF;
    -- Editing, enabling and secret rotation never resolve uncertain delivery.
    IF OLD.delivery_gate='UNKNOWN_BLOCKED' AND NEW.delivery_gate<>OLD.delivery_gate THEN
      RAISE EXCEPTION 'WEBHOOK_RESULT_UNKNOWN';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER api_credential_revision BEFORE UPDATE ON api_credentials FOR EACH ROW EXECUTE FUNCTION nexus_integration_revision();
CREATE TRIGGER webhook_endpoint_revision BEFORE UPDATE ON webhook_endpoints FOR EACH ROW EXECUTE FUNCTION nexus_integration_revision();

-- A legacy reset cannot turn an admitted request back into a POST candidate.
CREATE FUNCTION nexus_webhook_admission_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.endpoint_id,NEW.event_id,NEW.secret_version,NEW.endpoint_revision,NEW.endpoint_safety_epoch)
    IS DISTINCT FROM ROW(OLD.endpoint_id,OLD.event_id,OLD.secret_version,OLD.endpoint_revision,OLD.endpoint_safety_epoch) THEN
    RAISE EXCEPTION 'WEBHOOK_DELIVERY_IMMUTABLE';
  END IF;
  IF OLD.send_admitted_at IS NOT NULL THEN
    NEW.send_admitted_at:=OLD.send_admitted_at;
    NEW.request_deadline_at:=OLD.request_deadline_at;
    IF OLD.state='UNKNOWN' AND NEW.state<>'UNKNOWN' THEN RAISE EXCEPTION 'WEBHOOK_RESULT_UNKNOWN'; END IF;
    IF NEW.state IN ('PENDING','PAUSED_PLAN_LIMIT') THEN RAISE EXCEPTION 'WEBHOOK_ADMITTED_RESET_FORBIDDEN'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_admission_monotonic BEFORE UPDATE ON webhook_deliveries FOR EACH ROW EXECUTE FUNCTION nexus_webhook_admission_monotonic();

-- Individual target removal may not cascade away guards or historical effects.
-- Deferred NO ACTION still permits authorized whole-guild erasure in one TX.
DO $$
DECLARE fk record; definition text;
BEGIN
  FOR fk IN SELECT c.conrelid::regclass AS relation,c.conname,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.contype='f' AND (
      (c.confrelid='integration_destinations'::regclass AND c.conrelid IN ('playbook_action_runs'::regclass,'report_schedules'::regclass,'operations_intake_panels'::regclass)) OR
      (c.confrelid='webhook_endpoints'::regclass AND c.conrelid IN ('integration_destinations'::regclass,'webhook_secrets'::regclass)) OR
      (c.confrelid='webhook_secrets'::regclass AND c.conrelid='webhook_deliveries'::regclass) OR
      (c.confrelid='operations_team_bindings'::regclass AND c.conrelid='integration_destinations'::regclass))
  LOOP
    definition:=regexp_replace(fk.definition,' ON DELETE (CASCADE|SET NULL( ?\([^)]*\))?)',' ON DELETE NO ACTION');
    definition:=regexp_replace(definition,' (NOT )?DEFERRABLE( INITIALLY (DEFERRED|IMMEDIATE))?','');
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',fk.relation,fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s DEFERRABLE INITIALLY DEFERRED',fk.relation,fk.conname,definition);
  END LOOP;
END $$;
