import { PermissionFlagsBits } from "discord-api-types/v10";
import { sql, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { IdentityVault } from "../../identity/src/index";
import {
  ServerAuthorization,
  type GuildAuthorizationSnapshot,
} from "./server-authorization";
export type BillingAction =
  | "VIEW"
  | "CHECKOUT"
  | "CHANGE"
  | "PORTAL"
  | "UPGRADE"
  | "DOWNGRADE"
  | "CANCEL"
  | "REDEEM"
  | "ASSIGN_GUILD";
export class BillingAuthorization {
  constructor(
    private readonly authority: ServerAuthorization,
    private readonly db: Tx,
    private readonly vault: IdentityVault,
  ) {}
  async authorize(
    scope: Scope,
    userId: string,
    action: BillingAction,
    source: "WEB_DASHBOARD" | "DISCORD_PANEL",
    requestId: string,
  ) {
    const snapshot = await this.authority.snapshot(
      scope,
      userId,
      source,
      requestId,
    );
    await this.require(snapshot, action);
    return snapshot;
  }
  async require(snapshot: GuildAuthorizationSnapshot, action: BillingAction) {
    // Always requires a current member and current settings; org role never bypasses installation.
    assert(
      Date.now() - snapshot.checkedAt >= 0 &&
        Date.now() - snapshot.checkedAt <= 10000,
      "AUTHORIZATION_EXPIRED",
      403,
    );
    const owner = snapshot.member.ownerId === snapshot.userId;
    const admin =
      (BigInt(snapshot.member.permissions) &
        (PermissionFlagsBits.ManageGuild |
          PermissionFlagsBits.Administrator)) !==
      0n;
    const roles = (
      await sql<{
        role: string;
      }>`SELECT role FROM billing_authorizations WHERE organization_id=${snapshot.scope.organizationId}::uuid AND actor_hash=${this.principalHash(snapshot.scope, snapshot.userId)} AND revoked_at IS NULL`.execute(
        this.db,
      )
    ).rows;
    const principal = roles.some(
      (row) => row.role === "PRIMARY_BILLING_PRINCIPAL",
    );
    const orgManager = roles.some((row) => row.role === "BILLING_MANAGER");
    if (action === "CHECKOUT") this.authority.requireOwner(snapshot);
    else if (action === "ASSIGN_GUILD")
      assert(orgManager, "ORGANIZATION_BILLING_MANAGER_REQUIRED", 403);
    else if (action === "PORTAL")
      assert(principal, "BILLING_PRINCIPAL_REQUIRED", 403);
    else if (["CHANGE", "UPGRADE", "DOWNGRADE", "CANCEL"].includes(action))
      assert(principal || orgManager, "BILLING_PRINCIPAL_REQUIRED", 403);
    else if (action === "REDEEM")
      assert(
        owner || principal || orgManager,
        "BILLING_AUTHORIZATION_REQUIRED",
        403,
      );
    else if (!owner && !admin && !principal && !orgManager)
      this.authority.require(snapshot);
    assert(
      Date.now() - snapshot.checkedAt <= 10000,
      "AUTHORIZATION_EXPIRED",
      403,
    );
    return snapshot.actor;
  }
  principalHash(scope: Scope, userId: string) {
    return this.vault.digest(
      "billing-org-actor",
      scope.organizationId + ":" + userId,
    );
  }
  async ownership(scope: Scope, currentOwnerId: string | undefined) {
    const row = (
      await sql<{
        actor_hash: string;
      }>`SELECT actor_hash FROM billing_authorizations WHERE organization_id=${scope.organizationId}::uuid AND role='PRIMARY_BILLING_PRINCIPAL' AND revoked_at IS NULL`.execute(
        this.db,
      )
    ).rows[0];
    return !row
      ? ("UNCLAIMED" as const)
      : !currentOwnerId
        ? ("UNKNOWN" as const)
        : row.actor_hash === this.principalHash(scope, currentOwnerId)
          ? ("ALIGNED" as const)
          : ("BILLING_OWNERSHIP_REVIEW" as const);
  }
}
export type InternalBillingActor = {
  hash: string;
  internal: true;
  reason: string;
};
export function internalBillingActor(
  userId: string,
  vault: IdentityVault,
  reason: string,
  env: Record<string, string | undefined> = process.env,
): InternalBillingActor {
  const configured = (env.NEXUS_INTERNAL_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  assert(
    /^\d{17,20}$/.test(userId) && configured.includes(userId),
    "NEXUS_INTERNAL_ADMIN_REQUIRED",
    403,
  );
  assert(
    reason.trim().length >= 8 && reason.length <= 500,
    "BILLING_REASON_REQUIRED",
  );
  return {
    hash: vault.digest("billing-internal-actor", userId),
    internal: true,
    reason: reason.trim(),
  };
}
