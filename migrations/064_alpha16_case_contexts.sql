-- Structured CASE inputs are private immutable snapshots. This schema enables no
-- source adapter, retention policy, operational profile, or external effect.
CREATE TABLE rule_case_contexts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 case_id text NOT NULL,revision text NOT NULL,content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 evaluation_as_of timestamptz NOT NULL,target_type text NOT NULL,target_id text NOT NULL,live_version text,
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 context_metadata jsonb NOT NULL,profile_metadata jsonb NOT NULL,registry_metadata jsonb NOT NULL,
 profile_hash text NOT NULL CHECK(profile_hash~'^[a-f0-9]{64}$'),registry_hash text NOT NULL CHECK(registry_hash~'^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 UNIQUE(organization_id,guild_id,id,revision),
 CHECK(window_start<window_end),CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '48 hours'),
 CHECK(jsonb_typeof(context_metadata)='object' AND NOT context_metadata?'fields' AND NOT context_metadata?'sourceHealth'),
 CHECK(jsonb_typeof(profile_metadata)='object' AND NOT profile_metadata?'values'),CHECK(jsonb_typeof(registry_metadata)='object')
);
CREATE TABLE rule_case_observations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,context_id uuid NOT NULL,field_id text NOT NULL,
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND NOT metadata?'value'),
 value_kind text NOT NULL CHECK(value_kind IN ('NULL','INTEGER','DECIMAL','BOOLEAN','ENUM','IDENTIFIER','TIMESTAMP','COHORT')),
 integer_value bigint,decimal_value numeric,boolean_value boolean,enum_value text,timestamp_value timestamptz,
 numerator bigint,denominator bigint,coverage numeric,
 PRIMARY KEY(organization_id,guild_id,context_id,field_id),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_case_contexts,
 CHECK(CASE value_kind
 WHEN 'NULL' THEN num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=0
 WHEN 'INTEGER' THEN integer_value IS NOT NULL AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=1
 WHEN 'DECIMAL' THEN decimal_value IS NOT NULL AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=1
 WHEN 'BOOLEAN' THEN boolean_value IS NOT NULL AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=1
 WHEN 'ENUM' THEN enum_value IS NOT NULL AND length(enum_value)<=128 AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=1
 WHEN 'IDENTIFIER' THEN enum_value IS NOT NULL AND enum_value~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=1
 WHEN 'TIMESTAMP' THEN timestamp_value IS NOT NULL AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=1
 ELSE numerator IS NOT NULL AND denominator IS NOT NULL AND coverage IS NOT NULL AND numerator>=0 AND denominator>=numerator AND coverage BETWEEN 0 AND 1 AND num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage)=3 END)
);
CREATE TABLE rule_case_source_health (
 organization_id uuid NOT NULL,guild_id text NOT NULL,context_id uuid NOT NULL,source_id text NOT NULL,
 observation_id text NOT NULL,revision text NOT NULL,metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 PRIMARY KEY(organization_id,guild_id,context_id,source_id),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_case_contexts
);
CREATE TABLE rule_case_profile_values (
 organization_id uuid NOT NULL,guild_id text NOT NULL,context_id uuid NOT NULL,config_key text NOT NULL,unit text NOT NULL,
 value_kind text NOT NULL CHECK(value_kind IN ('NULL','INTEGER','DECIMAL','BOOLEAN','ENUM','IDENTIFIER','TIMESTAMP')),
 integer_value bigint,decimal_value numeric,boolean_value boolean,enum_value text,timestamp_value timestamptz,
 PRIMARY KEY(organization_id,guild_id,context_id,config_key),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_case_contexts,
 CHECK(num_nonnulls(integer_value,decimal_value,boolean_value,enum_value,timestamp_value)=CASE WHEN value_kind='NULL' THEN 0 ELSE 1 END)
);
CREATE TABLE rule_job_case_context_refs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,job_id uuid NOT NULL,context_id uuid NOT NULL,revision text NOT NULL,
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,guild_id,job_id,context_id),
 FOREIGN KEY(organization_id,guild_id,job_id) REFERENCES rule_evaluation_jobs,
 FOREIGN KEY(organization_id,guild_id,context_id,revision) REFERENCES rule_case_contexts(organization_id,guild_id,id,revision)
);
ALTER TABLE rule_suggestion_evidence ADD COLUMN case_context_id uuid;
ALTER TABLE rule_suggestion_evidence DROP CONSTRAINT rule_suggestion_evidence_kind_check;
ALTER TABLE rule_suggestion_evidence ADD CONSTRAINT rule_suggestion_evidence_kind_check CHECK(kind IN ('FACT','SOURCE_HEALTH','EVALUATION','CASE_CONTEXT'));
DO $$DECLARE c text;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='rule_suggestion_evidence'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'
 LOOP EXECUTE format('ALTER TABLE rule_suggestion_evidence DROP CONSTRAINT %I',c);END LOOP;
END $$;
ALTER TABLE rule_suggestion_evidence ADD CONSTRAINT rule_suggestion_evidence_one_ref CHECK(num_nonnulls(snapshot_id,health_id,evaluation_result_id,case_context_id)=1);
ALTER TABLE rule_suggestion_evidence ADD CONSTRAINT rule_suggestion_evidence_typed_ref CHECK(
 (kind='FACT' AND snapshot_id IS NOT NULL) OR (kind='SOURCE_HEALTH' AND health_id IS NOT NULL)
 OR (kind='EVALUATION' AND evaluation_result_id IS NOT NULL) OR (kind='CASE_CONTEXT' AND case_context_id IS NOT NULL)
);
ALTER TABLE rule_suggestion_evidence ADD FOREIGN KEY(organization_id,guild_id,case_context_id) REFERENCES rule_case_contexts;
CREATE TRIGGER rule_case_context_immutable BEFORE UPDATE ON rule_case_contexts FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_case_observation_immutable BEFORE UPDATE ON rule_case_observations FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_case_source_health_immutable BEFORE UPDATE ON rule_case_source_health FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_case_profile_value_immutable BEFORE UPDATE ON rule_case_profile_values FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE TRIGGER rule_job_case_context_ref_immutable BEFORE UPDATE ON rule_job_case_context_refs FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE INDEX rule_case_context_expiry ON rule_case_contexts(expires_at);
-- Frozen at first creation. Re-observation never extends either deadline.
ALTER TABLE rule_suggestions ADD COLUMN cooldown_until timestamptz;
ALTER TABLE rule_suggestions ADD COLUMN cooldown_metadata jsonb;
