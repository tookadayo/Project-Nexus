import { z } from "zod";
import { sql, tenant, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import type { DiscordPort } from "../../discord/src/rest";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
import type { MaintenanceAuthorizationProof } from "./maintenance-authorization";
import { integrationMaintenanceAccess, integrationMaintenanceCurrent, integrationRevision } from "./integration-maintenance";
export const destinationInput = z.discriminatedUnion("kind", [
  z
    .object({
      name: z.string().trim().min(1).max(80),
      kind: z.literal("DISCORD"),
      channelId: z.string().regex(/^\d{17,20}$/),
      roleId: z
        .string()
        .regex(/^\d{17,20}$/)
        .nullable()
        .default(null),
    })
    .strict(),
  z
    .object({
      name: z.string().trim().min(1).max(80),
      kind: z.literal("WEBHOOK"),
      endpointId: z.uuid(),
    })
    .strict(),
  z
    .object({
      name: z.string().trim().min(1).max(80),
      kind: z.literal("TEAM"),
      teamId: z.uuid(),
    })
    .strict(),
]);
export type IntegrationDestination = {
  id: string;
  name: string;
  kind: "DISCORD" | "WEBHOOK" | "TEAM";
  channel_id: string | null;
  role_id: string | null;
  endpoint_id: string | null;
  team_id: string | null;
  state: "ENABLED" | "DISABLED" | "PAUSED_PLAN_LIMIT";
  revision: number;
};
export class Destinations {
  constructor(
    private readonly db: Database,
    private readonly discord: DiscordPort,
    private readonly maintenanceProof?: MaintenanceAuthorizationProof,
  ) {}
  async update(s: Scope, actor: Actor, id: string, expectedRevision: number, input: unknown) {
    z.uuid().parse(id); integrationRevision(expectedRevision);
    const data = destinationInput.parse(input);
    // Current authorization precedes Discord metadata access; no provider call
    // is made while holding a database transaction open.
    await this.db.transaction().execute(tx => integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "surface_breakdowns"));
    if (data.kind === "DISCORD") {
      await this.discord.checkChannel(s.guildId, data.channelId);
      if (data.roleId) assert((await this.discord.roles(s.guildId)).some(role => role.id === data.roleId), "ROLE_NOT_FOUND", 404);
    }
    return this.db.transaction().execute(async tx => {
      await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "surface_breakdowns");
      if (data.kind === "WEBHOOK") await operationsAccess(tx, s, actor, "CONFIGURE", "webhooks");
      if (data.kind === "TEAM") await operationsAccess(tx, s, actor, "CONFIGURE", "team_assignment");
      if (data.kind === "DISCORD" && data.roleId) await operationsAccess(tx, s, actor, "CONFIGURE", "team_routing");
      const previous = (await sql<IntegrationDestination>`SELECT * FROM integration_destinations WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(previous, "DESTINATION_NOT_FOUND", 404);
      assert(previous.revision === expectedRevision, "REVISION_CONFLICT", 409);
      const routingChanged = previous.kind !== data.kind || previous.channel_id !== (data.kind === "DISCORD" ? data.channelId : null)
        || previous.role_id !== (data.kind === "DISCORD" ? data.roleId : null) || previous.endpoint_id !== (data.kind === "WEBHOOK" ? data.endpointId : null)
        || previous.team_id !== (data.kind === "TEAM" ? data.teamId : null);
      if (routingChanged) await this.assertUnreferenced(tx, s, id);
      if (data.kind === "WEBHOOK") assert((await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${data.endpointId}::uuid AND state='ENABLED' FOR SHARE`.execute(tx)).rows.length, "WEBHOOK_NOT_FOUND", 404);
      if (data.kind === "TEAM") assert((await sql`SELECT team_id FROM operations_team_bindings WHERE ${tenant(s)} AND team_id=${data.teamId}::uuid FOR SHARE`.execute(tx)).rows.length, "TEAM_NOT_FOUND", 404);
      await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, "surface_breakdowns");
      const row = (await sql<IntegrationDestination>`UPDATE integration_destinations SET name=${data.name},kind=${data.kind},channel_id=${data.kind === "DISCORD" ? data.channelId : null},role_id=${data.kind === "DISCORD" ? data.roleId : null},endpoint_id=${data.kind === "WEBHOOK" ? data.endpointId : null}::uuid,team_id=${data.kind === "TEAM" ? data.teamId : null}::uuid,revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision} RETURNING *`.execute(tx)).rows[0];
      assert(row, "REVISION_CONFLICT", 409);
      await operationsAudit(tx, s, actor.key, "DESTINATION_UPDATED", id, row.revision);
      return row;
    });
  }
  private async assertUnreferenced(tx: import("../../db/src/index").Tx, s: Scope, id: string) {
    const reference = (await sql`SELECT 1 FROM playbook_action_runs WHERE ${tenant(s)} AND destination_id=${id}::uuid
      UNION ALL SELECT 1 FROM report_schedules WHERE ${tenant(s)} AND destination_id=${id}::uuid
      UNION ALL SELECT 1 FROM operations_intake_panels WHERE ${tenant(s)} AND destination_id=${id}::uuid
      UNION ALL SELECT 1 FROM playbook_revisions WHERE ${tenant(s)} AND
        (definition->'destinations' ? ${id} OR definition->'escalation'->>'destinationId'=${id}) LIMIT 1`.execute(tx)).rows.length;
    assert(!reference, "DESTINATION_REFERENCED", 409);
  }
  async delete(s: Scope, actor: Actor, id: string, expectedRevision: number) {
    z.uuid().parse(id); integrationRevision(expectedRevision);
    return this.db.transaction().execute(async tx => {
      await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof);
      const row = (await sql<IntegrationDestination>`SELECT * FROM integration_destinations WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row, "DESTINATION_NOT_FOUND", 404); assert(row.revision === expectedRevision, "REVISION_CONFLICT", 409);
      await this.assertUnreferenced(tx, s, id);
      await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof);
      await sql`DELETE FROM integration_destinations WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision}`.execute(tx);
      await operationsAudit(tx, s, actor.key, "DESTINATION_DELETED", id, expectedRevision);
      return { id, deleted: true as const };
    });
  }
  async create(s: Scope, actor: Actor, input: unknown) {
    const data = destinationInput.parse(input);
    if (this.maintenanceProof) await this.db.transaction().execute(tx => integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "surface_breakdowns"));
    if (data.kind === "DISCORD") {
      await this.discord.checkChannel(s.guildId, data.channelId);
      if (data.roleId)
        assert(
          (await this.discord.roles(s.guildId)).some(
            (role) => role.id === data.roleId,
          ),
          "ROLE_NOT_FOUND",
          404,
        );
    }
    return this.db.transaction().execute(async (tx) => {
      if (this.maintenanceProof) await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "surface_breakdowns");
      await operationsAccess(tx, s, actor, "CONFIGURE", "surface_breakdowns");
      if (data.kind === "WEBHOOK")
        await operationsAccess(tx, s, actor, "CONFIGURE", "webhooks");
      if (data.kind === "TEAM")
        await operationsAccess(tx, s, actor, "CONFIGURE", "team_assignment");
      if (data.kind === "DISCORD" && data.roleId)
        await operationsAccess(tx, s, actor, "CONFIGURE", "team_routing");
      await operationsLock(tx, s);
      if (data.kind === "WEBHOOK")
        assert(
          (
            await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${data.endpointId}::uuid AND state='ENABLED'`.execute(
              tx,
            )
          ).rows.length,
          "WEBHOOK_NOT_FOUND",
          404,
        );
      if (this.maintenanceProof) await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, "surface_breakdowns");
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO integration_destinations(organization_id,guild_id,name,kind,channel_id,role_id,endpoint_id,team_id) VALUES(${s.organizationId}::uuid,${s.guildId},${data.name},${data.kind},${data.kind === "DISCORD" ? data.channelId : null},${data.kind === "DISCORD" ? data.roleId : null},${data.kind === "WEBHOOK" ? data.endpointId : null}::uuid,${data.kind === "TEAM" ? data.teamId : null}::uuid) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await operationsAudit(tx, s, actor.key, "DESTINATION_CREATED", row.id, 1);
      return row;
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return (
        await sql<IntegrationDestination>`SELECT * FROM integration_destinations WHERE ${tenant(s)} ORDER BY name,id LIMIT 100`.execute(
          tx,
        )
      ).rows;
    });
  }
  async resume(s: Scope, actor: Actor, id: string, expectedRevision?: number) {
    z.uuid().parse(id);
    if (expectedRevision !== undefined) integrationRevision(expectedRevision);
    assert(!this.maintenanceProof || expectedRevision !== undefined, "REVISION_REQUIRED");
    if (this.maintenanceProof) await this.db.transaction().execute(tx => integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "surface_breakdowns"));
    const previous = (await this.list(s, actor)).find((row) => row.id === id);
    assert(previous, "DESTINATION_NOT_FOUND", 404);
    if (expectedRevision !== undefined) assert(previous.revision === expectedRevision, "REVISION_CONFLICT", 409);
    if (previous.kind === "DISCORD") {
      await this.discord.checkChannel(s.guildId, previous.channel_id!);
      if (previous.role_id)
        assert(
          (await this.discord.roles(s.guildId)).some(
            (role) => role.id === previous.role_id,
          ),
          "ROLE_NOT_FOUND",
          404,
        );
    }
    return this.db.transaction().execute(async (tx) => {
      if (this.maintenanceProof) await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "surface_breakdowns");
      await operationsAccess(tx, s, actor, "CONFIGURE", "surface_breakdowns");
      await operationsLock(tx, s);
      if (previous.kind === "WEBHOOK") {
        await operationsAccess(tx, s, actor, "CONFIGURE", "webhooks");
        assert(
          (
            await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${previous.endpoint_id}::uuid AND state='ENABLED'`.execute(
              tx,
            )
          ).rows.length,
          "WEBHOOK_NOT_FOUND",
          404,
        );
      }
      if (previous.kind === "TEAM")
        await operationsAccess(tx, s, actor, "CONFIGURE", "team_assignment");
      if (previous.role_id)
        await operationsAccess(tx, s, actor, "CONFIGURE", "team_routing");
      if (this.maintenanceProof) await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, "surface_breakdowns");
      assert(
        (
          await sql`UPDATE integration_destinations SET state='ENABLED',revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${previous.revision} AND state<>'ENABLED' RETURNING id`.execute(
            tx,
          )
        ).rows.length,
        "REVISION_CONFLICT",
        409,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "DESTINATION_RESUMED",
        id,
        previous.revision + 1,
      );
    });
  }
  async disable(s: Scope, actor: Actor, id: string, expectedRevision?: number) {
    z.uuid().parse(id);
    if (expectedRevision !== undefined) integrationRevision(expectedRevision);
    assert(!this.maintenanceProof || expectedRevision !== undefined, "REVISION_REQUIRED");
    await this.db.transaction().execute(async (tx) => {
      if (this.maintenanceProof) await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof);
      await operationsAccess(tx, s, actor, "CONFIGURE");
      await operationsLock(tx, s);
      if (expectedRevision !== undefined) assert((await sql`SELECT id FROM integration_destinations WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision} FOR UPDATE`.execute(tx)).rows.length, "REVISION_CONFLICT", 409);
      if (this.maintenanceProof) await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof);
      assert(
        (
          await sql`UPDATE integration_destinations SET state='DISABLED',revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid RETURNING id`.execute(
            tx,
          )
        ).rows.length,
        "DESTINATION_NOT_FOUND",
        404,
      );
      await operationsAudit(tx, s, actor.key, "DESTINATION_DISABLED", id, null);
    });
  }
}
