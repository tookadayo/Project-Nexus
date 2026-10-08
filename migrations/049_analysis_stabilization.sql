-- Append-only upgrade from published alpha.10; balances and results are retained.
ALTER TABLE analysis_runs DROP CONSTRAINT analysis_runs_analysis_type_check;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_analysis_type_check
 CHECK(analysis_type IN ('OVERALL','NEW_MEMBERS','SUPPORT','EVENTS','VOICE','ANNOUNCEMENTS','SHOWCASE'));
ALTER TABLE analysis_runs ADD COLUMN confirmation_fingerprint text;
ALTER TABLE analysis_runs ADD COLUMN data_identity text;
ALTER TABLE analysis_runs ADD COLUMN target_channel_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE analysis_runs ADD COLUMN calculated_at timestamptz;
ALTER TABLE analysis_runs ADD COLUMN invalidated_at timestamptz;
ALTER TABLE analysis_runs ADD COLUMN invalidation_reason text CHECK(invalidation_reason IN ('PRIVACY_DELETED','DATA_REMOVED'));
ALTER TABLE analysis_runs ADD COLUMN conditions jsonb CHECK(conditions IS NULL OR (jsonb_typeof(conditions)='object' AND octet_length(conditions::text)<=262144));
ALTER TABLE analysis_runs ADD COLUMN scope_bug_impact text NOT NULL DEFAULT 'UNASSESSED'
 CHECK(scope_bug_impact IN ('UNASSESSED','POSSIBLE_CATEGORY_PARENT','CORRECTED_DEFINITION'));
UPDATE analysis_runs SET scope_bug_impact='POSSIBLE_CATEGORY_PARENT'
 WHERE recipe_version LIKE 'analysis-observation-v1:%' AND EXISTS (
  SELECT 1 FROM discord_surface_state c WHERE c.organization_id=analysis_runs.organization_id
  AND c.guild_id=analysis_runs.guild_id AND c.channel_type IN (0,2,5,13,15,16) AND c.parent_id IS NOT NULL
 );
-- A correction is earmarked for one affected original result. It cannot fund
-- an ordinary run and never changes a monthly/pack balance or the old result.
ALTER TABLE analysis_grants DROP CONSTRAINT analysis_grants_source_check;
ALTER TABLE analysis_grants ADD CONSTRAINT analysis_grants_source_check
 CHECK(source IN ('PLAN_INCLUDED','PACK_PURCHASE','MANUAL','BUG_CORRECTION'));
ALTER TABLE analysis_runs ADD COLUMN correction_of uuid;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_correction_original
 FOREIGN KEY(organization_id,guild_id,correction_of) REFERENCES analysis_runs(organization_id,guild_id,id) ON DELETE SET NULL (correction_of);
CREATE TABLE analysis_history_cursors (
 token uuid PRIMARY KEY, organization_id uuid NOT NULL, guild_id text NOT NULL,
 actor_hash text NOT NULL, requested_at timestamptz NOT NULL, run_id uuid NOT NULL,
 filters jsonb NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX analysis_history_cursor_expiry ON analysis_history_cursors(expires_at);
CREATE TABLE analysis_preview_limits (
 organization_id uuid NOT NULL,guild_id text NOT NULL,actor_hash text NOT NULL,
 minute timestamptz NOT NULL,requests integer NOT NULL,
 PRIMARY KEY(organization_id,guild_id,actor_hash,minute),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX analysis_comparison_lookup ON analysis_runs
 (organization_id,guild_id,analysis_type,recipe_version,scope_identity,period_days,period_end DESC)
 WHERE status='COMPLETED';
