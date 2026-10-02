-- Additive v2 commerce state. Legacy subscriptions and usage remain unchanged.
CREATE TABLE billing_accounts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
 provider_grace_hours integer NOT NULL DEFAULT 72 CHECK(provider_grace_hours BETWEEN 0 AND 720),
 downgrade_recovery_days integer NOT NULL DEFAULT 30 CHECK(downgrade_recovery_days BETWEEN 0 AND 90),
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_plan_versions (
 plan_key text NOT NULL REFERENCES plans(key), revision integer NOT NULL,
 features jsonb NOT NULL, limits jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(plan_key,revision)
);
CREATE TRIGGER immutable_billing_plan BEFORE UPDATE ON billing_plan_versions FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
CREATE TABLE billing_offerings (
 id uuid PRIMARY KEY, plan_key text NOT NULL, plan_revision integer NOT NULL,
 provider text NOT NULL CHECK(provider IN ('EXTERNAL','DISCORD','MANUAL')),
 provider_offering_id text, enabled boolean NOT NULL DEFAULT false,
 currency text, final_price_minor integer CHECK(final_price_minor>=0),
 parity_reviewed_at timestamptz,
 FOREIGN KEY(plan_key,plan_revision) REFERENCES billing_plan_versions,
 UNIQUE(provider,provider_offering_id)
);
CREATE TABLE billing_provider_customers (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES billing_accounts(id),
 provider text NOT NULL CHECK(provider IN ('EXTERNAL','DISCORD','MANUAL')),
 reference_digest text NOT NULL, reference_ciphertext text NOT NULL,
 UNIQUE(provider,reference_digest), UNIQUE(account_id,provider)
);
CREATE TABLE billing_subscriptions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES billing_accounts(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 provider text NOT NULL CHECK(provider IN ('EXTERNAL','DISCORD','MANUAL')),
 reference_digest text NOT NULL, reference_ciphertext text,
 plan_key text NOT NULL REFERENCES plans(key), plan_revision integer NOT NULL DEFAULT 2,
 status text NOT NULL CHECK(status IN ('TRIALING','ACTIVE','PAST_DUE','GRACE','CANCEL_AT_PERIOD_END','CANCELED','INCOMPLETE','UNKNOWN','CONFLICT')),
 current_period_end timestamptz, scheduled_plan text REFERENCES plans(key), scheduled_at timestamptz,
 confirmed_at timestamptz, last_good_plan text REFERENCES plans(key), last_good_until timestamptz,
 provider_event_at timestamptz NOT NULL, provider_event_version bigint NOT NULL DEFAULT 0,
 provider_event_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,reference_digest), UNIQUE(organization_id,id)
);
CREATE TABLE billing_subscription_assignments (
 organization_id uuid NOT NULL, guild_id text NOT NULL, subscription_id uuid NOT NULL,
 assigned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,subscription_id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 FOREIGN KEY(organization_id,subscription_id) REFERENCES billing_subscriptions(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE billing_provider_events (
 id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('EXTERNAL','DISCORD','MANUAL')),
 event_digest text NOT NULL, organization_id uuid NOT NULL, guild_id text NOT NULL,
 normalized jsonb NOT NULL, verified_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), projected_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), error_category text,
 UNIQUE(provider,event_digest), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX billing_inbox_pending ON billing_provider_events(available_at,received_at) WHERE projected_at IS NULL;
CREATE TABLE entitlement_grants (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), guild_id text,
 source text NOT NULL CHECK(source IN ('PROMOTION','TRIAL','PARTNER','DEBUG','CONTRACT','LEGACY')),
 plan_key text REFERENCES plans(key), features jsonb NOT NULL DEFAULT '[]', limits jsonb NOT NULL DEFAULT '{}',
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, revoked_at timestamptz,
 created_by text, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(ends_at IS NULL OR ends_at>starts_at), CHECK(source<>'DEBUG' OR ends_at IS NOT NULL)
);
CREATE INDEX entitlement_grants_scope ON entitlement_grants(organization_id,guild_id) WHERE revoked_at IS NULL;
CREATE TABLE billing_usage_monthly (
 organization_id uuid NOT NULL, guild_id text NOT NULL, month date NOT NULL,
 api_requests bigint NOT NULL DEFAULT 0, reports bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,guild_id,month), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE billing_guild_state (
 organization_id uuid NOT NULL, guild_id text NOT NULL, effective_plan text NOT NULL DEFAULT 'FREE' REFERENCES plans(key),
 conflict boolean NOT NULL DEFAULT false, recovery_until timestamptz, recovery_history_days integer,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE billing_authorizations (
 organization_id uuid NOT NULL REFERENCES organizations(id), actor_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('BILLING_MANAGER')), revoked_at timestamptz,
 PRIMARY KEY(organization_id,actor_hash)
);
CREATE TABLE billing_audit_log (
 id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id), guild_id text,
 actor_hash text, action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve existing alpha.5 manual plan assignments as explicit migration grants.
