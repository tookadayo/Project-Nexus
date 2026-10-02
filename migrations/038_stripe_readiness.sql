-- Quarantine generic historical references: digest namespaces and ciphertext remain unchanged.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_offerings','billing_provider_customers','billing_subscriptions','billing_provider_events','billing_reconcile_jobs'] LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',t,t || '_provider_check');
  EXECUTE format('UPDATE %I SET provider=''EXTERNAL_LEGACY'' WHERE provider=''EXTERNAL''',t);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK(provider IN (''STRIPE'',''EXTERNAL_LEGACY'',''DISCORD'',''MANUAL''))',t,t || '_provider_check');
 END LOOP;
END $$;
UPDATE billing_provider_events SET normalized=jsonb_set(normalized,'{provider}','"EXTERNAL_LEGACY"') WHERE provider='EXTERNAL_LEGACY';
UPDATE promotion_campaigns SET allowed_providers=replace(allowed_providers::text,'"EXTERNAL"','"EXTERNAL_LEGACY"')::jsonb WHERE allowed_providers @> '["EXTERNAL"]';
ALTER TABLE billing_subscriptions DROP CONSTRAINT billing_subscriptions_status_check;
ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_status_check CHECK(status IN ('TRIALING','ACTIVE','PAST_DUE','GRACE','SUSPENDED','CANCEL_AT_PERIOD_END','CANCELED','INCOMPLETE','EXPIRED','UNKNOWN','CONFLICT'));
ALTER TABLE billing_accounts ADD COLUMN trial_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE billing_offerings ADD COLUMN provider_product_id text;
ALTER TABLE billing_offerings ADD COLUMN provider_price_id text;
ALTER TABLE billing_offerings ADD COLUMN billing_interval text NOT NULL DEFAULT 'MONTH' CHECK(billing_interval IN ('MONTH','YEAR'));
ALTER TABLE billing_offerings ADD COLUMN billing_interval_count integer NOT NULL DEFAULT 1 CHECK(billing_interval_count>0);
ALTER TABLE billing_offerings ADD COLUMN tax_behavior text NOT NULL DEFAULT 'UNSPECIFIED' CHECK(tax_behavior IN ('UNSPECIFIED','INCLUSIVE','EXCLUSIVE'));
CREATE UNIQUE INDEX billing_offering_price ON billing_offerings(provider,provider_price_id) WHERE provider_price_id IS NOT NULL;
ALTER TABLE billing_provider_events ADD COLUMN dead_lettered_at timestamptz;
CREATE TABLE billing_provider_signals (
 id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider='STRIPE'), event_digest text NOT NULL,
 organization_id uuid NOT NULL, guild_id text NOT NULL,
 reference_ciphertext text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 error_category text, projected_at timestamptz, dead_lettered_at timestamptz,
 lease_token uuid, lease_until timestamptz,
 UNIQUE(provider,event_digest), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX billing_signals_pending ON billing_provider_signals(available_at) WHERE projected_at IS NULL AND dead_lettered_at IS NULL;
CREATE TABLE billing_snapshot_sequences (
 organization_id uuid NOT NULL REFERENCES organizations(id), provider text NOT NULL CHECK(provider='STRIPE'),
 revision bigint NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, PRIMARY KEY(organization_id,provider)
);
CREATE TABLE billing_operations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, guild_id text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('STRIPE','DISCORD','MANUAL')),
 operation text NOT NULL CHECK(operation IN ('CHECKOUT','PORTAL','CHANGE','CANCEL')),
 request_digest text NOT NULL, input_digest text NOT NULL, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','FINALIZED','FAILED')),
 lease_token uuid, lease_until timestamptz, result_ciphertext text, result_expires_at timestamptz, error_category text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,guild_id,operation,request_digest),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE promotion_redemption_reservations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, guild_id text NOT NULL,
 campaign_id uuid NOT NULL REFERENCES promotion_campaigns(id), code_id uuid NOT NULL REFERENCES promotion_codes(id),
 offering_id uuid NOT NULL REFERENCES billing_offerings(id), eligible_plan text NOT NULL REFERENCES plans(key), request_digest text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','FINALIZED','EXPIRED','CANCELED')),
 expires_at timestamptz NOT NULL, finalized_at timestamptz, confirmation_digest text UNIQUE, reference_digest text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,guild_id,request_digest), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX promotion_reservations_quota ON promotion_redemption_reservations(campaign_id,expires_at) WHERE state='PENDING';
