CREATE TABLE billing_reconcile_jobs (
 organization_id uuid NOT NULL, guild_id text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('EXTERNAL','DISCORD','MANUAL')),
 due_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 failures integer NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,guild_id,provider), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX billing_reconcile_due ON billing_reconcile_jobs(due_at);
ALTER TABLE measurement_recipe_versions ADD COLUMN custom_recipe_key uuid;
CREATE INDEX custom_recipe_library ON measurement_recipe_versions(organization_id,guild_id,custom_recipe_key) WHERE custom_recipe_key IS NOT NULL;
