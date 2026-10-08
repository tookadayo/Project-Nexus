-- PostgreSQL owns execution, usage and recovery. Redis carries only a run UUID.
CREATE TABLE analysis_input_revisions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
-- One revision bump per changed tenant per statement. Row triggers would
-- repeatedly update one MVCC row during bulk rebuilds and become quadratic.
CREATE FUNCTION nexus_analysis_input_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO analysis_input_revisions(organization_id,guild_id,revision)
  SELECT DISTINCT n.organization_id,n.guild_id,1 FROM analysis_new_rows n JOIN guilds g USING(organization_id,guild_id)
  ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=analysis_input_revisions.revision+1;
 ELSIF TG_OP='DELETE' THEN
  INSERT INTO analysis_input_revisions(organization_id,guild_id,revision)
  SELECT DISTINCT n.organization_id,n.guild_id,1 FROM analysis_old_rows n JOIN guilds g USING(organization_id,guild_id)
  ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=analysis_input_revisions.revision+1;
 ELSE
  INSERT INTO analysis_input_revisions(organization_id,guild_id,revision)
  SELECT DISTINCT n.organization_id,n.guild_id,1 FROM (SELECT organization_id,guild_id FROM analysis_new_rows UNION SELECT organization_id,guild_id FROM analysis_old_rows) n JOIN guilds g USING(organization_id,guild_id)
  ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=analysis_input_revisions.revision+1;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER analysis_rollup_revision_insert AFTER INSERT ON lifecycle_daily_rollups REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_rollup_revision_update AFTER UPDATE ON lifecycle_daily_rollups REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_rollup_revision_delete AFTER DELETE ON lifecycle_daily_rollups REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_message_revision_insert AFTER INSERT ON message_observations REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_message_revision_update AFTER UPDATE ON message_observations REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_message_revision_delete AFTER DELETE ON message_observations REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_member_revision_insert AFTER INSERT ON membership_episodes REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_member_revision_update AFTER UPDATE ON membership_episodes REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_member_revision_delete AFTER DELETE ON membership_episodes REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_epoch_revision_insert AFTER INSERT ON collection_epochs REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_epoch_revision_update AFTER UPDATE ON collection_epochs REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_epoch_revision_delete AFTER DELETE ON collection_epochs REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_gap_revision_insert AFTER INSERT ON telemetry_health REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_gap_revision_update AFTER UPDATE ON telemetry_health REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_gap_revision_delete AFTER DELETE ON telemetry_health REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_capability_revision_insert AFTER INSERT ON guild_capability_snapshots REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_capability_revision_update AFTER UPDATE ON guild_capability_snapshots REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_capability_revision_delete AFTER DELETE ON guild_capability_snapshots REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_roles_revision_insert AFTER INSERT ON member_observable_state REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_roles_revision_update AFTER UPDATE ON member_observable_state REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_roles_revision_delete AFTER DELETE ON member_observable_state REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_surface_revision_insert AFTER INSERT ON discord_surface_state REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_surface_revision_update AFTER UPDATE ON discord_surface_state REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_surface_revision_delete AFTER DELETE ON discord_surface_state REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_safety_revision_insert AFTER INSERT ON adaptive_facts REFERENCING NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_safety_revision_update AFTER UPDATE ON adaptive_facts REFERENCING OLD TABLE AS analysis_old_rows NEW TABLE AS analysis_new_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TRIGGER analysis_safety_revision_delete AFTER DELETE ON adaptive_facts REFERENCING OLD TABLE AS analysis_old_rows FOR EACH STATEMENT EXECUTE FUNCTION nexus_analysis_input_changed();
CREATE TABLE analysis_grants (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,
 source text NOT NULL CHECK(source IN ('PLAN_INCLUDED','PACK_PURCHASE','MANUAL')),
 source_identity text NOT NULL CHECK(length(source_identity) BETWEEN 1 AND 180),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),consumed integer NOT NULL DEFAULT 0 CHECK(consumed>=0),
 expires_at timestamptz,created_by_actor_hash text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,source,source_identity),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(reserved+consumed<=quantity),CHECK(expires_at IS NULL OR expires_at>created_at)
);
CREATE UNIQUE INDEX analysis_pack_purchase_identity ON analysis_grants(source_identity) WHERE source='PACK_PURCHASE';
CREATE INDEX analysis_grant_available ON analysis_grants(organization_id,guild_id,expires_at) WHERE quantity>reserved+consumed;
CREATE FUNCTION nexus_analysis_grant_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.organization_id,NEW.guild_id,NEW.source,NEW.source_identity,NEW.expires_at) IS DISTINCT FROM (OLD.organization_id,OLD.guild_id,OLD.source,OLD.source_identity,OLD.expires_at) OR (NEW.quantity<>OLD.quantity AND (OLD.source<>'PLAN_INCLUDED' OR NEW.quantity<OLD.quantity)) THEN RAISE EXCEPTION 'ANALYSIS_GRANT_IMMUTABLE';END IF;
 NEW.updated_at=now();RETURN NEW;
