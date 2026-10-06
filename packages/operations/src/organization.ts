import { z } from "zod";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import type { IdentityVault } from "../../identity/src/index";
import type { ServerAuthorization } from "../../security/src/server-authorization";
import type { DiscordPort } from "../../discord/src/rest";
import { isDiscordFailure } from "../../discord/src/rest";
import { scopeForGuild } from "../../security/src/scoping";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { integrationHealth } from "../../lifecycle/src/observation";
import { latestCapability } from "../../lifecycle/src/discovery";
import { ExploreService } from "../../analytics/src/explore";
import type { ChartSpec } from "../../analytics/src/chart-spec";
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
      }>`SELECT o.id,o.name,o.home_guild_id FROM operations_org_guilds g JOIN operations_organizations o ON o.id=g.root_organization_id WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.state='ACTIVE'`.execute(
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
  ) {}
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
        await sql`DELETE FROM operations_role_bindings WHERE ${tenant(target)}`.execute(
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
          }>`SELECT id,role,revision FROM operations_org_members WHERE organization_id=${group.id}::uuid AND user_digest=${digest} FOR UPDATE`.execute(
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
      if (!previous) {
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
      await sql`DELETE FROM operations_role_bindings WHERE root_organization_id=${group.id}::uuid AND member_id=${row.id}::uuid`.execute(
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
      await sql`INSERT INTO operations_team_bindings(organization_id,guild_id,team_id,root_organization_id) SELECT organization_id,guild_id,${team.id}::uuid,root_organization_id FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      await operationsAudit(tx, s, actor.key, "TEAM_CREATED", team.id, 1);
      return team;
    });
  }
  async detail(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      const group = await organizationBinding(tx, s);
      if (!group || !(await nexusRole(tx, s, actor.key)))
        return { organization: null, members: [], teams: [], guilds: [] };
      return {
        organization: group,
        members: (
          await sql`SELECT id,name,role,state,revision FROM operations_org_members WHERE organization_id=${group.id}::uuid ORDER BY name,id`.execute(
            tx,
          )
        ).rows,
        teams: (
          await sql`SELECT id,name FROM operations_teams WHERE organization_id=${group.id}::uuid ORDER BY name,id`.execute(
            tx,
          )
        ).rows,
        guilds: (
          await sql`SELECT organization_id,guild_id,state FROM operations_org_guilds WHERE root_organization_id=${group.id}::uuid ORDER BY linked_at,guild_id`.execute(
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
    return organizationAggregate(this.db, group.id, async (tx) => {
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
  fence?: (tx: Tx) => Promise<void>,
) {
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
        state: state.privacyDeleted ? "PRIVACY_DELETED" : "REQUIRES_REVIEW",
        coverage: null,
        openAttention: null,
        change: null,
        health: null,
      });
      continue;
    }
    const summary = await db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, scope);
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
    const chart = await new ExploreService(db).chart(scope, {
      days: 7,
      compare: true,
    });
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
    await organizationLock(tx, id);
    if (fence) await fence(tx);
    const group = (
      await sql<{
        home_guild_id: string;
      }>`SELECT home_guild_id FROM operations_organizations WHERE id=${id}::uuid`.execute(
        tx,
      )
    ).rows[0];
    assert(group, "ORGANIZATION_REQUIRED", 409);
    const home = { organizationId: id, guildId: group.home_guild_id };
    await privacyReadLock(tx, home);
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
