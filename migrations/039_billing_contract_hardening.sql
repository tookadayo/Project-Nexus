-- Commercial Contract Hardening. Preserve all legacy digests, ciphertext and audits.
ALTER TABLE billing_offerings ADD COLUMN commercial_locked boolean NOT NULL DEFAULT false;
-- Pre-039 does not record ever-enabled history. Conservatively freeze every
-- existing row instead of guessing that an old disabled row was never sold.
UPDATE billing_offerings SET commercial_locked=true;
ALTER TABLE billing_offerings ADD CONSTRAINT stripe_enabled_commercial_mapping CHECK (
 provider<>'STRIPE' OR NOT enabled OR (
  provider_product_id IS NOT NULL AND length(trim(provider_product_id))>0 AND
  provider_price_id IS NOT NULL AND length(trim(provider_price_id))>0 AND
  currency IS NOT NULL AND currency ~ '^[A-Z]{3}$' AND
  final_price_minor IS NOT NULL AND final_price_minor>=0 AND
  tax_behavior IN ('INCLUSIVE','EXCLUSIVE')
 )
);
CREATE FUNCTION guard_billing_offering_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.commercial_locked OR OLD.enabled THEN RAISE EXCEPTION 'BILLING_OFFERING_IMMUTABLE'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.commercial_locked OR OLD.enabled) THEN
  IF ROW(NEW.id,NEW.plan_key,NEW.plan_revision,NEW.provider,NEW.provider_product_id,
    NEW.provider_price_id,NEW.provider_offering_id,NEW.billing_interval,
    NEW.billing_interval_count,NEW.currency,NEW.final_price_minor,NEW.tax_behavior)
   IS DISTINCT FROM ROW(OLD.id,OLD.plan_key,OLD.plan_revision,OLD.provider,OLD.provider_product_id,
    OLD.provider_price_id,OLD.provider_offering_id,OLD.billing_interval,
    OLD.billing_interval_count,OLD.currency,OLD.final_price_minor,OLD.tax_behavior)
   THEN RAISE EXCEPTION 'BILLING_OFFERING_IMMUTABLE'; END IF;
  NEW.commercial_locked=true;
 END IF;
 IF NEW.enabled THEN NEW.commercial_locked=true; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_offering_identity BEFORE INSERT OR UPDATE OR DELETE ON billing_offerings
 FOR EACH ROW EXECUTE FUNCTION guard_billing_offering_identity();

ALTER TABLE billing_operations ADD COLUMN offering_id uuid REFERENCES billing_offerings(id);
ALTER TABLE billing_operations ADD COLUMN subscription_id uuid REFERENCES billing_subscriptions(id);
ALTER TABLE billing_operations ADD COLUMN external_started_at timestamptz;
ALTER TABLE billing_operations ADD COLUMN retry_until timestamptz;
ALTER TABLE billing_operations ADD COLUMN provider_reference_digest text;
ALTER TABLE billing_operations DROP CONSTRAINT billing_operations_state_check;
ALTER TABLE billing_operations ADD CONSTRAINT billing_operations_state_check
 CHECK(state IN ('PENDING','FINALIZED','FAILED','RECONCILE_REQUIRED'));
-- A crashed pre-alpha.7 pending lease may already have crossed the provider boundary.
UPDATE billing_operations SET state='RECONCILE_REQUIRED',error_category='BILLING_OUTCOME_UNKNOWN'
 WHERE state='PENDING' AND lease_token IS NOT NULL;

CREATE FUNCTION lock_commercial_offering_use() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE available boolean; locked boolean;
BEGIN
 IF NEW.offering_id IS NOT NULL THEN
  -- Enabled rows are already permanently locked. Avoid SHARE -> UPDATE lock
  -- upgrades when two guilds use the same Offering concurrently.
  SELECT enabled,commercial_locked INTO available,locked FROM billing_offerings WHERE id=NEW.offering_id;
  IF available IS DISTINCT FROM true THEN RAISE EXCEPTION 'BILLING_OFFERING_UNAVAILABLE'; END IF;
  IF NOT locked THEN
   UPDATE billing_offerings SET commercial_locked=true WHERE id=NEW.offering_id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_operation_offering_use BEFORE INSERT ON billing_operations
 FOR EACH ROW EXECUTE FUNCTION lock_commercial_offering_use();
CREATE TRIGGER promotion_reservation_offering_use BEFORE INSERT ON promotion_redemption_reservations
 FOR EACH ROW EXECUTE FUNCTION lock_commercial_offering_use();

-- Encryption AAD is guild-scoped. Scale provisioning has not shipped.
CREATE UNIQUE INDEX billing_subscription_single_guild ON billing_subscription_assignments(subscription_id);
-- Historical ciphertext is never opened under a guessed guild or rewritten.
ALTER TABLE billing_provider_customers ADD COLUMN reference_guild_id text;
ALTER TABLE billing_subscriptions ADD COLUMN offering_id uuid REFERENCES billing_offerings(id);
CREATE FUNCTION guard_subscription_offering_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.offering_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM billing_offerings WHERE id=NEW.offering_id AND commercial_locked
 ) THEN RAISE EXCEPTION 'BILLING_OFFERING_NOT_COMMERCIAL'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_subscription_offering_use BEFORE INSERT OR UPDATE OF offering_id ON billing_subscriptions
 FOR EACH ROW EXECUTE FUNCTION guard_subscription_offering_use();