-- A future provider import must not silently replace an existing valid plan.
INSERT INTO entitlement_grants(id,organization_id,guild_id,source,plan_key,starts_at,ends_at,reason)
SELECT gen_random_uuid(),organization_id,guild_id,'LEGACY',plan_key,now(),valid_until,'Preserved alpha.5 manual plan; revoke explicitly during provider migration'
FROM guild_subscriptions WHERE status='active' AND plan_key<>'FREE' AND (valid_until IS NULL OR valid_until>now());
CREATE INDEX billing_audit_scope ON billing_audit_log(organization_id,guild_id,occurred_at);
-- Alpha.5's already configured operational features are grandfathered explicitly.
INSERT INTO entitlement_grants(id,organization_id,guild_id,source,features,reason)
SELECT gen_random_uuid(),organization_id,guild_id,'LEGACY',
 CASE WHEN settings->>'helperEnabled'='true' AND settings->>'weeklySummaryEnabled'='true' THEN '["attention_automation","attention_escalation","team_routing","scheduled_digest"]'::jsonb
 WHEN settings->>'helperEnabled'='true' THEN '["attention_automation","attention_escalation","team_routing"]'::jsonb
 ELSE '["scheduled_digest"]'::jsonb END,'Alpha.5 configured operations compatibility'
FROM guild_settings WHERE settings->>'helperEnabled'='true' OR settings->>'weeklySummaryEnabled'='true';
-- Published configuration revisions remain immutable; commercial pause is separate.
CREATE TABLE billing_rule_states (
 organization_id uuid NOT NULL, guild_id text NOT NULL, rule_key text NOT NULL,
 feature text NOT NULL, state text NOT NULL CHECK(state IN ('ACTIVE','PAUSED_PLAN_LIMIT')),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,guild_id,rule_key),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);

-- Immutable catalog revision 2. Internal prices in legacy plans remain provisional.
INSERT INTO billing_plan_versions(plan_key,revision,features,limits) VALUES
('FREE',2,'["core_observation","basic_attention","connection_metrics","thread_forum_metrics","reaction_poll_metrics","voice_metrics","event_metrics","coverage_health","fallback_onboarding","hybrid_onboarding","interventions"]'::jsonb,'{"guilds":1,"historyDays":30,"monthlyObservedMembers":250,"customRecipes":0,"automationRules":0,"scheduledReports":0,"teamSeats":1,"webhooks":0,"apiRequestsMonthly":0}'::jsonb),
('STARTER',2,'["core_observation","basic_attention","connection_metrics","thread_forum_metrics","reaction_poll_metrics","voice_metrics","event_metrics","coverage_health","fallback_onboarding","hybrid_onboarding","interventions","all_recipe_presets","surface_breakdowns","percentile_metrics","advanced_journeys","comparable_periods","scheduled_digest","basic_improvement_tracking","custom_activation","advanced_cohorts","diagnosis"]'::jsonb,'{"guilds":1,"historyDays":90,"monthlyObservedMembers":1000,"customRecipes":0,"automationRules":0,"scheduledReports":1,"teamSeats":1,"webhooks":0,"apiRequestsMonthly":0}'::jsonb),
('GROWTH',2,'["core_observation","basic_attention","connection_metrics","thread_forum_metrics","reaction_poll_metrics","voice_metrics","event_metrics","coverage_health","fallback_onboarding","hybrid_onboarding","interventions","all_recipe_presets","surface_breakdowns","percentile_metrics","advanced_journeys","comparable_periods","scheduled_digest","basic_improvement_tracking","custom_activation","custom_recipe","attention_automation","attention_escalation","improvement_tracking","scheduled_reports","team_routing","csv_export","webhooks","ai_explanation","advanced_cohorts","diagnosis","automation_auto","experiments"]'::jsonb,'{"guilds":1,"historyDays":365,"monthlyObservedMembers":5000,"customRecipes":5,"automationRules":10,"scheduledReports":10,"teamSeats":5,"webhooks":5,"apiRequestsMonthly":0}'::jsonb),
('SCALE',2,'["core_observation","basic_attention","connection_metrics","thread_forum_metrics","reaction_poll_metrics","voice_metrics","event_metrics","coverage_health","fallback_onboarding","hybrid_onboarding","interventions","all_recipe_presets","surface_breakdowns","percentile_metrics","advanced_journeys","comparable_periods","scheduled_digest","basic_improvement_tracking","custom_activation","custom_recipe","attention_automation","attention_escalation","improvement_tracking","scheduled_reports","team_routing","csv_export","webhooks","ai_explanation","multi_guild","rbac","api","audit_export","advanced_cohorts","diagnosis","automation_auto","experiments"]'::jsonb,'{"guilds":5,"historyDays":730,"monthlyObservedMembers":25000,"customRecipes":25,"automationRules":50,"scheduledReports":50,"teamSeats":20,"webhooks":20,"apiRequestsMonthly":100000}'::jsonb),
('ENTERPRISE',2,'["core_observation","basic_attention","connection_metrics","thread_forum_metrics","reaction_poll_metrics","voice_metrics","event_metrics","coverage_health","fallback_onboarding","hybrid_onboarding","interventions","all_recipe_presets","surface_breakdowns","percentile_metrics","advanced_journeys","comparable_periods","scheduled_digest","basic_improvement_tracking","custom_activation","custom_recipe","attention_automation","attention_escalation","improvement_tracking","scheduled_reports","team_routing","csv_export","webhooks","ai_explanation","multi_guild","rbac","api","audit_export","advanced_cohorts","diagnosis","automation_auto","experiments"]'::jsonb,'{"guilds":null,"historyDays":null,"monthlyObservedMembers":null,"customRecipes":null,"automationRules":null,"scheduledReports":null,"teamSeats":null,"webhooks":null,"apiRequestsMonthly":null}'::jsonb);
