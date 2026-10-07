-- Additive alpha.9 financial authority. Historical contracts require explicit
-- review; current Discord ownership must never claim a previous customer's data.
ALTER TABLE billing_authorizations DROP CONSTRAINT billing_authorizations_role_check;
ALTER TABLE billing_authorizations ADD CONSTRAINT billing_authorizations_role_check
 CHECK(role IN ('BILLING_MANAGER','PRIMARY_BILLING_PRINCIPAL'));
ALTER TABLE billing_operations ADD COLUMN principal_actor_hash text;
ALTER TABLE billing_operations ADD COLUMN checkout_ui text NOT NULL DEFAULT 'HOSTED'
 CHECK(checkout_ui IN ('HOSTED','ELEMENTS'));
ALTER TABLE billing_authorizations ADD COLUMN checkout_operation_id uuid REFERENCES billing_operations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX billing_primary_principal ON billing_authorizations(organization_id)
 WHERE role='PRIMARY_BILLING_PRINCIPAL' AND revoked_at IS NULL;
ALTER TABLE billing_operations ADD COLUMN checkout_abandoned_at timestamptz;
ALTER TABLE billing_operations ADD COLUMN abandon_started_at timestamptz;
