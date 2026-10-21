-- Finite shared source snapshots only. No member/actor/body columns. Native
-- references and staff classification configuration use the existing 077
-- authoring communication identity, permission checks and first-capture TTL.
CREATE TABLE rule_operational_native_captures (
 organization_id uuid NOT NULL,guild_id text NOT NULL,context_id uuid NOT NULL,
 case_id text NOT NULL CHECK(case_id IN ('CASE13','CASE14','CASE15','CASE16','CASE19','CASE20')),
 config_hash text NOT NULL CHECK(config_hash~'^[a-f0-9]{64}$'),
 target_hash text NOT NULL CHECK(target_hash~'^[a-f0-9]{64}$'),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='array' AND jsonb_array_length(fields)<=16),
 verified_role_ids text[] NOT NULL DEFAULT '{}',role_observed_at timestamptz,role_expires_at timestamptz,
 first_captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,context_id),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_operational_contexts ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 CHECK(expires_at>first_captured_at AND expires_at<=first_captured_at+interval '48 hours'),
 CHECK(cardinality(verified_role_ids)<=128 AND ((cardinality(verified_role_ids)=0 AND role_observed_at IS NULL AND role_expires_at IS NULL)
 OR (cardinality(verified_role_ids)>0 AND role_observed_at IS NOT NULL AND role_expires_at>role_observed_at AND role_expires_at<=role_observed_at+interval '1 hour' AND expires_at<=role_expires_at)))
);
CREATE INDEX rule_operational_native_expiry ON rule_operational_native_captures(expires_at);
CREATE TABLE rule_operational_filter_configs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,context_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 rule_hash text NOT NULL CHECK(rule_hash~'^[a-f0-9]{64}$'),
 configured_language text NOT NULL CHECK(configured_language~'^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$'),
 definition_hash text NOT NULL CHECK(definition_hash~'^[a-f0-9]{64}$'),
 configured_at timestamptz NOT NULL,first_captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,context_id),
 FOREIGN KEY(organization_id,guild_id,context_id) REFERENCES rule_operational_contexts ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 CHECK(expires_at>first_captured_at AND expires_at<=first_captured_at+interval '48 hours'),
 CHECK(configured_at>=first_captured_at AND configured_at<expires_at)
);
CREATE INDEX rule_operational_filter_expiry ON rule_operational_filter_configs(expires_at);
CREATE FUNCTION nexus_operational_native_expiry_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.first_captured_at IS DISTINCT FROM OLD.first_captured_at OR NEW.expires_at>OLD.expires_at THEN
  RAISE EXCEPTION 'OPERATIONAL_SOURCE_EXPIRY_EXTENSION_FORBIDDEN';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rule_operational_native_expiry_fence BEFORE UPDATE ON rule_operational_native_captures
 FOR EACH ROW EXECUTE FUNCTION nexus_operational_native_expiry_fence();
CREATE TRIGGER rule_operational_filter_expiry_fence BEFORE UPDATE ON rule_operational_filter_configs
 FOR EACH ROW EXECUTE FUNCTION nexus_operational_native_expiry_fence();
