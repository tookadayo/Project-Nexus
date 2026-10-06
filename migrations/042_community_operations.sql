-- Additive operations domains; versioned configurations are immutable.
ALTER TABLE attention_items DROP CONSTRAINT attention_items_status_check;
ALTER TABLE attention_items ADD CHECK(status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED'));
ALTER TABLE attention_items ADD COLUMN assigned_team_id uuid;
ALTER TABLE attention_items ADD COLUMN last_actor_hash text;
CREATE TABLE attention_events (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),attention_key text NOT NULL,
 version integer NOT NULL,state text NOT NULL,actor_hash text,occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,attention_key,version),
 FOREIGN KEY(organization_id,guild_id,attention_key) REFERENCES attention_items ON DELETE CASCADE
);
CREATE TABLE operations_audit_events (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),actor_hash text NOT NULL,action text NOT NULL,
 target text NOT NULL,revision integer,result text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE operations_domain_events (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),event_type text NOT NULL CHECK(event_type IN ('attention.created','attention.resolved','playbook.executed','intervention.review_ready','coverage.changed','aggregate.export')),
 dedupe_key text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expanded_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,dedupe_key),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX operations_domain_pending ON operations_domain_events(organization_id,guild_id,created_at) WHERE expanded_at IS NULL;
CREATE FUNCTION nexus_attention_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text;
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO attention_events(organization_id,guild_id,attention_key,version,state,actor_hash) VALUES(NEW.organization_id,NEW.guild_id,NEW.message_id,NEW.version,NEW.status,NEW.last_actor_hash) ON CONFLICT DO NOTHING;
  event_name=CASE WHEN TG_OP='INSERT' THEN 'attention.created' WHEN NEW.status='RESOLVED' THEN 'attention.resolved' ELSE NULL END;
  IF event_name IS NOT NULL THEN INSERT INTO operations_domain_events(organization_id,guild_id,event_type,dedupe_key,data) VALUES(NEW.organization_id,NEW.guild_id,event_name,'attention:'||NEW.message_id||':'||NEW.version,jsonb_build_object('attentionKey',NEW.message_id,'type',NEW.item_type,'state',NEW.status,'version',NEW.version,'evidence',NEW.evidence)) ON CONFLICT DO NOTHING; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.evidence IS NOT NULL AND NEW.evidence IS DISTINCT FROM OLD.evidence THEN
  UPDATE operations_domain_events SET data=jsonb_set(data,'{evidence}',NEW.evidence) WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND data->>'attentionKey'=NEW.message_id AND expanded_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attention_domain_event AFTER INSERT OR UPDATE ON attention_items FOR EACH ROW EXECUTE FUNCTION nexus_attention_event();
