-- Existing CONFIG purpose only. No operating profile, permission, policy or
-- measured value is installed by this additive schema migration.
ALTER TABLE rule_config_versions ADD COLUMN operating_profile_revision text;
ALTER TABLE rule_config_versions ADD COLUMN operating_profile_hash text CHECK(operating_profile_hash~'^[a-f0-9]{64}$');
ALTER TABLE rule_config_versions ADD COLUMN operating_profile_expires_at timestamptz;
ALTER TABLE rule_config_versions ADD COLUMN source_config_version integer CHECK(source_config_version>0);
ALTER TABLE rule_config_versions ADD CHECK(num_nonnulls(operating_profile_revision,operating_profile_hash,operating_profile_expires_at) IN (0,3));
ALTER TABLE rule_config_versions ADD CHECK(operating_profile_expires_at IS NULL OR operating_profile_expires_at<=expires_at);
-- source_config_version is immutable definition provenance, not a dependency
-- that could keep an expired definition/evaluation/Run alive through an FK.
