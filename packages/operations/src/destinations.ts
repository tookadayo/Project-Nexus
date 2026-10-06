import { z } from "zod";
import { sql, tenant, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import type { DiscordPort } from "../../discord/src/rest";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
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
  ) {}
  async create(s: Scope, actor: Actor, input: unknown) {
    const data = destinationInput.parse(input);
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
  async resume(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    const previous = (await this.list(s, actor)).find((row) => row.id === id);
    assert(previous, "DESTINATION_NOT_FOUND", 404);
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
  async disable(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    await this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      await operationsLock(tx, s);
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
