import {betaAccess} from '../../security/src/hosted-beta';
import { randomUUID } from "node:crypto";
import { sql, privacyReadLock, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { SettingsService, type Actor } from "../../settings/src/index";
import {
  EntitlementService,
  type Feature,
} from "../../settings/src/billing/entitlements";
import { canOperatePanel, canAdmin } from "../../security/src/index";
export const nexusRoles = [
  "OWNER",
  "ADMIN",
  "OPERATOR",
  "ANALYST",
  "VIEWER",
] as const;
export type NexusRole = (typeof nexusRoles)[number];
export type OperationPermission =
  "READ" | "ANALYZE" | "OPERATE" | "CONFIGURE" | "GOVERN";
const permissions: Record<NexusRole, readonly OperationPermission[]> = {
  OWNER: ["READ", "ANALYZE", "OPERATE", "CONFIGURE", "GOVERN"],
  ADMIN: ["READ", "ANALYZE", "OPERATE", "CONFIGURE", "GOVERN"],
  OPERATOR: ["READ", "OPERATE"],
  ANALYST: ["READ", "ANALYZE"],
  VIEWER: ["READ"],
};
export function rolePermissions(
  role: NexusRole | null,
): readonly OperationPermission[] {
  return role ? permissions[role] : permissions.ADMIN;
}
async function revokedMembership(tx: Tx, s: Scope, actor: Actor) {
  if (
    (
      await sql`SELECT b.member_id FROM operations_role_bindings b JOIN operations_org_members m ON m.organization_id=b.root_organization_id AND m.id=b.member_id WHERE b.organization_id=${s.organizationId}::uuid AND b.guild_id=${s.guildId} AND b.actor_hash=${actor.key} AND m.state<>'ACTIVE'`.execute(
        tx,
      )
    ).rows.length
  )
    return true;
  // Also covers historical revoked members who never had a guild binding.
  // The digest function comes exclusively from live ServerAuthorization.
  if (!actor.organizationMemberDigest) return false;
  const roots = (
    await sql<{
      root_organization_id: string;
    }>`SELECT root_organization_id FROM operations_org_guilds WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(
      tx,
    )
  ).rows;
  for (const root of roots)
    if (
      (
        await sql`SELECT id FROM operations_org_members WHERE organization_id=${root.root_organization_id}::uuid AND user_digest=${actor.organizationMemberDigest(root.root_organization_id)} AND state='REVOKED'`.execute(
          tx,
        )
      ).rows.length
    )
      return true;
  return false;
}
export async function actorPermissions(
  tx: Tx,
  s: Scope,
  actor: Actor,
): Promise<readonly OperationPermission[]> {
  if (await revokedMembership(tx, s, actor)) return [];
  const role = await nexusRole(tx, s, actor.key);
  if (role) return permissions[role];
  const cfg = await new SettingsService(tx).get(s);
  if (
    (actor.source === "DISCORD_PANEL" ? canOperatePanel : canAdmin)(
      actor.permissions,
      actor.roles,
      [cfg.adminRoleId, ...cfg.managerRoleIds],
    )
  )
    return permissions.ADMIN;
  return actor.roles.some((role) =>
    [...cfg.staffRoleIds, ...cfg.helperRoleIds].includes(role),
  )
    ? ["READ"]
    : [];
}
export async function nexusRole(
  tx: Tx,
  s: Scope,
  actorHash: string,
): Promise<NexusRole | null> {
  return (
    (
      await sql<{
        role: NexusRole;
      }>`SELECT m.role FROM operations_role_bindings b JOIN operations_org_members m ON m.organization_id=b.root_organization_id AND m.id=b.member_id JOIN operations_org_guilds g ON g.root_organization_id=b.root_organization_id AND g.organization_id=b.organization_id AND g.guild_id=b.guild_id WHERE b.organization_id=${s.organizationId}::uuid AND b.guild_id=${s.guildId} AND b.actor_hash=${actorHash} AND m.state='ACTIVE' AND g.state='ACTIVE'`.execute(
        tx,
      )
    ).rows[0]?.role ?? null
  );
}
export async function operationsAccess(
  tx: Tx,
  s: Scope,
  actor: Actor,
  permission: OperationPermission,
  feature?: Feature,
  lifecycle=false,
) {
  await privacyReadLock(tx, s);
  if(!lifecycle)await betaAccess(tx,s,permission==='READ'?'read':'work');
  const entitlements = new EntitlementService(tx),
    state = await entitlements.effective(s);
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  assert(!(await revokedMembership(tx, s, actor)), "NEXUS_ROLE_REQUIRED", 403);
  const allowed = await actorPermissions(tx, s, actor);
  assert(
    allowed.includes(permission),
    (await nexusRole(tx, s, actor.key))
      ? "NEXUS_ROLE_REQUIRED"
      : "ADMIN_REQUIRED",
    403,
  );
  if (feature) await entitlements.require(s, feature);
  return state;
}
export async function operationsLock(tx: Tx, s: Scope) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"operations:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
}
export async function operationsAudit(
  tx: Tx,
  s: Scope,
  actorHash: string,
  action: string,
  target: string,
  revision: number | null,
  result = "SUCCEEDED",
) {
  assert(
    /^[A-Z_.]{3,80}$/.test(action) &&
      target.length <= 180 &&
      actorHash.length <= 180,
    "INVALID_AUDIT",
  );
  await sql`INSERT INTO operations_audit_events(organization_id,guild_id,id,actor_hash,action,target,revision,result) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${actorHash},${action},${target},${revision},${result})`.execute(
    tx,
  );
}
export async function operationsEvent(
  tx: Tx,
  s: Scope,
  type: string,
  key: string,
  data: Record<string, unknown>,
) {
  return (
    await sql<{
      id: string;
    }>`INSERT INTO operations_domain_events(organization_id,guild_id,event_type,dedupe_key,data) VALUES(${s.organizationId}::uuid,${s.guildId},${type},${key},${JSON.stringify(data)}::jsonb) ON CONFLICT(organization_id,guild_id,dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id`.execute(
      tx,
    )
  ).rows[0]!.id;
}
