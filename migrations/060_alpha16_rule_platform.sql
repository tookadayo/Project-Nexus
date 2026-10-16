-- Expand only. No config/retention approval, historical backfill, activation,
-- queue dispatch or external effect is performed by this migration.
ALTER TABLE public_oauth_sessions ADD COLUMN proof_nonces jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE rule_config_versions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('DRAFT','APPROVED','ACTIVE','RETIRED')),
 engine_version text NOT NULL,definition jsonb NOT NULL,content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,version),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK(expires_at>created_at),CHECK(state NOT IN ('APPROVED','ACTIVE') OR approved_at IS NOT NULL)
);
CREATE UNIQUE INDEX rule_one_active_config ON rule_config_versions(organization_id,guild_id) WHERE state='ACTIVE';
CREATE TABLE rule_source_health (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,revision text NOT NULL,
 source_id text NOT NULL,observed_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 quality text NOT NULL CHECK(quality IN ('SUFFICIENT','PARTIAL','STALE','MISSING','SUPPRESSED','UNKNOWN')),
 health_state text NOT NULL CHECK(health_state IN ('HEALTHY','DEGRADED','FAILED','UNKNOWN')),
 target_type text NOT NULL,target_id text NOT NULL,live_version text NOT NULL,
 source_expires_at timestamptz NOT NULL,
 last_success_at timestamptz,never_succeeded boolean,coverage numeric(38,18) CHECK(coverage BETWEEN 0 AND 1),
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 UNIQUE(organization_id,guild_id,source_id,revision,observed_at),CHECK(expires_at>observed_at),
 CHECK(expires_at<=source_expires_at),CHECK(never_succeeded IS DISTINCT FROM true OR last_success_at IS NULL)
);
CREATE TABLE rule_fact_snapshots (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,registry_version text NOT NULL,
 target_type text NOT NULL,target_id text NOT NULL,live_version text,
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,captured_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('SEALED','INVALIDATED')),content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,invalidated_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 UNIQUE(organization_id,guild_id,content_hash),CHECK(window_start<window_end),CHECK(expires_at>captured_at)
);
-- Each original Fact retains typed metadata; its value is only scalar components below.
CREATE TABLE rule_fact_groups (
 organization_id uuid NOT NULL,guild_id text NOT NULL,snapshot_id uuid NOT NULL,fact_id uuid NOT NULL,
 metric_id text NOT NULL,definition_version text NOT NULL,dimension_key text NOT NULL,dimension jsonb NOT NULL,
 period_role text NOT NULL CHECK(period_role IN ('CURRENT','PREVIOUS','PERIOD_1','PERIOD_2','PERIOD_3')),
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,source_id text NOT NULL,source_revision text NOT NULL,
 observed_at timestamptz NOT NULL,source_expires_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,unit text NOT NULL,
 target_type text NOT NULL,target_id text NOT NULL,live_version text NOT NULL,
 composite_kind text CHECK(composite_kind IN ('count','decimal','boolean','timestamp','enum','ratio','generation','outcomes','anomalies','permissions','issuePeriods')),
 quality text NOT NULL CHECK(quality IN ('SUFFICIENT','PARTIAL','STALE','MISSING','SUPPRESSED','UNKNOWN')),
 coverage numeric(38,18) CHECK(coverage BETWEEN 0 AND 1),sample_size bigint CHECK(sample_size>=0),
 cohort_definition_version text,campaign_class text,maturity_offset text,window_kind text CHECK(window_kind IN ('ELAPSED','CALENDAR')),time_zone text,cohort_id text,
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,guild_id,snapshot_id,fact_id),
 FOREIGN KEY(organization_id,guild_id,snapshot_id) REFERENCES rule_fact_snapshots,
 UNIQUE(organization_id,guild_id,snapshot_id,metric_id,dimension_key,period_role,window_start,window_end),
 CHECK(window_start<window_end),CHECK(expires_at<=source_expires_at),CHECK(jsonb_typeof(dimension)='object'),
 CHECK((quality IN ('SUFFICIENT','PARTIAL') OR composite_kind IS NULL) AND (quality<>'SUFFICIENT' OR composite_kind IS NOT NULL)),
 CHECK(num_nonnulls(cohort_definition_version,campaign_class,maturity_offset,window_kind,time_zone,cohort_id) IN (0,6))
);
CREATE TABLE rule_fact_values (
 organization_id uuid NOT NULL,guild_id text NOT NULL,snapshot_id uuid NOT NULL,fact_id uuid NOT NULL,id uuid NOT NULL,
 component_key text NOT NULL,
 value_kind text NOT NULL CHECK(value_kind IN ('INTEGER','DECIMAL','BOOLEAN','ENUM','TIMESTAMP')),
 integer_value bigint,decimal_value numeric(38,18),boolean_value boolean,enum_value text,timestamp_value timestamptz,
 PRIMARY KEY(organization_id,guild_id,snapshot_id,id),
 FOREIGN KEY(organization_id,guild_id,snapshot_id,fact_id) REFERENCES rule_fact_groups,
 UNIQUE(organization_id,guild_id,snapshot_id,fact_id,component_key),
 CHECK(num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value)<=1 AND
   CASE value_kind WHEN 'INTEGER' THEN integer_value IS NOT NULL WHEN 'DECIMAL' THEN decimal_value IS NOT NULL
   WHEN 'BOOLEAN' THEN boolean_value IS NOT NULL WHEN 'ENUM' THEN enum_value IS NOT NULL ELSE num_nonnulls(integer_value,decimal_value,boolean_value,enum_value)=0 END)
);
CREATE TABLE rule_fact_health_refs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,snapshot_id uuid NOT NULL,fact_id uuid NOT NULL,
 health_id uuid NOT NULL,health_revision text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,snapshot_id,fact_id,health_id),
 FOREIGN KEY(organization_id,guild_id,snapshot_id,fact_id) REFERENCES rule_fact_groups,
 FOREIGN KEY(organization_id,guild_id,health_id) REFERENCES rule_source_health
);
CREATE TABLE rule_evaluation_jobs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,config_version integer NOT NULL,
 evaluation_as_of timestamptz NOT NULL,input_hash text NOT NULL,request_hash text NOT NULL,
 versions jsonb NOT NULL,inputs jsonb NOT NULL,actor_hash text,
 state text NOT NULL CHECK(state IN ('QUEUED','RUNNING','CANCEL_REQUESTED','SUCCEEDED','FAILED','CANCELLED')),
 row_version bigint NOT NULL DEFAULT 1,attempt_count integer NOT NULL DEFAULT 0,
 lease_token uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 failure_code text,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id,config_version) REFERENCES rule_config_versions,
 CHECK(input_hash~'^[a-f0-9]{64}$'),CHECK(request_hash~'^[a-f0-9]{64}$'),CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX rule_evaluation_active_input ON rule_evaluation_jobs(organization_id,guild_id,request_hash) WHERE state IN ('QUEUED','RUNNING','CANCEL_REQUESTED');
