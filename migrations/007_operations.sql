CREATE TABLE intervention_runs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,episode_id uuid NOT NULL,revision_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('suggested','approval','queued','running','delivered','failed','unknown','suppressed')),
 reason text,approved_by text,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES guild_config_revisions ON DELETE CASCADE
);
CREATE TABLE experiment_assignments (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,episode_id uuid NOT NULL,revision_id uuid NOT NULL,
 variant text NOT NULL,unit_key text NOT NULL,assigned_at timestamptz NOT NULL,window_end timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,episode_id,revision_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES guild_config_revisions ON DELETE CASCADE
);
CREATE TRIGGER immutable_assignment BEFORE UPDATE ON experiment_assignments FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
CREATE TABLE experiment_exposures (
 organization_id uuid NOT NULL,guild_id text NOT NULL,assignment_id uuid NOT NULL,run_id uuid NOT NULL,exposed_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,assignment_id,run_id),
 FOREIGN KEY(organization_id,guild_id,assignment_id) REFERENCES experiment_assignments ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES intervention_runs ON DELETE CASCADE
);
ALTER TABLE intervention_runs ADD COLUMN assignment_id uuid,
 ADD FOREIGN KEY(organization_id,guild_id,assignment_id) REFERENCES experiment_assignments ON DELETE CASCADE;
CREATE UNIQUE INDEX run_assignment ON intervention_runs(organization_id,guild_id,assignment_id) WHERE assignment_id IS NOT NULL;
CREATE TABLE intervention_role_grants (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,role_id text NOT NULL,run_id uuid NOT NULL,source text NOT NULL DEFAULT 'NEXUS' CHECK(source='NEXUS'),granted_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,episode_id,role_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES intervention_runs ON DELETE CASCADE
);
CREATE TABLE experiment_metric_results (
 organization_id uuid NOT NULL,guild_id text NOT NULL,revision_id uuid NOT NULL,computed_at timestamptz NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(organization_id,guild_id,revision_id,computed_at), FOREIGN KEY(organization_id,guild_id,revision_id) REFERENCES guild_config_revisions ON DELETE CASCADE
);
CREATE TABLE plans (key text PRIMARY KEY,monthly_usd integer,included_mtm integer,guild_limit integer NOT NULL);
INSERT INTO plans VALUES ('FREE',0,250,1),('STARTER',15,1000,1),('GROWTH',49,5000,1),('SCALE',149,25000,5),('ENTERPRISE',NULL,NULL,100);
CREATE TABLE plan_features (plan_key text NOT NULL REFERENCES plans,key text NOT NULL,PRIMARY KEY(plan_key,key));
CREATE TABLE guild_subscriptions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,plan_key text NOT NULL REFERENCES plans DEFAULT 'FREE',provider text,provider_reference text,status text NOT NULL DEFAULT 'active',valid_until timestamptz,
 PRIMARY KEY(organization_id,guild_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE usage_counters (
 organization_id uuid NOT NULL,guild_id text NOT NULL,month date NOT NULL,member_hash text NOT NULL,first_seen timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,month,member_hash), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
