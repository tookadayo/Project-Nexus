DROP TABLE data_coverage_snapshots,native_lifecycle_state,native_member_snapshots,native_snapshot_jobs,guild_config_heads,guild_config_revisions,guild_capabilities;
DROP FUNCTION immutable_published_revision();
-- Keep backfilled fallback choices in settings; rollback must not silently change onboarding.