CREATE INDEX rule_evaluation_due ON rule_evaluation_jobs(created_at) WHERE state='QUEUED';
CREATE TABLE rule_evaluation_inputs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,job_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('FACT','SOURCE_HEALTH')),ref_id uuid NOT NULL,revision text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,job_id,kind,ref_id),
 FOREIGN KEY(organization_id,guild_id,job_id) REFERENCES rule_evaluation_jobs
);
CREATE TABLE rule_evaluation_results (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,job_id uuid NOT NULL,
 rule_id text NOT NULL,target_type text NOT NULL,target_id text NOT NULL,live_version text,
 result text NOT NULL CHECK(result IN ('FIRE','NO_FIRE','INELIGIBLE','DISABLED')),
 reason_code text NOT NULL,result_hash text NOT NULL,payload jsonb NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id,job_id) REFERENCES rule_evaluation_jobs,
 UNIQUE(organization_id,guild_id,job_id,rule_id,target_type,target_id)
);
-- Target-root safety deliberately has no Run/intent/result/evidence reference.
CREATE TABLE rule_target_safety (
 organization_id uuid NOT NULL,guild_id text NOT NULL,target_type text NOT NULL,target_id text NOT NULL,
 live_version text NOT NULL,safety_epoch bigint NOT NULL CHECK(safety_epoch>0),
 apply_gate text NOT NULL CHECK(apply_gate IN ('OPEN','UNKNOWN_BLOCKED')),
 state_version bigint NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL,policy_revision text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,target_type,target_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds
);
CREATE TABLE rule_suggestions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 target_type text NOT NULL,target_id text NOT NULL,live_version text,
 evaluation_result_id uuid,evaluation_ref_hash text NOT NULL,evaluation_as_of timestamptz NOT NULL,
 rule_id text NOT NULL,versions jsonb NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 issue_code text NOT NULL,dedupe_key text NOT NULL,lineage_key text NOT NULL,
 action_id text NOT NULL,action_mode text NOT NULL CHECK(action_mode IN ('REVIEW_ONLY','CREATE_DRAFT')),
 action_payload jsonb NOT NULL,explanation jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('ACTIVE','REJECTED','EXPIRED','INVALIDATED','CONSUMED')),
 audience text NOT NULL CHECK(audience IN ('GUILD','RESTRICTED')),
 created_at timestamptz NOT NULL DEFAULT now(),last_observed_at timestamptz NOT NULL,
 actionable_until timestamptz NOT NULL,history_expires_at timestamptz NOT NULL,invalidated_reason text,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 FOREIGN KEY(organization_id,guild_id,evaluation_result_id) REFERENCES rule_evaluation_results,
 UNIQUE(organization_id,guild_id,dedupe_key),CHECK(window_start<window_end),CHECK(actionable_until<=history_expires_at)
);
CREATE INDEX rule_suggestion_lineage ON rule_suggestions(organization_id,guild_id,lineage_key,created_at DESC);
CREATE TABLE rule_suggestion_evidence (
 organization_id uuid NOT NULL,guild_id text NOT NULL,suggestion_id uuid NOT NULL,id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('FACT','SOURCE_HEALTH','EVALUATION')),
 snapshot_id uuid,health_id uuid,evaluation_result_id uuid,reference_hash text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,suggestion_id,id),
 FOREIGN KEY(organization_id,guild_id,suggestion_id) REFERENCES rule_suggestions,
 FOREIGN KEY(organization_id,guild_id,snapshot_id) REFERENCES rule_fact_snapshots,
 FOREIGN KEY(organization_id,guild_id,health_id) REFERENCES rule_source_health,
 FOREIGN KEY(organization_id,guild_id,evaluation_result_id) REFERENCES rule_evaluation_results,
 CHECK(num_nonnulls(snapshot_id,health_id,evaluation_result_id)=1)
);
CREATE TABLE rule_suggestion_user_states (
 organization_id uuid NOT NULL,guild_id text NOT NULL,suggestion_id uuid NOT NULL,actor_hash text NOT NULL,
 viewed_at timestamptz,dismissed_at timestamptz,saved_at timestamptz,row_version bigint NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,suggestion_id,actor_hash),
 FOREIGN KEY(organization_id,guild_id,suggestion_id) REFERENCES rule_suggestions
);
CREATE TABLE rule_lineage_suppressions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,lineage_key text NOT NULL,action_class text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('SHARED_REJECT','PER_USER_DISMISS')),actor_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK((kind='SHARED_REJECT' AND actor_hash IS NULL) OR (kind='PER_USER_DISMISS' AND actor_hash IS NOT NULL)),
 CHECK(expires_at>created_at),UNIQUE NULLS NOT DISTINCT(organization_id,guild_id,kind,actor_hash,lineage_key,action_class)
);
CREATE TABLE rule_suggestion_history (
 organization_id uuid NOT NULL,guild_id text NOT NULL,suggestion_id uuid NOT NULL,id uuid NOT NULL,
 event_sequence bigint NOT NULL,event_type text NOT NULL,reference_digest text,
 occurred_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,suggestion_id,id),
 FOREIGN KEY(organization_id,guild_id,suggestion_id) REFERENCES rule_suggestions,
 UNIQUE(organization_id,guild_id,suggestion_id,event_sequence)
);
CREATE TABLE rule_suggestion_draft_links (
 organization_id uuid NOT NULL,guild_id text NOT NULL,suggestion_id uuid NOT NULL,draft_id text NOT NULL,
 immutable_revision_id text NOT NULL,content_hash text NOT NULL,base_live_version text NOT NULL,
 suggestion_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,suggestion_id,immutable_revision_id),
 UNIQUE(organization_id,guild_id,draft_id,immutable_revision_id),
 FOREIGN KEY(organization_id,guild_id,suggestion_id) REFERENCES rule_suggestions
);
CREATE TABLE rule_apply_reservations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,suggestion_id uuid NOT NULL,
 immutable_revision_id text NOT NULL,draft_id text NOT NULL,draft_content_hash text NOT NULL,
 suggestion_version integer NOT NULL,live_version text NOT NULL,safety_epoch bigint NOT NULL,
 target_type text NOT NULL,target_id text NOT NULL,action_class text NOT NULL,approval_hash text NOT NULL,
 operation_id uuid NOT NULL,state text NOT NULL CHECK(state IN ('RESERVED','IN_PROGRESS','SUCCEEDED','UNKNOWN','FAILED_CONFIRMED','RELEASED_PRE_EFFECT')),
 admitted_at timestamptz,finished_at timestamptz,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,operation_id),
 FOREIGN KEY(organization_id,guild_id,suggestion_id,immutable_revision_id) REFERENCES rule_suggestion_draft_links DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX rule_apply_once ON rule_apply_reservations(organization_id,guild_id,suggestion_id,immutable_revision_id) WHERE state<>'RELEASED_PRE_EFFECT';