END $$;
CREATE TRIGGER analysis_grant_immutable BEFORE UPDATE ON analysis_grants FOR EACH ROW EXECUTE FUNCTION nexus_analysis_grant_identity();
CREATE TABLE analysis_runs (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,scheduler_organization_id uuid NOT NULL REFERENCES organizations,
 analysis_type text NOT NULL CHECK(analysis_type IN ('OVERALL','NEW_MEMBERS','SUPPORT','EVENTS','VOICE')),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PREPARING','RUNNING','FINALIZING','COMPLETED','FAILED','CANCELED')),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),requested_by_actor_hash text,requested_by_user_ciphertext text,
 requested_at timestamptz NOT NULL DEFAULT now(),period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 period_days integer NOT NULL CHECK(period_days IN (7,30,90)),recipe_version text NOT NULL,scope_identity text NOT NULL,
 config_revision integer NOT NULL CHECK(config_revision>=0),data_revision bigint NOT NULL CHECK(data_revision>=0),input_fingerprint text NOT NULL CHECK(input_fingerprint~'^[a-f0-9]{64}$'),
 plan_at_request text NOT NULL REFERENCES plans(key),priority_class text NOT NULL CHECK(priority_class IN ('FREE','STARTER','GROWTH','SCALE','ENTERPRISE','PACK_ONLY')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_token uuid,lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),enqueued_at timestamptz,started_at timestamptz,completed_at timestamptz,failed_at timestamptz,
 failure_class text CHECK(failure_class IN ('USER_CONFIGURATION','INSUFFICIENT_DATA','AUTHORIZATION','TRANSIENT_INFRASTRUCTURE','PERMANENT_INTERNAL','CANCELED','UNKNOWN')),
 failure_detail_safe text CHECK(length(failure_detail_safe)<=180),retention_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,request_key),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(period_end>period_start AND period_end=period_start+period_days*interval '1 day'),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),CHECK(status NOT IN ('PREPARING','RUNNING','FINALIZING') OR lease_token IS NOT NULL)
);
CREATE INDEX analysis_history ON analysis_runs(organization_id,guild_id,requested_at DESC,id);
CREATE INDEX analysis_recovery ON analysis_runs(available_at,requested_at) WHERE status='QUEUED';
CREATE INDEX analysis_expired_claim ON analysis_runs(lease_until) WHERE status IN ('PREPARING','RUNNING','FINALIZING');
CREATE INDEX analysis_fingerprint ON analysis_runs(organization_id,guild_id,input_fingerprint,status);
CREATE INDEX analysis_org_active ON analysis_runs(scheduler_organization_id,lease_until) WHERE status IN ('PREPARING','RUNNING','FINALIZING');
CREATE TABLE analysis_reservations (
 run_id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,grant_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('RESERVED','CONSUMED','RELEASED')),
 reserved_at timestamptz NOT NULL DEFAULT now(),finalized_at timestamptz,
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES analysis_runs(organization_id,guild_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,grant_id) REFERENCES analysis_grants(organization_id,guild_id,id),
 CHECK((state='RESERVED')=(finalized_at IS NULL))
);
CREATE INDEX analysis_reservation_recovery ON analysis_reservations(organization_id,guild_id,reserved_at) WHERE state='RESERVED';
CREATE TABLE analysis_results (
 run_id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES analysis_runs(organization_id,guild_id,id) ON DELETE CASCADE
);
CREATE TRIGGER analysis_result_immutable BEFORE UPDATE ON analysis_results FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
CREATE TABLE analysis_usage_ledger (
 run_id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,grant_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('CONSUMED','RELEASED')),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES analysis_runs(organization_id,guild_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,grant_id) REFERENCES analysis_grants(organization_id,guild_id,id)
);
CREATE TRIGGER analysis_ledger_immutable BEFORE UPDATE ON analysis_usage_ledger FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
-- Fail-closed one-time product identity in the existing trusted Offering catalog.
ALTER TABLE billing_offerings ADD COLUMN product_kind text NOT NULL DEFAULT 'SUBSCRIPTION' CHECK(product_kind IN ('SUBSCRIPTION','ANALYSIS_PACK'));
ALTER TABLE billing_offerings ADD COLUMN analysis_quantity integer CHECK(analysis_quantity IN (1,3,5));
ALTER TABLE billing_offerings ALTER COLUMN plan_key DROP NOT NULL;
ALTER TABLE billing_offerings ALTER COLUMN plan_revision DROP NOT NULL;
ALTER TABLE billing_offerings ADD CONSTRAINT offering_product_identity CHECK((product_kind='SUBSCRIPTION' AND plan_key IS NOT NULL AND plan_revision IS NOT NULL AND analysis_quantity IS NULL) OR (product_kind='ANALYSIS_PACK' AND plan_key IS NULL AND plan_revision IS NULL AND analysis_quantity IS NOT NULL AND enabled=false));
CREATE TABLE setup_drafts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,guild_id text NOT NULL,actor_hash text NOT NULL,settings_revision integer NOT NULL,
 version integer NOT NULL DEFAULT 0,step integer NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 4),draft jsonb NOT NULL CHECK(octet_length(draft::text)<=16384),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',applied_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX setup_draft_expiry ON setup_drafts(expires_at);

-- Add capability revision 4; historical commercial revisions stay immutable.
INSERT INTO billing_plan_versions(plan_key,revision,features,limits)
SELECT plan_key,4,features,limits||jsonb_build_object('analysisRunsMonthly',CASE plan_key WHEN 'FREE' THEN 1 WHEN 'STARTER' THEN 3 WHEN 'GROWTH' THEN 5 WHEN 'SCALE' THEN 10 ELSE NULL END,'analysisConcurrency',CASE plan_key WHEN 'FREE' THEN 1 WHEN 'STARTER' THEN 1 WHEN 'GROWTH' THEN 2 ELSE 4 END)
FROM billing_plan_versions WHERE revision=3;
