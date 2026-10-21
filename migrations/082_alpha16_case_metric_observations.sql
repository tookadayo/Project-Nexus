-- Immutable SQL observations over already permitted, retained native metadata.
-- No member/actor identifiers, message body, arbitrary business JSON or new purpose.
CREATE TABLE rule_case_metric_observations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 context_id uuid NOT NULL,config_hash text NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,context_id,config_hash),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_operational_contexts(organization_id,guild_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '48 hours')
);
CREATE INDEX rule_case_metric_expiry ON rule_case_metric_observations(expires_at);
CREATE TABLE rule_case_metric_values (
 organization_id uuid NOT NULL,guild_id text NOT NULL,observation_id uuid NOT NULL,
 field_id text NOT NULL CHECK(length(field_id) BETWEEN 1 AND 128),
 value_kind text NOT NULL CHECK(value_kind IN ('INTEGER','DECIMAL','BOOLEAN','ENUM','IDENTIFIER','TIMESTAMP','COHORT')),
 integer_value numeric(19,0),decimal_value numeric,boolean_value boolean,text_value text CHECK(length(text_value)<=128),timestamp_value timestamptz,
 numerator numeric(19,0),denominator numeric(19,0),coverage numeric,
 unit text NOT NULL CHECK(unit IN ('state','boolean','count','ratio','seconds','minutes','instant','identifier')),
 source_expires_at timestamptz NOT NULL,
 -- Only codec-validated Window/CohortMetadata/periodRole/metricId; never values.
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 PRIMARY KEY(organization_id,guild_id,observation_id,field_id),
 FOREIGN KEY(organization_id,guild_id,observation_id) REFERENCES rule_case_metric_observations ON DELETE CASCADE,
 CHECK((value_kind='INTEGER' AND integer_value IS NOT NULL AND decimal_value IS NULL AND boolean_value IS NULL AND text_value IS NULL AND timestamp_value IS NULL AND numerator IS NULL AND denominator IS NULL AND coverage IS NULL)
 OR (value_kind='DECIMAL' AND integer_value IS NULL AND decimal_value IS NOT NULL AND boolean_value IS NULL AND text_value IS NULL AND timestamp_value IS NULL AND numerator IS NULL AND denominator IS NULL AND coverage IS NULL)
 OR (value_kind='BOOLEAN' AND integer_value IS NULL AND decimal_value IS NULL AND boolean_value IS NOT NULL AND text_value IS NULL AND timestamp_value IS NULL AND numerator IS NULL AND denominator IS NULL AND coverage IS NULL)
 OR (value_kind IN ('ENUM','IDENTIFIER') AND integer_value IS NULL AND decimal_value IS NULL AND boolean_value IS NULL AND text_value IS NOT NULL AND timestamp_value IS NULL AND numerator IS NULL AND denominator IS NULL AND coverage IS NULL)
 OR (value_kind='TIMESTAMP' AND integer_value IS NULL AND decimal_value IS NULL AND boolean_value IS NULL AND text_value IS NULL AND timestamp_value IS NOT NULL AND numerator IS NULL AND denominator IS NULL AND coverage IS NULL)
 OR (value_kind='COHORT' AND integer_value IS NULL AND decimal_value IS NULL AND boolean_value IS NULL AND text_value IS NULL AND timestamp_value IS NULL AND numerator IS NOT NULL AND denominator IS NOT NULL AND coverage IS NOT NULL AND numerator>=0 AND denominator>=numerator AND coverage BETWEEN 0 AND 1))
);