CREATE UNIQUE INDEX rule_target_guard ON rule_apply_reservations(organization_id,guild_id,target_type,target_id,action_class) WHERE state IN ('RESERVED','IN_PROGRESS','UNKNOWN');
CREATE TABLE rule_request_keys (
 organization_id uuid NOT NULL,guild_id text NOT NULL,actor_hash text NOT NULL,operation_class text NOT NULL,
 key_hash text NOT NULL,fingerprint text NOT NULL,resource_id text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,actor_hash,operation_class,key_hash),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds
);
-- Immutable input/definition payloads may be invalidated or removed, never rewritten.
CREATE FUNCTION rule_immutable_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- PostgreSQL supplies NULL TG_ARGV for a trigger with no arguments. Treat it
 -- as an empty allowlist so NULL subtraction cannot hide a payload change.
 IF (to_jsonb(NEW)-COALESCE(TG_ARGV,ARRAY[]::text[])) IS DISTINCT FROM (to_jsonb(OLD)-COALESCE(TG_ARGV,ARRAY[]::text[])) THEN
   RAISE EXCEPTION 'RULE_IMMUTABLE_PAYLOAD';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rule_config_immutable BEFORE UPDATE ON rule_config_versions FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload('state','approved_at');
CREATE TRIGGER rule_snapshot_immutable BEFORE UPDATE ON rule_fact_snapshots FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload('state','invalidated_at');
CREATE TRIGGER rule_value_immutable BEFORE UPDATE ON rule_fact_values FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_fact_group_immutable BEFORE UPDATE ON rule_fact_groups FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_fact_health_ref_immutable BEFORE UPDATE ON rule_fact_health_refs FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_health_immutable BEFORE UPDATE ON rule_source_health FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_job_immutable BEFORE UPDATE ON rule_evaluation_jobs FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload('state','row_version','attempt_count','lease_token','lease_until','finished_at','failure_code','actor_hash');
CREATE TRIGGER rule_result_immutable BEFORE UPDATE ON rule_evaluation_results FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_suggestion_immutable BEFORE UPDATE ON rule_suggestions FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload('state','version','last_observed_at','evaluation_result_id','invalidated_reason','actionable_until');
CREATE TRIGGER rule_link_immutable BEFORE UPDATE ON rule_suggestion_draft_links FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
-- New snapshot/history policy selected by the user. Existing source aggregates,
-- legal/security audits and active configuration have separate purposes.
ALTER TABLE rule_fact_snapshots ADD CHECK(expires_at<=captured_at+interval '48 hours');
ALTER TABLE rule_source_health ADD CHECK(expires_at<=observed_at+interval '48 hours');
ALTER TABLE rule_evaluation_jobs ADD CHECK(expires_at<=created_at+interval '48 hours');
ALTER TABLE rule_suggestions ADD CHECK(history_expires_at<=created_at+interval '336 hours');
ALTER TABLE rule_lineage_suppressions ADD CHECK(expires_at<=created_at+interval '336 hours');
ALTER TABLE rule_suggestion_history ADD CHECK(expires_at<=occurred_at+interval '336 hours');
