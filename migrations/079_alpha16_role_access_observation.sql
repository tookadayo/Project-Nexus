-- Role-level native metadata only. No member-overwrite IDs, member permission,
-- message body, target individual, intent, Run or user input values.
CREATE TABLE rule_role_access_observations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,context_id uuid NOT NULL,
 case_id text NOT NULL CHECK(case_id IN ('CASE01','CASE10','CASE17')),
 target_type text NOT NULL,target_id text NOT NULL,live_version text NOT NULL,
 config_hash text NOT NULL CHECK(config_hash~'^[a-f0-9]{64}$'),binding_hash text NOT NULL CHECK(binding_hash~'^[a-f0-9]{64}$'),
 capability_snapshot_id uuid NOT NULL,capability_hash text NOT NULL CHECK(capability_hash~'^[a-f0-9]{64}$'),settings_revision integer NOT NULL,
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND pg_column_size(metadata)<=262144),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),observed_at timestamptz NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,context_id),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_operational_contexts ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 CHECK(expires_at>observed_at AND expires_at<=observed_at+interval '48 hours'),CHECK(expires_at>created_at)
);
CREATE TRIGGER immutable_role_access_observation BEFORE UPDATE ON rule_role_access_observations FOR EACH ROW EXECUTE FUNCTION rule_immutable_payload();
CREATE INDEX rule_role_access_expiry ON rule_role_access_observations(expires_at);
