-- Runtime IDs are discovered by catalog sync; no provider IDs are migration data.
ALTER TABLE billing_operations ADD COLUMN checkout_expires_at timestamptz;
ALTER TABLE billing_operations ADD COLUMN checkout_completed_at timestamptz;
ALTER TABLE billing_operations ADD COLUMN promotion_reservation_id uuid REFERENCES promotion_redemption_reservations(id) ON DELETE SET NULL;
ALTER TABLE billing_operations ADD COLUMN current_offering_id uuid REFERENCES billing_offerings(id);
ALTER TABLE billing_operations ADD COLUMN promotion_context_ciphertext text;
CREATE INDEX billing_open_checkout ON billing_operations(organization_id,guild_id,checkout_expires_at)
 WHERE operation='CHECKOUT' AND state='FINALIZED' AND checkout_completed_at IS NULL;
-- Keep one customer per Billing Account and one account per provider Customer.
CREATE UNIQUE INDEX billing_customer_single_account ON billing_provider_customers(provider,reference_digest);
