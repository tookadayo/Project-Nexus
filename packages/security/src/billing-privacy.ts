import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { IdentityVault } from "../../identity/src/index";
// Caller holds the existing exclusive privacy fence. No billing grace can postpone this.
export async function deleteBillingCommunity(tx: Tx, s: Scope) {
  for (const table of [
    "billing_provider_events",
    "promotion_redemptions",
    "promotion_attempt_limits",
    "billing_rule_states",
    "billing_reconcile_jobs",
    "billing_usage_monthly",
    "billing_guild_state",
    "entitlement_grants",
    "billing_subscription_assignments",
  ])
    await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(tx);
  await sql`UPDATE promotion_codes SET revoked_at=COALESCE(revoked_at,now()),target_guild_id=NULL WHERE target_guild_id=${s.guildId}`.execute(
    tx,
  );
  await sql`UPDATE promotion_campaigns SET revoked_at=COALESCE(revoked_at,now()),target_guild_id=NULL WHERE target_guild_id=${s.guildId}`.execute(
    tx,
  );
  // Provider identifiers remain encrypted only for still assigned financial allocations.
  await sql`DELETE FROM billing_subscriptions b WHERE b.organization_id=${s.organizationId}::uuid AND NOT EXISTS(SELECT 1 FROM billing_subscription_assignments a WHERE a.subscription_id=b.id)`.execute(
    tx,
  );
  await sql`DELETE FROM billing_provider_customers c USING billing_accounts a WHERE a.id=c.account_id AND a.organization_id=${s.organizationId}::uuid AND NOT EXISTS(SELECT 1 FROM billing_subscriptions b WHERE b.account_id=a.id)`.execute(
    tx,
  );
  await sql`DELETE FROM billing_authorizations WHERE organization_id=${s.organizationId}::uuid AND NOT EXISTS(SELECT 1 FROM billing_subscription_assignments a WHERE a.organization_id=${s.organizationId}::uuid)`.execute(
    tx,
  );
  await sql`UPDATE billing_accounts SET deleted_at=now() WHERE organization_id=${s.organizationId}::uuid AND NOT EXISTS(SELECT 1 FROM billing_subscriptions b WHERE b.account_id=billing_accounts.id)`.execute(
    tx,
  );
  await sql`UPDATE billing_audit_log SET guild_id=NULL,actor_hash=NULL,metadata=metadata-'reason' WHERE ${tenant(s)}`.execute(
    tx,
  );
}
export async function deleteBillingActor(
  tx: Tx,
  s: Scope,
  userId: string,
  vault: IdentityVault,
) {
  const hash = vault.hash(s, userId),
    org = vault.digest("billing-org-actor", s.organizationId + ":" + userId),
    internal = vault.digest("billing-internal-actor", userId);
  await sql`UPDATE promotion_redemptions SET actor_hash=NULL WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
    tx,
  );
  await sql`DELETE FROM promotion_attempt_limits WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
    tx,
  );
  await sql`DELETE FROM billing_authorizations WHERE organization_id=${s.organizationId}::uuid AND actor_hash=${org}`.execute(
    tx,
  );
  await sql`UPDATE entitlement_grants SET created_by=NULL WHERE organization_id=${s.organizationId}::uuid AND created_by=ANY(${[hash, org, internal]}::text[])`.execute(
    tx,
  );
  await sql`UPDATE billing_audit_log SET actor_hash=NULL,metadata=metadata-'reason' WHERE organization_id=${s.organizationId}::uuid AND actor_hash=ANY(${[hash, org, internal]}::text[])`.execute(
    tx,
  );
}
