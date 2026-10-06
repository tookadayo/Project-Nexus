import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../db/src/index";
import { assert, type Scope, isDomainError } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import type { IdentityVault } from "../../identity/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { integrationHealth } from "../../lifecycle/src/observation";
import { latestCapability } from "../../lifecycle/src/discovery";
import { outboundUrl, sendWebhook } from "../../security/src/outbound-url";
import {
  operationsAccess,
  operationsAudit,
  operationsLock,
  operationsEvent,
} from "./policy";
import { deliveryFence } from "./delivery-policy";
export const outboundEvents = [
  "attention.created",
  "attention.resolved",
  "playbook.executed",
  "intervention.review_ready",
  "coverage.changed",
  "aggregate.export",
] as const;
export const webhookInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z
      .string()
      .max(2048)
      .refine((v) => {
        try {
          outboundUrl(v);
          return true;
        } catch {
          return false;
        }
      }),
    events: z
      .array(z.enum(outboundEvents))
      .min(1)
      .max(6)
      .transform((v) => [...new Set(v)]),
  })
  .strict();
export function webhookSignature(
  secret: string,
  timestamp: string,
  id: string,
  body: string,
) {
  return (
    "v1=" +
    createHmac("sha256", secret)
      .update(timestamp + "." + id + "." + body)
      .digest("hex")
  );
}
export class Webhooks {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async create(s: Scope, actor: Actor, input: unknown) {
    const data = webhookInput.parse(input),
      secret = randomBytes(32).toString("base64url");
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "webhooks");
      await operationsLock(tx, s);
      const count = (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM webhook_endpoints WHERE ${tenant(s)} AND state<>'DISABLED'`.execute(
          tx,
        )
      ).rows[0]!.n;
      assert(
        (await new EntitlementService(tx).limit(s, "webhooks", count)).allowed,
        "BILLING_LIMIT_REACHED",
        403,
      );
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO webhook_endpoints(organization_id,guild_id,name,url,event_types,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${data.name},${data.url},${data.events}::text[],${actor.key}) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await sql`INSERT INTO webhook_secrets VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,1,${this.vault.seal(s, secret)},NULL)`.execute(
        tx,
      );
      await operationsAudit(tx, s, actor.key, "WEBHOOK_CREATED", row.id, 1);
      return { id: row.id, secret, version: 1 };
    });
  }
  async rotate(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    const secret = randomBytes(32).toString("base64url");
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "webhooks");
      await operationsLock(tx, s);
      const row = (
        await sql<{
          secret_version: number;
        }>`UPDATE webhook_endpoints SET secret_version=secret_version+1 WHERE ${tenant(s)} AND id=${id}::uuid RETURNING secret_version`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "WEBHOOK_NOT_FOUND", 404);
      await sql`UPDATE webhook_secrets SET valid_until=now()+interval '24 hours' WHERE ${tenant(s)} AND endpoint_id=${id}::uuid AND valid_until IS NULL`.execute(
        tx,
      );
      await sql`INSERT INTO webhook_secrets VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${row.secret_version},${this.vault.seal(s, secret)},NULL)`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "WEBHOOK_SECRET_ROTATED",
        id,
        row.secret_version,
      );
      return { secret, version: row.secret_version, previousKeyGraceHours: 24 };
    });
  }
  async setEnabled(s: Scope, actor: Actor, id: string, enabled: boolean) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(
        tx,
        s,
        actor,
        "CONFIGURE",
        enabled ? "webhooks" : undefined,
      );
      await operationsLock(tx, s);
      if (enabled) {
        const count = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM webhook_endpoints WHERE ${tenant(s)} AND state='ENABLED' AND id<>${id}::uuid`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(
          (await new EntitlementService(tx).limit(s, "webhooks", count))
            .allowed,
          "BILLING_LIMIT_REACHED",
          403,
        );
      }
      assert(
        (
          await sql`UPDATE webhook_endpoints SET state=${enabled ? "ENABLED" : "DISABLED"},failures=0 WHERE ${tenant(s)} AND id=${id}::uuid RETURNING id`.execute(
            tx,
          )
        ).rows.length,
        "WEBHOOK_NOT_FOUND",
        404,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        enabled ? "WEBHOOK_ENABLED" : "WEBHOOK_DISABLED",
        id,
        null,
      );
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      return {
        endpoints: (
          await sql`SELECT id,name,url,event_types,state,secret_version,failures,created_at FROM webhook_endpoints WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows,
        deliveries: (
          await sql`SELECT id,endpoint_id,event_id,state,attempts,last_status,last_error,available_at,completed_at FROM webhook_deliveries WHERE ${tenant(s)} ORDER BY available_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
}
type Delivery = {
  id: string;
  endpoint_id: string;
  event_id: string;
  secret_version: number;
  attempts: number;
  lease_token: string;
};
export class WebhookWorker {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly transport = sendWebhook,
  ) {}
  async tick(s: Scope, now = new Date()) {
    const row = await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const entitlement = new EntitlementService(tx),
        allowed = await entitlement.can(s, "webhooks");
      if (!allowed) {
        await sql`UPDATE webhook_endpoints SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED'`.execute(
          tx,
        );
        await sql`UPDATE webhook_deliveries SET state='PAUSED_PLAN_LIMIT',lease_until=NULL WHERE ${tenant(s)} AND state IN ('PENDING','RUNNING')`.execute(
          tx,
        );
        return null;
      }
      await sql`UPDATE webhook_deliveries SET state='PENDING',lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND state='RUNNING' AND lease_until<=${now}`.execute(
        tx,
      );
      const events = (
        await sql<{
          id: string;
          event_type: string;
          created_at: Date;
        }>`SELECT id,event_type,created_at FROM operations_domain_events WHERE ${tenant(s)} AND expanded_at IS NULL ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`.execute(
          tx,
        )
      ).rows;
      for (const event of events) {
        await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,endpoint_id,event_id,secret_version,available_at) SELECT ${s.organizationId}::uuid,${s.guildId},id,${event.id}::uuid,secret_version,${now} FROM webhook_endpoints WHERE ${tenant(s)} AND state='ENABLED' AND ${event.event_type}=ANY(event_types) AND created_at<=${event.created_at} ON CONFLICT DO NOTHING`.execute(
          tx,
        );
        await sql`UPDATE operations_domain_events SET expanded_at=${now} WHERE ${tenant(s)} AND id=${event.id}::uuid`.execute(
          tx,
        );
      }
      const candidate = (
        await sql<Delivery>`SELECT d.id,d.endpoint_id,d.event_id,d.secret_version,d.attempts FROM webhook_deliveries d JOIN webhook_endpoints e ON e.organization_id=d.organization_id AND e.guild_id=d.guild_id AND e.id=d.endpoint_id WHERE d.organization_id=${s.organizationId}::uuid AND d.guild_id=${s.guildId} AND d.state='PENDING' AND d.available_at<=${now} AND e.state='ENABLED' ORDER BY d.available_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`.execute(
          tx,
        )
      ).rows[0];
      if (!candidate) return null;
      candidate.lease_token = randomUUID();
      await sql`UPDATE webhook_deliveries SET state='RUNNING',attempts=attempts+1,lease_until=${new Date(now.getTime() + 30000)},lease_token=${candidate.lease_token}::uuid WHERE ${tenant(s)} AND id=${candidate.id}::uuid`.execute(
        tx,
      );
      return candidate;
    });
    if (!row) return false;
    let status: number | null = null,
      error: string | null = null;
    try {
      status = await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await new EntitlementService(tx).require(s, "webhooks");
        await operationsLock(tx, s);
        const data = (
          await sql<{
            url: string;
            secret_ciphertext: string;
            valid_until: Date | null;
            event_type: string;
            data: Record<string, unknown>;
            created_at: Date;
          }>`SELECT e.url,k.secret_ciphertext,k.valid_until,v.event_type,v.data,v.created_at FROM webhook_endpoints e JOIN webhook_secrets k ON k.organization_id=e.organization_id AND k.guild_id=e.guild_id AND k.endpoint_id=e.id AND k.version=${row.secret_version} JOIN operations_domain_events v ON v.organization_id=e.organization_id AND v.guild_id=e.guild_id AND v.id=${row.event_id}::uuid WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.id=${row.endpoint_id}::uuid AND e.state='ENABLED'`.execute(
            tx,
          )
        ).rows[0];
        assert(data, "WEBHOOK_DISABLED", 409);
        assert(
          !data.valid_until || data.valid_until > new Date(),
          "WEBHOOK_SECRET_EXPIRED",
          409,
        );
        const entitled = await new EntitlementService(tx).effective(s),
          position = (
            await sql<{
              n: number;
            }>`SELECT count(*)::int AS n FROM webhook_endpoints WHERE ${tenant(s)} AND state='ENABLED' AND (created_at,id)<=(SELECT created_at,id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${row.endpoint_id}::uuid)`.execute(
              tx,
            )
          ).rows[0]!.n;
        assert(
          entitled.limits.webhooks === null ||
            position <= entitled.limits.webhooks,
          "BILLING_LIMIT_REACHED",
          403,
        );
        if (
          !(
            await sql`SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.organization_id=d.organization_id AND e.guild_id=d.guild_id AND e.id=d.endpoint_id WHERE d.organization_id=${s.organizationId}::uuid AND d.guild_id=${s.guildId} AND d.id=${row.id}::uuid AND d.state='RUNNING' AND d.lease_token=${row.lease_token}::uuid AND d.lease_until>now() AND e.state='ENABLED' FOR SHARE OF d,e`.execute(
              tx,
            )
          ).rows.length
        )
          return null;
        const playbook = (
            await sql<{
              id: string;
            }>`SELECT id FROM playbook_action_runs WHERE ${tenant(s)} AND delivery_id=${row.id}::uuid`.execute(
              tx,
            )
          ).rows[0],
          report = (
            await sql<{
              id: string;
            }>`SELECT id FROM report_runs WHERE ${tenant(s)} AND delivery_id=${row.id}::uuid`.execute(
              tx,
            )
          ).rows[0];
        if (playbook) await deliveryFence(tx, s, "PLAYBOOK", playbook.id);
        if (report) await deliveryFence(tx, s, "REPORT", report.id);
        const body = JSON.stringify({
            id: row.event_id,
            type: data.event_type,
            createdAt: data.created_at.toISOString(),
            scope: s,
            data: data.data,
          }),
          timestamp = String(Math.floor(Date.now() / 1000));
        assert(
          Buffer.byteLength(body) <= 512 * 1024,
          "WEBHOOK_PAYLOAD_TOO_LARGE",
          413,
        );
        return this.transport(data.url, body, {
          "Nexus-Delivery-Id": row.id,
          "Nexus-Timestamp": timestamp,
          "Nexus-Signature": webhookSignature(
            this.vault.open(s, data.secret_ciphertext),
            timestamp,
            row.id,
            body,
          ),
          "Nexus-Key-Version": String(row.secret_version),
        });
      });
      if (status === null) return true;
      if (status < 200 || status >= 300) error = "HTTP_" + status;
    } catch (reason) {
      error = isDomainError(reason)
        ? reason.code
        : reason instanceof Error && /timeout/i.test(reason.message)
          ? "TIMEOUT"
          : "NETWORK_FAILURE";
    }
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const retry =
        Boolean(error) &&
        row.attempts + 1 < 8 &&
        (status === null || status === 429 || status >= 500) &&
        ![
          "WEBHOOK_PRIVATE_ADDRESS",
          "WEBHOOK_SECRET_EXPIRED",
          "WEBHOOK_DISABLED",
          "WEBHOOK_PAYLOAD_TOO_LARGE",
          "PLAYBOOK_CONFIGURATION_CHANGED",
          "REPORT_CONFIGURATION_CHANGED",
          "ATTENTION_NOT_ACTIVE",
          "PLAN_REQUIRED",
          "BILLING_LIMIT_REACHED",
        ].includes(error!);
      const updated = (
        await sql`UPDATE webhook_deliveries SET state=${!error ? "SUCCEEDED" : retry ? "PENDING" : "FAILED"},last_status=${status},last_error=${error},lease_until=NULL,lease_token=NULL,available_at=${new Date(Date.now() + Math.min(3600000, 2 ** (row.attempts + 1) * 15000))},completed_at=CASE WHEN ${!error || !retry} THEN now() ELSE NULL END WHERE ${tenant(s)} AND id=${row.id}::uuid AND state='RUNNING' AND lease_token=${row.lease_token}::uuid RETURNING id`.execute(
          tx,
        )
      ).rows.length;
      if (!updated) return;
      await sql`UPDATE webhook_endpoints SET failures=CASE WHEN ${!error} THEN 0 ELSE failures+1 END,state=CASE WHEN ${Boolean(error)} AND failures+1>=8 THEN 'DISABLED' ELSE state END WHERE ${tenant(s)} AND id=${row.endpoint_id}::uuid`.execute(
        tx,
      );
    });
    return true;
  }
  async observeCoverage(s: Scope) {
    const health = await integrationHealth(this.db, s),
      capability = await latestCapability(this.db, s),
      summary = {
        gateway: health.gateway,
        intents: health.intents,
        coverage: capability?.coverage ?? null,
      },
      fingerprint = createHash("sha256")
        .update(JSON.stringify(summary))
        .digest("hex");
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      assert(
        !(await new EntitlementService(tx).effective(s)).privacyDeleted,
        "PRIVACY_DELETED",
        403,
      );
      await operationsLock(tx, s);
      const previous = (
        await sql<{
          fingerprint: string;
        }>`SELECT fingerprint FROM operations_coverage_heads WHERE ${tenant(s)}`.execute(
          tx,
        )
      ).rows[0];
      if (previous?.fingerprint === fingerprint) return;
      await sql`INSERT INTO operations_coverage_heads VALUES(${s.organizationId}::uuid,${s.guildId},${fingerprint}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint`.execute(
        tx,
      );
      await operationsEvent(
        tx,
        s,
        "coverage.changed",
        "coverage:" + randomUUID(),
        summary,
      );
    });
  }
}