CREATE TABLE integration_destinations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 kind text NOT NULL CHECK(kind IN ('DISCORD','WEBHOOK','TEAM')),channel_id text,role_id text,endpoint_id uuid,team_id uuid,
 state text NOT NULL DEFAULT 'ENABLED' CHECK(state IN ('ENABLED','DISABLED','PAUSED_PLAN_LIMIT')),revision integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK((kind='DISCORD' AND channel_id IS NOT NULL AND endpoint_id IS NULL AND team_id IS NULL) OR (kind='WEBHOOK' AND endpoint_id IS NOT NULL AND channel_id IS NULL AND role_id IS NULL AND team_id IS NULL) OR (kind='TEAM' AND team_id IS NOT NULL AND channel_id IS NULL AND endpoint_id IS NULL AND role_id IS NULL))
);
CREATE TABLE api_credentials (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),prefix text NOT NULL UNIQUE,token_hash text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),scopes text[] NOT NULL,kind text NOT NULL CHECK(kind IN ('PERSONAL','SERVICE_ACCOUNT')),
 state text NOT NULL DEFAULT 'ENABLED' CHECK(state IN ('ENABLED','REVOKED','PAUSED_PLAN_LIMIT')),actor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz,revoked_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE api_usage_windows (
 organization_id uuid NOT NULL,guild_id text NOT NULL,credential_id uuid NOT NULL,window_kind text NOT NULL CHECK(window_kind IN ('MINUTE','MONTH')),window_start timestamptz NOT NULL,requests integer NOT NULL CHECK(requests>0),
 PRIMARY KEY(organization_id,guild_id,credential_id,window_kind,window_start),FOREIGN KEY(organization_id,guild_id,credential_id) REFERENCES api_credentials ON DELETE CASCADE
);
CREATE TABLE webhook_endpoints (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),name text NOT NULL,url text NOT NULL,event_types text[] NOT NULL,
 state text NOT NULL DEFAULT 'ENABLED' CHECK(state IN ('ENABLED','DISABLED','PAUSED_PLAN_LIMIT')),secret_version integer NOT NULL DEFAULT 1,failures integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),actor_hash text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE api_guild_usage_months (
 organization_id uuid NOT NULL,guild_id text NOT NULL,month_start date NOT NULL,requests integer NOT NULL CHECK(requests>0),
 PRIMARY KEY(organization_id,guild_id,month_start),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE webhook_secrets (
 organization_id uuid NOT NULL,guild_id text NOT NULL,endpoint_id uuid NOT NULL,version integer NOT NULL,secret_ciphertext text NOT NULL,valid_until timestamptz,
 PRIMARY KEY(organization_id,guild_id,endpoint_id,version),FOREIGN KEY(organization_id,guild_id,endpoint_id) REFERENCES webhook_endpoints ON DELETE CASCADE
);
ALTER TABLE integration_destinations ADD FOREIGN KEY(organization_id,guild_id,endpoint_id) REFERENCES webhook_endpoints ON DELETE CASCADE;
CREATE TABLE webhook_deliveries (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),endpoint_id uuid NOT NULL,event_id uuid NOT NULL,secret_version integer NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','PAUSED_PLAN_LIMIT')),attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token uuid,last_status integer,last_error text,completed_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,endpoint_id,event_id),
 FOREIGN KEY(organization_id,guild_id,endpoint_id,secret_version) REFERENCES webhook_secrets ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,event_id) REFERENCES operations_domain_events ON DELETE CASCADE
);
CREATE INDEX webhook_due ON webhook_deliveries(organization_id,guild_id,available_at) WHERE state='PENDING';
CREATE TABLE operations_coverage_heads (
 organization_id uuid NOT NULL,guild_id text NOT NULL,fingerprint text NOT NULL,
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE operations_plan_heads (
 organization_id uuid NOT NULL,guild_id text NOT NULL,fingerprint text NOT NULL,
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE playbooks (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','SUBMITTED','APPROVED','ACTIVE','ARCHIVED','PAUSED_PLAN_LIMIT')),
 head_id uuid,version integer NOT NULL DEFAULT 1,approval_required boolean NOT NULL DEFAULT false,creator_hash text NOT NULL,approved_by text,last_evaluated_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE playbook_revisions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),playbook_id uuid NOT NULL,revision integer NOT NULL,definition jsonb NOT NULL,
 actor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,playbook_id,revision),FOREIGN KEY(organization_id,guild_id,playbook_id) REFERENCES playbooks ON DELETE CASCADE
);
CREATE TRIGGER immutable_playbook_revision BEFORE UPDATE ON playbook_revisions FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
ALTER TABLE playbooks ADD FOREIGN KEY(organization_id,guild_id,head_id) REFERENCES playbook_revisions DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE playbook_executions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),playbook_id uuid NOT NULL,revision_id uuid NOT NULL,dedupe_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('SUPPRESSED','QUEUED','SUCCEEDED','FAILED','UNKNOWN')),evidence jsonb NOT NULL,attention_key text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,revision_id,dedupe_key),
 FOREIGN KEY(organization_id,guild_id,playbook_id) REFERENCES playbooks ON DELETE CASCADE,FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES playbook_revisions ON DELETE CASCADE
);
CREATE TABLE playbook_action_runs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),execution_id uuid NOT NULL,destination_id uuid NOT NULL,step text NOT NULL CHECK(step IN ('ACTION','ESCALATION')),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','QUEUED','SUCCEEDED','SUPPRESSED','FAILED','UNKNOWN','PAUSED_PLAN_LIMIT')),due_at timestamptz NOT NULL,action_id uuid,delivery_id uuid,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,execution_id,destination_id,step),
 FOREIGN KEY(organization_id,guild_id,execution_id) REFERENCES playbook_executions ON DELETE CASCADE,FOREIGN KEY(organization_id,guild_id,destination_id) REFERENCES integration_destinations ON DELETE CASCADE
);
CREATE TABLE operations_interventions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 metric_query jsonb NOT NULL,started_at timestamptz NOT NULL,review_at timestamptz NOT NULL,baseline jsonb NOT NULL,state text NOT NULL DEFAULT 'MEASURING' CHECK(state IN ('MEASURING','REVIEW_READY','ARCHIVED','PAUSED_PLAN_LIMIT')),
 execution_id uuid,assigned_team_id uuid,actor_hash text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,execution_id) REFERENCES playbook_executions ON DELETE SET NULL(execution_id),CHECK(review_at>started_at)
);
CREATE TABLE operations_intervention_reviews (
 organization_id uuid NOT NULL,guild_id text NOT NULL,intervention_id uuid NOT NULL,after_snapshot jsonb NOT NULL,comparison jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,intervention_id),FOREIGN KEY(organization_id,guild_id,intervention_id) REFERENCES operations_interventions ON DELETE CASCADE
);
CREATE UNIQUE INDEX intervention_execution_once ON operations_interventions(organization_id,guild_id,execution_id) WHERE execution_id IS NOT NULL;
CREATE TABLE report_templates (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),footer text NOT NULL DEFAULT '' CHECK(length(footer)<=200),logo_base64 text,
 queries jsonb NOT NULL,include_attention boolean NOT NULL DEFAULT true,include_interventions boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,actor_hash text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE report_template_views (
 organization_id uuid NOT NULL,guild_id text NOT NULL,template_id uuid NOT NULL,view_id uuid NOT NULL,
 PRIMARY KEY(organization_id,guild_id,template_id,view_id),FOREIGN KEY(organization_id,guild_id,template_id) REFERENCES report_templates ON DELETE CASCADE,FOREIGN KEY(organization_id,guild_id,view_id) REFERENCES saved_metric_views ON DELETE CASCADE
);
CREATE TABLE report_schedules (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),template_id uuid NOT NULL,destination_id uuid NOT NULL,
 cadence text NOT NULL CHECK(cadence IN ('WEEKLY','MONTHLY')),timezone text NOT NULL,day integer NOT NULL CHECK(day BETWEEN 0 AND 28),hour integer NOT NULL CHECK(hour BETWEEN 0 AND 23),minute integer NOT NULL DEFAULT 0 CHECK(minute BETWEEN 0 AND 59),
 next_at timestamptz NOT NULL,state text NOT NULL DEFAULT 'ENABLED' CHECK(state IN ('ENABLED','DISABLED','PAUSED_PLAN_LIMIT')),format text NOT NULL DEFAULT 'DISCORD' CHECK(format IN ('DISCORD','CSV','JSON','WEBHOOK')),
 revision integer NOT NULL DEFAULT 1,PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id,template_id) REFERENCES report_templates ON DELETE CASCADE,FOREIGN KEY(organization_id,guild_id,destination_id) REFERENCES integration_destinations ON DELETE CASCADE
);
CREATE TABLE report_runs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),schedule_id uuid NOT NULL,scheduled_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','QUEUED','SUCCEEDED','FAILED','UNKNOWN','PAUSED_PLAN_LIMIT')),lease_until timestamptz,lease_token uuid,schedule_revision integer,template_revision integer,action_id uuid,delivery_id uuid,last_error text,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,schedule_id,scheduled_at),FOREIGN KEY(organization_id,guild_id,schedule_id) REFERENCES report_schedules ON DELETE CASCADE
);
CREATE TABLE operations_intake_panels (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80),category text NOT NULL CHECK(length(category) BETWEEN 1 AND 50),destination_id uuid,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PUBLISHING','PUBLISHED','DISABLED','PAUSED_PLAN_LIMIT')),requires_advanced boolean NOT NULL DEFAULT false,channel_id text,message_id text,version integer NOT NULL DEFAULT 1,actor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,FOREIGN KEY(organization_id,guild_id,destination_id) REFERENCES integration_destinations ON DELETE SET NULL(destination_id)
);
CREATE TABLE operations_intake_fields (
 organization_id uuid NOT NULL,guild_id text NOT NULL,panel_id uuid NOT NULL,field_key text NOT NULL CHECK(field_key ~ '^[a-z][a-z0-9_]{0,29}$'),label text NOT NULL CHECK(length(label) BETWEEN 1 AND 45),required boolean NOT NULL,max_length integer NOT NULL CHECK(max_length BETWEEN 1 AND 1000),position integer NOT NULL CHECK(position BETWEEN 0 AND 4),
 PRIMARY KEY(organization_id,guild_id,panel_id,field_key),UNIQUE(organization_id,guild_id,panel_id,position),FOREIGN KEY(organization_id,guild_id,panel_id) REFERENCES operations_intake_panels ON DELETE CASCADE
);
CREATE TABLE operations_requests (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),panel_id uuid NOT NULL,interaction_digest text NOT NULL,actor_hash text NOT NULL,category text NOT NULL,
 fields_ciphertext text NOT NULL,attention_key text NOT NULL,state text NOT NULL DEFAULT 'OPEN',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,interaction_digest),FOREIGN KEY(organization_id,guild_id,panel_id) REFERENCES operations_intake_panels ON DELETE CASCADE,FOREIGN KEY(organization_id,guild_id,attention_key) REFERENCES attention_items ON DELETE CASCADE
);
CREATE TABLE event_operation_templates (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),timezone text NOT NULL,
 starts_at timestamptz NOT NULL,duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),recurrence text NOT NULL CHECK(recurrence IN ('ONCE','WEEKLY','MONTHLY')),
 location text NOT NULL CHECK(length(location)<=200),calendar_sequence integer NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'ENABLED' CHECK(state IN ('ENABLED','DISABLED','PAUSED_PLAN_LIMIT')),revision integer NOT NULL DEFAULT 1,actor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
