-- Additive alpha.10. A lease claim is not an external mutation.
ALTER TABLE billing_operations ADD COLUMN external_phase text;
UPDATE billing_operations SET external_phase='LEGACY_UNKNOWN' WHERE external_started_at IS NOT NULL;
CREATE TABLE billing_operation_external_steps (
 operation_id uuid NOT NULL REFERENCES billing_operations(id) ON DELETE CASCADE,
 phase text NOT NULL, lease_token uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 PRIMARY KEY(operation_id,phase)
);

ALTER TABLE billing_authorizations ADD COLUMN account_id uuid REFERENCES billing_accounts(id);
ALTER TABLE billing_authorizations ADD COLUMN authority_state text NOT NULL DEFAULT 'ACTIVE'
 CHECK(authority_state IN ('PROVISIONAL','ACTIVE','RELEASED'));
UPDATE billing_authorizations a SET account_id=b.id FROM billing_accounts b WHERE b.organization_id=a.organization_id;
UPDATE billing_authorizations a SET authority_state='PROVISIONAL'
 WHERE checkout_operation_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM billing_operations o WHERE o.id=a.checkout_operation_id AND o.checkout_completed_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.organization_id=a.organization_id);
CREATE TABLE billing_authorization_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id), account_id uuid REFERENCES billing_accounts(id),
 actor_hash text, role text NOT NULL, authority_state text NOT NULL,
 checkout_operation_id uuid, revoked_at timestamptz, recorded_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_authorization_history(organization_id,account_id,actor_hash,role,authority_state,checkout_operation_id,revoked_at)
 SELECT organization_id,account_id,actor_hash,role,authority_state,checkout_operation_id,revoked_at FROM billing_authorizations;
CREATE FUNCTION retain_billing_authority_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO billing_authorization_history(organization_id,account_id,actor_hash,role,authority_state,checkout_operation_id,revoked_at)
 VALUES(NEW.organization_id,NEW.account_id,NEW.actor_hash,NEW.role,NEW.authority_state,NEW.checkout_operation_id,NEW.revoked_at);
 RETURN NEW;
END $$;
CREATE TRIGGER billing_authority_history AFTER INSERT OR UPDATE ON billing_authorizations
 FOR EACH ROW EXECUTE FUNCTION retain_billing_authority_history();

-- A fresh principal gets a fresh Customer. Archived bindings cannot be reused or transferred.
ALTER TABLE billing_provider_customers ADD COLUMN archived_at timestamptz;
ALTER TABLE billing_provider_customers DROP CONSTRAINT billing_provider_customers_account_id_provider_key;
CREATE UNIQUE INDEX billing_current_customer ON billing_provider_customers(account_id,provider) WHERE archived_at IS NULL;
