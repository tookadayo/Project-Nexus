-- Structured staff context only. No member, message body, free-form explanation,
-- actual permission or manually supplied cohort value is retained here.
CREATE TABLE rule_operational_contexts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),case_id text NOT NULL CHECK(case_id ~ '^CASE(0[1-9]|1[0-9]|20)$'),
 target_type text NOT NULL,target_id text NOT NULL,live_version text,
 base_result_id uuid,source_configs jsonb NOT NULL DEFAULT '[]',window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 observed_at timestamptz NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(jsonb_typeof(source_configs)='array' AND jsonb_array_length(source_configs)<=3 AND pg_column_size(source_configs)<=65536),CHECK(window_start<window_end),CHECK(window_end<=observed_at),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '48 hours')
);
CREATE TABLE rule_operational_fields (
 organization_id uuid NOT NULL,guild_id text NOT NULL,context_id uuid NOT NULL,field_id text NOT NULL,
 quality text NOT NULL CHECK(quality IN ('SUFFICIENT','PARTIAL','STALE','MISSING','SUPPRESSED','UNKNOWN')),
 source_kind text CHECK(source_kind IN ('OPERATOR','SYSTEM_OBSERVATION')),
 value_kind text NOT NULL CHECK(value_kind IN ('NULL','INTEGER','DECIMAL','ENUM','BOOLEAN','TIMESTAMP','IDENTIFIER','COHORT')),
 enum_value text,boolean_value boolean,timestamp_value timestamptz,integer_value bigint,decimal_value numeric(38,18),
 numerator bigint,denominator bigint,coverage numeric(38,18),source_metadata jsonb,
 observed_at timestamptz,expires_at timestamptz,native_reference text,
 PRIMARY KEY(organization_id,guild_id,context_id,field_id),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_operational_contexts ON DELETE CASCADE,
 CHECK((source_kind IS NOT NULL AND observed_at IS NOT NULL AND expires_at>observed_at) OR (quality<>'SUFFICIENT' AND source_kind IS NULL AND value_kind='NULL' AND enum_value IS NULL AND boolean_value IS NULL AND timestamp_value IS NULL AND native_reference IS NULL AND source_metadata IS NULL)),
 CHECK(enum_value IS NULL OR char_length(enum_value)<=128),
 CHECK(source_metadata IS NULL OR (jsonb_typeof(source_metadata)='object' AND pg_column_size(source_metadata)<=32768)),
 CHECK((value_kind='NULL' AND num_nonnulls(enum_value,boolean_value,timestamp_value,integer_value,decimal_value,numerator,denominator,coverage)=0) OR (value_kind IN ('ENUM','IDENTIFIER') AND enum_value IS NOT NULL AND num_nonnulls(boolean_value,timestamp_value,integer_value,decimal_value,numerator,denominator,coverage)=0) OR (value_kind='BOOLEAN' AND boolean_value IS NOT NULL AND num_nonnulls(enum_value,timestamp_value,integer_value,decimal_value,numerator,denominator,coverage)=0) OR (value_kind='TIMESTAMP' AND timestamp_value IS NOT NULL AND num_nonnulls(enum_value,boolean_value,integer_value,decimal_value,numerator,denominator,coverage)=0) OR (value_kind='INTEGER' AND integer_value IS NOT NULL AND num_nonnulls(enum_value,boolean_value,timestamp_value,decimal_value,numerator,denominator,coverage)=0) OR (value_kind='DECIMAL' AND decimal_value IS NOT NULL AND num_nonnulls(enum_value,boolean_value,timestamp_value,integer_value,numerator,denominator,coverage)=0) OR (value_kind='COHORT' AND numerator>=0 AND denominator>=numerator AND coverage BETWEEN 0 AND 1 AND num_nonnulls(numerator,denominator,coverage)=3 AND num_nonnulls(enum_value,boolean_value,timestamp_value,integer_value,decimal_value)=0))
);
-- Bounded operational profile snapshots. No fixture profile, implicit threshold
-- or automatic activation is stored. GOVERN explicitly changes enabled state.
CREATE TABLE rule_operational_case_profiles (
 organization_id uuid NOT NULL,guild_id text NOT NULL,case_id text NOT NULL,
 version integer NOT NULL CHECK(version>0),enabled boolean NOT NULL,definition jsonb NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,case_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(case_id ~ '^CASE(0[1-9]|1[0-9]|20)$'),CHECK(jsonb_typeof(definition)='object' AND pg_column_size(definition)<=32768),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '48 hours')
);
-- Same minimal authoring communication identity purpose as other configuration
-- writers. A missing prepared row can never be interpreted as a new mutation.
CREATE TABLE rule_operational_requests (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,actor_hash text NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('PREPARED','COMPLETED')),
 result jsonb,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '48 hours'),
 CHECK(result IS NULL OR (jsonb_typeof(result)='object' AND pg_column_size(result)<=1024))
);
CREATE INDEX rule_operational_context_expiry ON rule_operational_contexts(expires_at);
CREATE INDEX rule_operational_profile_expiry ON rule_operational_case_profiles(expires_at);
CREATE INDEX rule_operational_request_expiry ON rule_operational_requests(expires_at);

CREATE INDEX rule_operational_context_case ON rule_operational_contexts(organization_id,guild_id,case_id,id);
