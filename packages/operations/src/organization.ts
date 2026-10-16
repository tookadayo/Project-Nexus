import { z } from "zod";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { SettingsService, type Actor } from "../../settings/src/index";
import type { IdentityVault } from "../../identity/src/index";
import type { ServerAuthorization } from "../../security/src/server-authorization";
import type { DiscordPort } from "../../discord/src/rest";
import { isDiscordFailure } from "../../discord/src/rest";
import { scopeForGuild } from "../../security/src/scoping";
import { betaAccess } from "../../security/src/hosted-beta";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { integrationHealth } from "../../lifecycle/src/observation";
import { latestCapability } from "../../lifecycle/src/discovery";
import { ExploreService } from "../../analytics/src/explore";
import { bindRevokedMembers } from "./membership-tombstones";
import type { ChartSpec } from "../../analytics/src/chart-spec";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { minimalOperationAudit } from "./alpha16-audit";
import { assertMaintenanceAuthorization, type MaintenanceAuthorizationProof } from "./maintenance-authorization";
export const teamUpdateInput = z.object({ id: z.uuid(), revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(80), memberIds: z.array(z.uuid()).min(1).max(50) }).strict();
export const teamDeleteInput = z.object({ id: z.uuid(), revision: z.number().int().positive() }).strict();
export type OrganizationMaintenanceProfile = { scopeVerified: boolean; allowClose: boolean; allowUnlink: boolean };
export const organizationRenameInput = z.object({ revision: z.number().int().positive(), name: z.string().trim().min(1).max(80) }).strict();
export const organizationCloseInput = z.object({ revision: z.number().int().positive() }).strict();
export const organizationUnlinkInput = z.object({ guildId: z.string().regex(/^\d{17,20}$/), revision: z.number().int().positive() }).strict();
export function organizationMaintenanceReadiness(profile?: OrganizationMaintenanceProfile) {
  const closeBlockers = !profile?.scopeVerified ? ["ORGANIZATION_MAINTENANCE_SCOPE_UNVERIFIED"] : [];
  const unlinkBlockers = [...closeBlockers];
  if (!profile?.scopeVerified) unlinkBlockers.push("ORGANIZATION_DETACH_WRITER_COVERAGE_UNVERIFIED");
  if (!profile?.allowClose) closeBlockers.push("ORGANIZATION_CLOSE_DISABLED");
  if (!profile?.allowUnlink) unlinkBlockers.push("ORGANIZATION_UNLINK_DISABLED");
  return { rename: { enabled: true, blockers: [] as string[] }, close: { enabled: closeBlockers.length === 0, blockers: closeBlockers },
    unlink: { enabled: unlinkBlockers.length === 0, blockers: unlinkBlockers },
    relink: { enabled: unlinkBlockers.length === 0, blockers: [...unlinkBlockers] } };
}
async function organizationScopeHasSavedState(tx: Tx, s: Scope) {
  // Closing membership is not a data-erasure operation. Refuse to make retained
  // definitions, permissions, approvals or uncertain effects unreachable. This
  // conservative inventory is also protected by the explicit coverage gate.
  return (await sql`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM automation_flows WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM automation_runs WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM analysis_runs WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM analysis_grants WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM guild_config_revisions WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM flow_versions WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM event_operation_templates WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM rule_config_versions WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM rule_runtime_intents WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM rule_target_safety WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM rule_suggestions WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM rule_case_contexts WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM automation_template_definitions WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM personal_preferences WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM attention_items WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM operations_interventions WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM playbooks WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM report_templates WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM report_schedules WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM report_runs WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM integration_destinations WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM api_credentials WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM webhook_endpoints WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM webhook_deliveries WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM operations_intake_panels WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM operations_requests WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM saved_metric_views WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM operational_segments WHERE ${tenant(s)})
    OR EXISTS(SELECT 1 FROM action_outbox WHERE ${tenant(s)}) OR EXISTS(SELECT 1 FROM alpha16_privacy_jobs WHERE ${tenant(s)})`.execute(tx)).rows.length > 0;
}
async function teamHasReferences(tx: Tx, rootId: string, teamId: string) {
  return (await sql`SELECT 1 FROM operations_team_bindings b WHERE b.root_organization_id=${rootId}::uuid AND b.team_id=${teamId}::uuid AND (
    EXISTS(SELECT 1 FROM attention_items a WHERE a.organization_id=b.organization_id AND a.guild_id=b.guild_id AND a.assigned_team_id=b.team_id)
    OR EXISTS(SELECT 1 FROM operations_interventions i WHERE i.organization_id=b.organization_id AND i.guild_id=b.guild_id AND i.assigned_team_id=b.team_id)
    OR EXISTS(SELECT 1 FROM integration_destinations d WHERE d.organization_id=b.organization_id AND d.guild_id=b.guild_id AND d.team_id=b.team_id)
    OR EXISTS(SELECT 1 FROM playbooks p WHERE p.organization_id=b.organization_id AND p.guild_id=b.guild_id AND p.review_team_id=b.team_id)
  ) LIMIT 1`.execute(tx)).rows.length > 0;
}
type OrganizationSummary = {
  guildId: string;
  state: string;
  coverage:
    | NonNullable<Awaited<ReturnType<typeof latestCapability>>>["coverage"]
    | null;
  openAttention: number | null;
  change: ChartSpec["comparison"] | null;
  health: Awaited<ReturnType<typeof integrationHealth>> | null;
  current?: ChartSpec["evidence"];
};
import {
  nexusRoles,
  operationsAccess,
  operationsAudit,
  nexusRole,
  type NexusRole,
} from "./policy";
export async function organizationBinding(tx: Tx, s: Scope) {
  return (
    (
      await sql<{
        id: string;
        name: string;
        home_guild_id: string;
        revision: number;
      }>`SELECT o.id,o.name,o.home_guild_id,o.revision FROM operations_org_guilds g JOIN operations_organizations o ON o.id=g.root_organization_id WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.state='ACTIVE'`.execute(
        tx,
      )
    ).rows[0] ?? null
  );
}
export class OperationsOrganization {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly discord: DiscordPort,
    private readonly authority: ServerAuthorization,
    private readonly options: { authorization?: MaintenanceAuthorizationProof; maintenance?: OrganizationMaintenanceProfile } = {},
  ) {}
  maintenanceReadiness() { return organizationMaintenanceReadiness(this.options.maintenance); }
  async renameOrganization(s: Scope, actor: Actor, input: unknown) {
    const data = organizationRenameInput.parse(input);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      const group = await organizationBinding(tx, s); assert(group, "ORGANIZATION_REQUIRED", 409);
      await organizationLock(tx, group.id);
      const row = (await sql<{ revision: number }>`SELECT revision FROM operations_organizations WHERE id=${group.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row && row.revision === data.revision, "REVISION_CONFLICT", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      assert(["OWNER", "ADMIN"].includes((await nexusRole(tx, s, actor.key)) ?? ""), "NEXUS_ROLE_REQUIRED", 403);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`UPDATE operations_organizations SET name=${data.name},revision=revision+1 WHERE id=${group.id}::uuid AND revision=${data.revision}`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "ORGANIZATION_RENAMED", group.id, data.revision + 1);
      return { id: group.id, revision: data.revision + 1 };
    });
  }
  async closeOrganization(s: Scope, actor: Actor, input: unknown) {
    const data = organizationCloseInput.parse(input);
    assert(this.maintenanceReadiness().close.enabled, "ORGANIZATION_CLOSE_SCOPE_UNVERIFIED", 503);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      const group = await organizationBinding(tx, s); assert(group, "ORGANIZATION_REQUIRED", 409);
      assert(group.id === s.organizationId && group.home_guild_id === s.guildId, "ORGANIZATION_HOME_REQUIRED", 409);
      await organizationLock(tx, group.id);
      const row = (await sql<{ revision: number }>`SELECT revision FROM operations_organizations WHERE id=${group.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row && row.revision === data.revision, "REVISION_CONFLICT", 409);
      assert(!(await sql`SELECT 1 FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND (organization_id<>${s.organizationId}::uuid OR guild_id<>${s.guildId}) LIMIT 1`.execute(tx)).rows.length, "ORGANIZATION_LINKS_REMAIN", 409);
      const members = (await sql<{ id: string; state: string; role: string }>`SELECT id,state,role FROM operations_org_members WHERE organization_id=${group.id}::uuid FOR UPDATE`.execute(tx)).rows;
      const own = (await sql<{ member_id: string }>`SELECT member_id FROM operations_role_bindings WHERE ${tenant(s)} AND actor_hash=${actor.key} AND root_organization_id=${group.id}::uuid`.execute(tx)).rows[0];
      // Revoked bindings are authorization tombstones. No closure may erase
      // those tombstones or make another member fall back to Discord admin.
      assert(members.length === 1 && members[0]!.id === own?.member_id && members[0]!.state === "ACTIVE" && members[0]!.role === "OWNER", "ORGANIZATION_MEMBERS_REMAIN", 409);
      assert(!(await sql`SELECT 1 FROM operations_teams WHERE organization_id=${group.id}::uuid LIMIT 1`.execute(tx)).rows.length, "ORGANIZATION_TEAMS_REMAIN", 409);
      assert(!(await organizationScopeHasSavedState(tx, s)), "ORGANIZATION_SAVED_STATE_REMAINS", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      assert((await nexusRole(tx, s, actor.key)) === "OWNER", "OWNER_REQUIRED", 403);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`DELETE FROM operations_organizations WHERE id=${group.id}::uuid AND revision=${data.revision}`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "ORGANIZATION_CLOSED", group.id, data.revision + 1);
      return { id: group.id, closed: true as const };
    });
  }
  async unlinkGuild(s: Scope, actor: Actor, userId: string, input: unknown) {
    const data = organizationUnlinkInput.parse(input);
    assert(this.maintenanceReadiness().unlink.enabled, "ORGANIZATION_UNLINK_SCOPE_UNVERIFIED", 503);
    assert(actor.key === this.vault.hash(s, userId), "ACTOR_MISMATCH", 403);
    const target = scopeForGuild(data.guildId);
    const targetSnapshot = await this.authority.snapshot(target, userId, actor.source, actor.requestId);
    this.authority.require(targetSnapshot);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, [...ruleScopeLockSet(s), ...ruleScopeLockSet(target)]);
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      await operationsAccess(tx, target, targetSnapshot.actor, "GOVERN");
      const group = await organizationBinding(tx, s); assert(group, "ORGANIZATION_REQUIRED", 409);
      assert(data.guildId !== group.home_guild_id, "ORGANIZATION_HOME_UNLINK_FORBIDDEN", 409);
      await organizationLock(tx, group.id);
      const link = (await sql<{ revision: number; state: string }>`SELECT revision,state FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND organization_id=${target.organizationId}::uuid AND guild_id=${target.guildId} FOR UPDATE`.execute(tx)).rows[0];
      assert(link, "ORGANIZATION_GUILD_NOT_FOUND", 404); assert(link.revision === data.revision, "REVISION_CONFLICT", 409);
      assert(link.state !== "DETACHED", "ORGANIZATION_ALREADY_DETACHED", 409);
      assert(!(await organizationScopeHasSavedState(tx, target)), "ORGANIZATION_SAVED_STATE_REMAINS", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      this.authority.require(targetSnapshot);
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      await operationsAccess(tx, target, targetSnapshot.actor, "GOVERN");
      assert(["OWNER", "ADMIN"].includes((await nexusRole(tx, s, actor.key)) ?? ""), "NEXUS_ROLE_REQUIRED", 403);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      this.authority.require(targetSnapshot);
      // Keep membership and role bindings as the existing denial authority.
      // Removing a foreign key root would revive Discord-admin fallback.
      await sql`UPDATE operations_org_guilds SET state='DETACHED',revision=revision+1 WHERE root_organization_id=${group.id}::uuid AND organization_id=${target.organizationId}::uuid AND guild_id=${target.guildId} AND revision=${data.revision}`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "ORGANIZATION_GUILD_UNLINKED", target.guildId, data.revision + 1);
      return { guildId: target.guildId, unlinked: true as const, state: "DETACHED" as const, revision: data.revision + 1, authorizationBindingsPreserved: true as const };
    });
  }
  async relinkGuild(s: Scope, actor: Actor, userId: string, input: unknown) {
    const data = organizationUnlinkInput.parse(input);
    assert(this.maintenanceReadiness().relink.enabled, "ORGANIZATION_REATTACH_SCOPE_UNVERIFIED", 503);
    assert(actor.key === this.vault.hash(s, userId), "ACTOR_MISMATCH", 403);
    const group = await this.db.transaction().execute(async tx => {
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      assert(["OWNER", "ADMIN"].includes((await nexusRole(tx, s, actor.key)) ?? ""), "NEXUS_ROLE_REQUIRED", 403);
      const current = await organizationBinding(tx, s); assert(current, "ORGANIZATION_REQUIRED", 409); return current;
    });
    assert(data.guildId !== group.home_guild_id, "ORGANIZATION_HOME_UNLINK_FORBIDDEN", 409);
    const target = scopeForGuild(data.guildId), home = { organizationId: group.id, guildId: group.home_guild_id };
    // A detached delegate has no implicit target authority. Reattachment uses
    // explicit current Discord administration plus the current source owner/
    // admin, never the stopped binding as a substitute for target consent.
    const snapshot = await this.authority.snapshot(target, userId, actor.source, actor.requestId);
    this.authority.require(snapshot); assert(!snapshot.member.bot, "ADMIN_REQUIRED", 403);
    const members = (await sql<{ id: string; revision: number; user_ciphertext: string }>`SELECT id,revision,user_ciphertext FROM operations_org_members WHERE organization_id=${group.id}::uuid AND state='ACTIVE' ORDER BY id`.execute(this.db)).rows;
    const observed: { memberId: string; hash: string }[] = [], checkedAt: number[] = [];
    for (const member of members) {
      try {
        const memberUserId = this.vault.open(home, member.user_ciphertext), current = await this.discord.member(target.guildId, memberUserId);
        const at = Date.now(); checkedAt.push(at);
        if (!current.bot) observed.push({ memberId: member.id, hash: this.vault.hash(target, memberUserId) });
      } catch (error) {
        if (!isDiscordFailure(error) || error.status !== 404) throw error;
        checkedAt.push(Date.now());
      }
    }
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, [...ruleScopeLockSet(s), ...ruleScopeLockSet(target)]);
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      await privacyReadLock(tx, target); await betaAccess(tx, target, "work");
      await organizationLock(tx, group.id);
      assert((await organizationBinding(tx, s))?.id === group.id, "ORGANIZATION_REQUIRED", 409);
      const link = (await sql<{ state: string; revision: number }>`SELECT state,revision FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND organization_id=${target.organizationId}::uuid AND guild_id=${target.guildId} FOR UPDATE`.execute(tx)).rows[0];
      assert(link, "ORGANIZATION_GUILD_NOT_FOUND", 404); assert(link.revision === data.revision, "REVISION_CONFLICT", 409);
      assert(link.state === "DETACHED", "ORGANIZATION_NOT_DETACHED", 409);
      const currentMembers = (await sql<{ id: string; revision: number }>`SELECT id,revision FROM operations_org_members WHERE organization_id=${group.id}::uuid AND state='ACTIVE' ORDER BY id FOR SHARE`.execute(tx)).rows;
      assert(JSON.stringify(currentMembers) === JSON.stringify(members.map(member => ({ id: member.id, revision: member.revision }))), "ORGANIZATION_MEMBERS_CHANGED", 409);
      assert(!(await organizationScopeHasSavedState(tx, target)), "ORGANIZATION_SAVED_STATE_REMAINS", 409);
      const entitlements = new EntitlementService(tx), entitled = await entitlements.effective(home);
      assert(entitled.features.includes("multi_guild") && !entitled.privacyDeleted, "PLAN_REQUIRED", 403);
      assert(!(await entitlements.effective(target)).privacyDeleted, "PRIVACY_DELETED", 403);
      const count = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND state='ACTIVE'`.execute(tx)).rows[0]!.n;
      assert(entitled.limits.guilds === null || count < entitled.limits.guilds, "BILLING_LIMIT_REACHED", 403);
      assert((await new SettingsService(tx).get(target)).revision === snapshot.settings.revision, "REVISION_CONFLICT", 409);
      assert(!(await sql`SELECT id FROM deletion_requests WHERE ${tenant(target)} AND (lookup_hash IS NULL OR lookup_hash=${snapshot.actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      assert(["OWNER", "ADMIN"].includes((await nexusRole(tx, s, actor.key)) ?? ""), "NEXUS_ROLE_REQUIRED", 403);
      assertMaintenanceAuthorization(this.options.authorization, s, actor); this.authority.require(snapshot);
      assert(checkedAt.every(at => Date.now() >= at && Date.now() - at <= 10000), "AUTHORIZATION_EXPIRED", 403);
      // Only active bindings are refreshed after real membership checks.
      // Revoked members and their denial roots stay intact throughout.
      await sql`DELETE FROM operations_role_bindings b USING operations_org_members m WHERE b.organization_id=${target.organizationId}::uuid AND b.guild_id=${target.guildId} AND b.root_organization_id=${group.id}::uuid AND m.organization_id=b.root_organization_id AND m.id=b.member_id AND m.state='ACTIVE'`.execute(tx);
      for (const member of observed)
        await sql`INSERT INTO operations_role_bindings(organization_id,guild_id,root_organization_id,member_id,actor_hash) SELECT ${target.organizationId}::uuid,${target.guildId},${group.id}::uuid,${member.memberId}::uuid,${member.hash} WHERE NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(target)} AND (lookup_hash IS NULL OR lookup_hash=${member.hash})) ON CONFLICT DO NOTHING`.execute(tx);
      await sql`INSERT INTO operations_team_bindings(organization_id,guild_id,team_id,root_organization_id) SELECT ${target.organizationId}::uuid,${target.guildId},id,organization_id FROM operations_teams WHERE organization_id=${group.id}::uuid ON CONFLICT DO NOTHING`.execute(tx);
      assertMaintenanceAuthorization(this.options.authorization, s, actor); this.authority.require(snapshot);
      assert(checkedAt.every(at => Date.now() >= at && Date.now() - at <= 10000), "AUTHORIZATION_EXPIRED", 403);
      await sql`UPDATE operations_org_guilds SET state='ACTIVE',revision=revision+1 WHERE root_organization_id=${group.id}::uuid AND organization_id=${target.organizationId}::uuid AND guild_id=${target.guildId} AND revision=${data.revision} AND state='DETACHED'`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "ORGANIZATION_GUILD_REATTACHED", target.guildId, data.revision + 1);
      return { guildId: target.guildId, state: "ACTIVE" as const, revision: data.revision + 1, reauthorized: true as const };
    });
  }
  async create(s: Scope, actor: Actor, userId: string, name: string) {
    z.string().trim().min(1).max(80).parse(name);
    assert(actor.key === this.vault.hash(s, userId), "ACTOR_MISMATCH", 403);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      await organizationLock(tx, s.organizationId);
      assert(
        !(await organizationBinding(tx, s)),
        "ORGANIZATION_ALREADY_CONFIGURED",
        409,
      );
      await sql`INSERT INTO operations_organizations(id,name,home_guild_id) VALUES(${s.organizationId}::uuid,${name},${s.guildId})`.execute(
        tx,
      );
      await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${s.organizationId}::uuid,${s.organizationId}::uuid,${s.guildId})`.execute(
        tx,
      );
      const member = (
        await sql<{
          id: string;
        }>`INSERT INTO operations_org_members(organization_id,user_digest,user_ciphertext,name,role) VALUES(${s.organizationId}::uuid,${this.vault.digest("operations-staff", s.organizationId + ":" + userId)},${this.vault.seal(s, userId)},'Owner','OWNER') RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await sql`INSERT INTO operations_role_bindings VALUES(${s.organizationId}::uuid,${s.guildId},${s.organizationId}::uuid,${member.id}::uuid,${actor.key})`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "ORGANIZATION_CREATED",
        s.organizationId,
        1,
      );
      return { id: s.organizationId };
    });
  }
  async link(
    s: Scope,
    actor: Actor,
    userId: string,
    guildId: string,
    review = false,
  ) {
    z.string()
      .regex(/^\d{17,20}$/)
      .parse(guildId);
    assert(actor.key === this.vault.hash(s, userId), "ACTOR_MISMATCH", 403);
    const target = scopeForGuild(guildId),
      snapshot = await this.authority.snapshot(
        target,
        userId,
        "WEB_DASHBOARD",
        "organization-link",
      );
    this.authority.require(snapshot);
    const group = await organizationBinding(this.db, s);
    assert(group, "ORGANIZATION_REQUIRED", 409);
    const home = { organizationId: group.id, guildId: group.home_guild_id },
      members = (
        await sql<{
          id: string;
          user_ciphertext: string;
        }>`SELECT id,user_ciphertext FROM operations_org_members WHERE organization_id=${group.id}::uuid AND state='ACTIVE'`.execute(
          this.db,
        )
      ).rows,
      bindings: { memberId: string; hash: string }[] = [];
    for (const member of members) {
      const ref = this.vault.open(home, member.user_ciphertext);
      try {
        const current = await this.discord.member(guildId, ref);
        if (!current.bot)
          bindings.push({
            memberId: member.id,
            hash: this.vault.hash(target, ref),
          });
      } catch (error) {
        if (!isDiscordFailure(error) || error.status !== 404) throw error;
      }
    }
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "GOVERN", "multi_guild");
      assert(
        ["OWNER", "ADMIN"].includes((await nexusRole(tx, s, actor.key)) ?? ""),
        "NEXUS_ROLE_REQUIRED",
        403,
      );
      await privacyReadLock(tx, target);
      await this.authority.revalidate(target, userId, snapshot, tx);
      await organizationLock(tx, group.id);
      const entitled = await new EntitlementService(tx).effective(home);
      assert(
        entitled.features.includes("multi_guild") && !entitled.privacyDeleted,
        "PLAN_REQUIRED",
        403,
      );
      const existing = (
        await sql<{
          root_organization_id: string;
          state: string;
        }>`SELECT root_organization_id,state FROM operations_org_guilds WHERE ${tenant(target)} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(existing?.state !== "DETACHED", "ORGANIZATION_REATTACH_REQUIRED", 409);
      assert(
        review
          ? existing?.root_organization_id === group.id &&
              existing.state === "REQUIRES_REVIEW"
          : !existing,
        "GUILD_ALREADY_LINKED",
        409,
      );
      const count = (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND state='ACTIVE'`.execute(
          tx,
        )
      ).rows[0]!.n;
      assert(
        entitled.limits.guilds === null || count < entitled.limits.guilds,
        "BILLING_LIMIT_REACHED",
        403,
      );
      assert(
        !(await new EntitlementService(tx).effective(target)).privacyDeleted,
        "PRIVACY_DELETED",
        403,
      );
      if (review) {
        await sql`UPDATE operations_org_guilds SET state='ACTIVE' WHERE ${tenant(target)}`.execute(
          tx,
        );
        // Revoked bindings are authorization tombstones. Removing them would
        // let a former NEXUS member fall back to Discord administrator authority.
        // Only active members' bindings are replaced after live verification.
        await sql`DELETE FROM operations_role_bindings b USING operations_org_members m WHERE b.organization_id=${target.organizationId}::uuid AND b.guild_id=${target.guildId} AND m.organization_id=b.root_organization_id AND m.id=b.member_id AND m.state='ACTIVE'`.execute(
          tx,
        );
      } else
        await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${group.id}::uuid,${target.organizationId}::uuid,${target.guildId})`.execute(
          tx,
        );
      for (const binding of bindings)
        await sql`INSERT INTO operations_role_bindings VALUES(${target.organizationId}::uuid,${target.guildId},${group.id}::uuid,${binding.memberId}::uuid,${binding.hash}) ON CONFLICT DO NOTHING`.execute(
          tx,
        );
      // Revocation during Discord preflight must also cover this newly linked guild.
      await bindRevokedMembers(tx, this.vault, group.id);
      await sql`INSERT INTO operations_team_bindings(organization_id,guild_id,team_id,root_organization_id) SELECT ${target.organizationId}::uuid,${target.guildId},id,organization_id FROM operations_teams WHERE organization_id=${group.id}::uuid ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "GUILD_LINKED",
        target.guildId,
        1,
      );
      return { guildId };
    });
  }
  async member(s: Scope, actor: Actor, input: unknown) {
    const data = z
        .object({
          userId: z.string().regex(/^\d{17,20}$/),
          name: z.string().trim().min(1).max(60),
          role: z.enum(nexusRoles),
          revision: z.number().int().positive().optional(),
        })
        .strict()
        .parse(input),
      group = await organizationBinding(this.db, s);
    assert(group, "ORGANIZATION_REQUIRED", 409);
    const home = { organizationId: group.id, guildId: group.home_guild_id },
      guilds = (
        await sql<{
          organization_id: string;
          guild_id: string;
        }>`SELECT organization_id,guild_id FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND state='ACTIVE'`.execute(
          this.db,
        )
      ).rows,
      bindings: { scope: Scope; hash: string }[] = [];
    for (const guild of guilds) {
      try {
        const member = await this.discord.member(guild.guild_id, data.userId);
        if (!member.bot)
          bindings.push({
            scope: {
              organizationId: guild.organization_id,
              guildId: guild.guild_id,
            },
            hash: this.vault.hash(
              {
                organizationId: guild.organization_id,
                guildId: guild.guild_id,
              },
              data.userId,
            ),
          });
      } catch (error) {
        if (!isDiscordFailure(error) || error.status !== 404) throw error;
      }
    }
    assert(bindings.length, "STAFF_NOT_A_GUILD_MEMBER", 403);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "GOVERN", "rbac");
      await organizationLock(tx, group.id);
      const ownRole = await nexusRole(tx, s, actor.key);
      assert(
        ownRole === "OWNER" || (ownRole === "ADMIN" && data.role !== "OWNER"),
        "OWNER_REQUIRED",
        403,
      );
      const digest = this.vault.digest(
          "operations-staff",
          group.id + ":" + data.userId,
        ),
        previous = (
          await sql<{
            id: string;
            role: NexusRole;
            revision: number;
            state: string;
          }>`SELECT id,role,revision,state FROM operations_org_members WHERE organization_id=${group.id}::uuid AND user_digest=${digest} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
      assert(
        !previous || data.revision === previous.revision,
        "REVISION_CONFLICT",
        409,
      );
      if (previous?.role === "OWNER" && data.role !== "OWNER") {
        const owners = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM operations_org_members WHERE organization_id=${group.id}::uuid AND role='OWNER' AND state='ACTIVE'`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(ownRole === "OWNER" && owners > 1, "LAST_OWNER_REQUIRED", 409);
      }
      if (!previous || previous.state !== "ACTIVE") {
        const count = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM operations_org_members WHERE organization_id=${group.id}::uuid AND state='ACTIVE'`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(
          (await new EntitlementService(tx).limit(home, "teamSeats", count))
            .allowed,
          "BILLING_LIMIT_REACHED",
          403,
        );
      }
      const row = (
        await sql<{
          id: string;
          revision: number;
        }>`INSERT INTO operations_org_members(organization_id,user_digest,user_ciphertext,name,role) VALUES(${group.id}::uuid,${digest},${this.vault.seal(home, data.userId)},${data.name},${data.role}) ON CONFLICT(organization_id,user_digest) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,state='ACTIVE',revision=operations_org_members.revision+1 RETURNING id,revision`.execute(
          tx,
        )
      ).rows[0]!;
      await sql`DELETE FROM operations_role_bindings b WHERE b.root_organization_id=${group.id}::uuid AND b.member_id=${row.id}::uuid AND NOT EXISTS(SELECT 1 FROM operations_org_guilds g WHERE g.root_organization_id=b.root_organization_id AND g.organization_id=b.organization_id AND g.guild_id=b.guild_id AND g.state='DETACHED')`.execute(
        tx,
      );
      for (const binding of bindings)
        await sql`INSERT INTO operations_role_bindings VALUES(${binding.scope.organizationId}::uuid,${binding.scope.guildId},${group.id}::uuid,${row.id}::uuid,${binding.hash})`.execute(
          tx,
        );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "TEAM_MEMBER_SAVED",
        row.id,
        row.revision,
      );
      return row;
    });
  }
  async revokeMember(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "GOVERN", "rbac");
      const group = await organizationBinding(tx, s);
      assert(group, "ORGANIZATION_REQUIRED", 409);
      await organizationLock(tx, group.id);
      const member = (
        await sql<{
          role: NexusRole;
        }>`SELECT role FROM operations_org_members WHERE organization_id=${group.id}::uuid AND id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(member, "TEAM_MEMBER_NOT_FOUND", 404);
      if (member.role === "OWNER") {
        assert(
          (await nexusRole(tx, s, actor.key)) === "OWNER",
          "OWNER_REQUIRED",
          403,
        );
        assert(
          (
            await sql<{
              n: number;
            }>`SELECT count(*)::int AS n FROM operations_org_members WHERE organization_id=${group.id}::uuid AND role='OWNER' AND state='ACTIVE'`.execute(
              tx,
            )
          ).rows[0]!.n > 1,
          "LAST_OWNER_REQUIRED",
          409,
        );
      }
      await sql`UPDATE operations_org_members SET state='REVOKED',revision=revision+1 WHERE organization_id=${group.id}::uuid AND id=${id}::uuid`.execute(
        tx,
      );
      await bindRevokedMembers(tx, this.vault, group.id);
      await sql`UPDATE api_credentials c SET state='REVOKED',revoked_at=now() FROM operations_role_bindings b WHERE b.root_organization_id=${group.id}::uuid AND b.member_id=${id}::uuid AND c.organization_id=b.organization_id AND c.guild_id=b.guild_id AND c.actor_hash=b.actor_hash`.execute(
        tx,
      );
      await operationsAudit(tx, s, actor.key, "TEAM_MEMBER_REVOKED", id, null);
    });
  }
  async team(s: Scope, actor: Actor, input: unknown) {
    const data = z
      .object({
        name: z.string().trim().min(1).max(80),
        memberIds: z.array(z.uuid()).min(1).max(50),
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "GOVERN", "team_assignment");
      const group = await organizationBinding(tx, s);
      assert(group, "ORGANIZATION_REQUIRED", 409);
      await organizationLock(tx, group.id);
      for (const id of data.memberIds)
        assert(
          (
            await sql`SELECT id FROM operations_org_members WHERE organization_id=${group.id}::uuid AND id=${id}::uuid AND state='ACTIVE'`.execute(
              tx,
            )
          ).rows.length,
          "TEAM_MEMBER_NOT_FOUND",
          404,
        );
      const team = (
        await sql<{
          id: string;
        }>`INSERT INTO operations_teams(organization_id,name) VALUES(${group.id}::uuid,${data.name}) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      for (const id of [...new Set(data.memberIds)])
        await sql`INSERT INTO operations_team_members VALUES(${group.id}::uuid,${team.id}::uuid,${id}::uuid)`.execute(
          tx,
        );
      await sql`INSERT INTO operations_team_bindings(organization_id,guild_id,team_id,root_organization_id) SELECT organization_id,guild_id,${team.id}::uuid,root_organization_id FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid AND state<>'DETACHED' ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      await operationsAudit(tx, s, actor.key, "TEAM_CREATED", team.id, 1);
      return { ...team, revision: 1 };
    });
  }
  async updateTeam(s: Scope, actor: Actor, input: unknown) {
    const data = teamUpdateInput.parse(input), members = [...new Set(data.memberIds)].sort();
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "GOVERN", "team_assignment");
      const group = await organizationBinding(tx, s);
      assert(group, "ORGANIZATION_REQUIRED", 409);
      await organizationLock(tx, group.id);
      const team = (await sql<{ revision: number }>`SELECT revision FROM operations_teams WHERE organization_id=${group.id}::uuid AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(team, "TEAM_NOT_FOUND", 404);
      assert(team.revision === data.revision, "REVISION_CONFLICT", 409);
      const currentMembers = (await sql<{ member_id: string }>`SELECT member_id FROM operations_team_members WHERE organization_id=${group.id}::uuid AND team_id=${data.id}::uuid ORDER BY member_id`.execute(tx)).rows.map(row => row.member_id);
      const membershipChanged = JSON.stringify(currentMembers) !== JSON.stringify(members);
      assert(!membershipChanged || !(await teamHasReferences(tx, group.id, data.id)), "TEAM_IN_USE", 409);
      for (const id of members)
        assert((await sql`SELECT id FROM operations_org_members WHERE organization_id=${group.id}::uuid AND id=${id}::uuid AND state='ACTIVE' FOR SHARE`.execute(tx)).rows.length, "TEAM_MEMBER_NOT_FOUND", 404);
      assert(!(await sql`SELECT id FROM operations_teams WHERE organization_id=${group.id}::uuid AND name=${data.name} AND id<>${data.id}::uuid`.execute(tx)).rows.length, "TEAM_NAME_CONFLICT", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "GOVERN", "team_assignment");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`UPDATE operations_teams SET name=${data.name},revision=revision+1 WHERE organization_id=${group.id}::uuid AND id=${data.id}::uuid AND revision=${data.revision}`.execute(tx);
      if (membershipChanged) {
        await sql`DELETE FROM operations_team_members WHERE organization_id=${group.id}::uuid AND team_id=${data.id}::uuid`.execute(tx);
        for (const id of members) await sql`INSERT INTO operations_team_members(organization_id,team_id,member_id) VALUES(${group.id}::uuid,${data.id}::uuid,${id}::uuid)`.execute(tx);
      }
      await minimalOperationAudit(tx, s, actor.key, "TEAM_UPDATED", data.id, data.revision + 1);
      return { id: data.id, revision: data.revision + 1 };
    });
  }
  async deleteTeam(s: Scope, actor: Actor, input: unknown) {
    const data = teamDeleteInput.parse(input);
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "GOVERN", "team_assignment");
      const group = await organizationBinding(tx, s);
      assert(group, "ORGANIZATION_REQUIRED", 409);
      await organizationLock(tx, group.id);
      const team = (await sql<{ revision: number }>`SELECT revision FROM operations_teams WHERE organization_id=${group.id}::uuid AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(team, "TEAM_NOT_FOUND", 404);
      assert(team.revision === data.revision, "REVISION_CONFLICT", 409);
      assert(!(await teamHasReferences(tx, group.id, data.id)), "TEAM_IN_USE", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "GOVERN", "team_assignment");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`DELETE FROM operations_teams WHERE organization_id=${group.id}::uuid AND id=${data.id}::uuid`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "TEAM_DELETED", data.id, data.revision + 1);
      return { id: data.id, deleted: true as const, revision: data.revision + 1 };
    }).catch(error => {
      // Deferred NO ACTION FKs also fence a reference added after the explicit
      // check. They must never clear approval/destination references for us.
      if (error && typeof error === "object" && "code" in error && error.code === "23503") assert(false, "TEAM_IN_USE", 409);
      throw error;
    });
  }
  async detail(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      const group = await organizationBinding(tx, s);
      if (!group || !(await nexusRole(tx, s, actor.key)))
        return { organization: null, members: [], teams: [], guilds: [], maintenance: this.maintenanceReadiness() };
      return {
        maintenance: this.maintenanceReadiness(),
        organization: group,
        members: (
          await sql`SELECT id,name,role,state,revision FROM operations_org_members WHERE organization_id=${group.id}::uuid ORDER BY name,id`.execute(
            tx,
          )
        ).rows,
        teams: (
          await sql`SELECT t.id,t.name,t.revision,ARRAY(SELECT m.member_id FROM operations_team_members m WHERE m.organization_id=t.organization_id AND m.team_id=t.id ORDER BY m.member_id) AS member_ids FROM operations_teams t WHERE t.organization_id=${group.id}::uuid ORDER BY t.name,t.id`.execute(
            tx,
          )
        ).rows,
        guilds: (
          await sql`SELECT organization_id,guild_id,state,revision FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid ORDER BY linked_at,guild_id`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
  async commandCenter(s: Scope, actor: Actor) {
    await this.db
      .transaction()
      .execute((tx) => operationsAccess(tx, s, actor, "READ", "multi_guild"));
    const group = await organizationBinding(this.db, s);
    assert(group, "ORGANIZATION_REQUIRED", 409);
    return organizationAggregate(this.db, group.id, s, async (tx) => {
      await operationsAccess(tx, s, actor, "READ", "multi_guild");
      assert(await nexusRole(tx, s, actor.key), "NEXUS_ROLE_REQUIRED", 403);
      assert(
        (await organizationBinding(tx, s))?.id === group.id,
        "ORGANIZATION_REQUIRED",
        409,
      );
    });
  }
}
export async function organizationLock(tx: Tx, id: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"operations-org:" + id},0))`.execute(
    tx,
  );
}
export async function organizationAggregate(
  db: Database,
  id: string,
  caller: Scope,
  fence: (tx: Tx) => Promise<void>,
) {
  const initialGroup = (
    await sql<{
      home_guild_id: string;
    }>`SELECT home_guild_id FROM operations_organizations WHERE id=${id}::uuid`.execute(
      db,
    )
  ).rows[0];
  assert(initialGroup, "ORGANIZATION_REQUIRED", 409);
  const home = { organizationId: id, guildId: initialGroup.home_guild_id };
  const links = (
      await sql<{
        organization_id: string;
        guild_id: string;
        state: string;
      }>`SELECT organization_id,guild_id,state FROM operations_org_guilds WHERE root_organization_id=${id}::uuid ORDER BY linked_at,guild_id LIMIT 100`.execute(
        db,
      )
    ).rows,
    results: OrganizationSummary[] = [];
  for (const link of links) {
    const scope = {
        organizationId: link.organization_id,
        guildId: link.guild_id,
      },
      state = await new EntitlementService(db).effective(scope);
    if (
      state.privacyDeleted ||
      !state.features.includes("multi_guild") ||
      link.state !== "ACTIVE"
    ) {
      results.push({
        guildId: link.guild_id,
        state: state.privacyDeleted ? "PRIVACY_DELETED" : link.state === "DETACHED" ? "DETACHED" : "REQUIRES_REVIEW",
        coverage: null,
        openAttention: null,
        change: null,
        health: null,
      });
      continue;
    }
    const summary = await db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, scope);
      await betaAccess(tx, scope, "read");
      const entitlement = await new EntitlementService(tx).effective(scope);
      assert(!entitlement.privacyDeleted, "PRIVACY_DELETED", 403);
      return {
        coverage: (await latestCapability(tx, scope))?.coverage ?? null,
        health: await integrationHealth(tx, scope),
        openAttention: (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM attention_items WHERE ${tenant(scope)} AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`.execute(
            tx,
          )
        ).rows[0]!.n,
      };
    });
    const chart = await new ExploreService(db).chart(
      scope,
      {
        days: 7,
        compare: true,
      },
      new Date(),
      (tx) => betaAccess(tx, scope, "read"),
    );
    results.push({
      guildId: link.guild_id,
      state: "ACTIVE",
      ...summary,
      change: chart.comparison,
      current: chart.evidence,
    });
  }
  // Recheck every scope before returning the aggregate assembled across reads.
  // Revocation, deletion or loss of the home license must discard stale results.
  return db.transaction().execute(async (tx) => {
    // All final fences belong to this transaction. Holding a caller's session
    // lock across reads on other connections can deadlock concurrent callers
    // when stops for their respective guilds are queued.
    const key = (scope: Scope) => scope.organizationId + ":" + scope.guildId;
    const admitted = new Set([
      key(caller),
      key(home),
      ...results
        .filter((result) => result.state === "ACTIVE")
        .map((result) => key(scopeForGuild(result.guildId))),
    ]);
    const scopes = new Map(
      [
        caller,
        home,
        ...results.map((result) => scopeForGuild(result.guildId)),
      ].map((scope) => [key(scope), scope]),
    );
    // Take tenant fences in a stable order before the organization lock, while
    // leaving credential/member authorization after that lock.
    for (const scopeKey of [...scopes.keys()].sort()) {
      const scope = scopes.get(scopeKey)!;
      await privacyReadLock(tx, scope);
      if (admitted.has(scopeKey)) await betaAccess(tx, scope, "read");
    }
    await organizationLock(tx, id);
    await fence(tx);
    const group = (
      await sql<{
        home_guild_id: string;
      }>`SELECT home_guild_id FROM operations_organizations WHERE id=${id}::uuid`.execute(
        tx,
      )
    ).rows[0];
    assert(group, "ORGANIZATION_REQUIRED", 409);
    assert(
      group.home_guild_id === home.guildId,
      "ORGANIZATION_ACCESS_CHANGED",
      409,
    );
    await new EntitlementService(tx).require(home, "multi_guild");
    for (const result of results) {
      const scope = scopeForGuild(result.guildId);
      await privacyReadLock(tx, scope);
      const state = await new EntitlementService(tx).effective(scope);
      const link = (
        await sql<{
          state: string;
        }>`SELECT state FROM operations_org_guilds WHERE ${tenant(scope)} AND root_organization_id=${id}::uuid FOR SHARE`.execute(
          tx,
        )
      ).rows[0];
      if (result.state === "ACTIVE")
        assert(
          !state.privacyDeleted &&
            state.features.includes("multi_guild") &&
            link?.state === "ACTIVE",
          "ORGANIZATION_ACCESS_CHANGED",
          409,
        );
    }
    return results;
  });
}
export async function auditExport(
  db: Database,
  s: Scope,
  actor: Actor,
  format: "CSV" | "JSON",
) {
  return db.transaction().execute(async (tx) => {
    await operationsAccess(tx, s, actor, "GOVERN", "audit_export");
    const rows = (
      await sql<{
        actor_hash: string;
        action: string;
        target: string;
        revision: number | null;
        result: string;
        occurred_at: Date;
      }>`SELECT actor_hash,action,target,revision,result,occurred_at FROM operations_audit_events WHERE ${tenant(s)} ORDER BY occurred_at DESC,id LIMIT 10000`.execute(
        tx,
      )
    ).rows.map((row) => ({
      actor: row.actor_hash,
      action: row.action,
      target: row.target,
      revision: row.revision,
      result: row.result,
      at: row.occurred_at.toISOString(),
    }));
    if (format === "JSON") return JSON.stringify(rows);
    const cell = (value: unknown) =>
      '"' + String(value ?? "").replaceAll('"', '""') + '"';
    return (
      [
        ["actor", "action", "target", "revision", "result", "at"],
        ...rows.map((row) => Object.values(row)),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n") + "\r\n"
    );
  });
}
