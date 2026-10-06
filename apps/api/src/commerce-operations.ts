import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql, tenant, type Database } from "../../../packages/db/src/index";
import type { IdentityVault } from "../../../packages/identity/src/index";
import {
  ApiCredentials,
  type ApiScope,
} from "../../../packages/operations/src/credentials";
import { inboxRows } from "../../../packages/operations/src/inbox";

import { interventionRows } from "../../../packages/operations/src/intervention-review";
import { ExploreService } from "../../../packages/analytics/src/explore";
import { chartQuerySchema } from "../../../packages/analytics/src/chart-spec";
import { SettingsService } from "../../../packages/settings/src/index";
import { integrationHealth } from "../../../packages/lifecycle/src/observation";
import { EntitlementService } from "../../../packages/settings/src/billing/entitlements";
import { assert } from "../../../packages/shared/src/index";
import {
  organizationBinding,
  organizationAggregate,
} from "../../../packages/operations/src/organization";
import {
  nexusRole,
  operationsAudit,
} from "../../../packages/operations/src/policy";
export function registerOperationsApi(
  app: FastifyInstance,
  db: Database,
  vault: IdentityVault,
) {
  const credentials = new ApiCredentials(db, vault),
    authenticate = async (header: string | undefined, scope: ApiScope) =>
      credentials.authenticate((header ?? "").replace(/^Bearer /, ""), scope);
  app.get("/v1/organization", async (req, reply) => {
    const auth = await authenticate(
      req.headers.authorization,
      "organization:read",
    );
    reply.header("Cache-Control", "no-store");
    const group = await db.transaction().execute(async (tx) => {
      await credentials.fence(
        tx,
        auth.scope,
        auth.credentialId,
        "organization:read",
      );
      await new EntitlementService(tx).require(auth.scope, "advanced_api");
      assert(
        await nexusRole(tx, auth.scope, auth.actorHash),
        "NEXUS_ROLE_REQUIRED",
        403,
      );
      const group = await organizationBinding(tx, auth.scope);
      assert(group, "ORGANIZATION_REQUIRED", 409);
      return group;
    });
    return {
      organization: { id: group.id, name: group.name },
      guilds: await organizationAggregate(db, group.id, async (tx) => {
        await credentials.fence(
          tx,
          auth.scope,
          auth.credentialId,
          "organization:read",
        );
        assert(
          await nexusRole(tx, auth.scope, auth.actorHash),
          "NEXUS_ROLE_REQUIRED",
          403,
        );
        assert(
          (await organizationBinding(tx, auth.scope))?.id === group.id,
          "ORGANIZATION_REQUIRED",
          409,
        );
      }),
    };
  });
  app.get("/v1/guild", async (req, reply) => {
    const auth = await authenticate(req.headers.authorization, "guild:read");
    reply.header("Cache-Control", "no-store");
    return db.transaction().execute(async (tx) => {
      await credentials.fence(tx, auth.scope, auth.credentialId);
      await new EntitlementService(tx).require(auth.scope, "api");
      const cfg = await new SettingsService(tx).get(auth.scope);
      return {
        guildId: auth.scope.guildId,
        model: {
          modes: cfg.communityModel.modes,
          confirmed: cfg.communityModel.confirmed,
        },
        health: await integrationHealth(tx, auth.scope),
      };
    });
  });
  app.get("/v1/metrics", async (req, reply) => {
    const auth = await authenticate(req.headers.authorization, "metrics:read"),
      input = z
        .object({ q: z.string().max(4096).optional() })
        .strict()
        .parse(req.query);
    reply.header("Cache-Control", "no-store");
    return new ExploreService(db).chart(
      auth.scope,
      chartQuerySchema.parse(JSON.parse(input.q ?? "{}")),
      new Date(),
      (tx) => credentials.fence(tx, auth.scope, auth.credentialId),
    );
  });
  app.get("/v1/attention", async (req, reply) => {
    const auth = await authenticate(
      req.headers.authorization,
      "attention:read",
    );
    reply.header("Cache-Control", "no-store");
    return db.transaction().execute(async (tx) => {
      await credentials.fence(tx, auth.scope, auth.credentialId);
      await new EntitlementService(tx).require(auth.scope, "api");
      return inboxRows(tx, auth.scope);
    });
  });
  app.get("/v1/interventions", async (req, reply) => {
    const auth = await authenticate(
      req.headers.authorization,
      "interventions:read",
    );
    reply.header("Cache-Control", "no-store");
    return db.transaction().execute(async (tx) => {
      await credentials.fence(tx, auth.scope, auth.credentialId);
      await new EntitlementService(tx).require(auth.scope, "api");
      return interventionRows(tx, auth.scope);
    });
  });
  app.post("/v1/attention/state", async (req, reply) => {
    const auth = await authenticate(
        req.headers.authorization,
        "attention:write",
      ),
      input = z
        .object({
          key: z.string().min(1).max(150),
          channelId: z.string().max(20),
          state: z.enum([
            "ACKNOWLEDGED",
            "IN_PROGRESS",
            "RESOLVED",
            "DISMISSED",
          ]),
          version: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body);
    reply.header("Cache-Control", "no-store");
    return db.transaction().execute(async (tx) => {
      await credentials.fence(
        tx,
        auth.scope,
        auth.credentialId,
        "attention:write",
      );
      await new EntitlementService(tx).require(auth.scope, "advanced_api");
      const row = (
        await sql<{
          status: string;
          version: number;
        }>`SELECT status,version FROM attention_items WHERE ${tenant(auth.scope)} AND message_id=${input.key} AND channel_id=${input.channelId} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "ATTENTION_NOT_FOUND", 404);
      assert(row.version === input.version, "REVISION_CONFLICT", 409);
      assert(
        !["RESOLVED", "DISMISSED"].includes(row.status),
        "ATTENTION_NOT_ACTIVE",
        409,
      );
      await sql`UPDATE attention_items SET status=${input.state},version=version+1,last_actor_hash=${auth.actorHash},acknowledged_at=CASE WHEN ${["ACKNOWLEDGED", "IN_PROGRESS"].includes(input.state)} THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,resolved_at=CASE WHEN ${["RESOLVED", "DISMISSED"].includes(input.state)} THEN now() ELSE NULL END,snooze_until=NULL,updated_at=now() WHERE ${tenant(auth.scope)} AND message_id=${input.key}`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        auth.scope,
        auth.actorHash,
        "ATTENTION_API_UPDATED",
        input.key,
        input.version + 1,
      );
      return { state: input.state, version: input.version + 1 };
    });
  });
}
