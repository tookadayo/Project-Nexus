import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
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
import type { MaintenanceAuthorizationProof } from "./maintenance-authorization";
import { integrationMaintenanceAccess, integrationMaintenanceCurrent, integrationRevision } from "./integration-maintenance";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { assertRuntimeOperatingProfile, type RuntimeOperatingProfile } from "../../rules/src/runtime-safety";
import { readOperatorDispatchGate } from "../../security/src/alpha16-operator";
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
    private readonly maintenanceProof?: MaintenanceAuthorizationProof,
  ) {}
  async update(s: Scope, actor: Actor, id: string, expectedRevision: number, input: unknown) {
    z.uuid().parse(id); integrationRevision(expectedRevision);
    const data = webhookInput.parse(input);
    return this.db.transaction().execute(async tx => {
      await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "webhooks");
      const previous = (await sql<{ url: string; event_types: string[]; revision: number }>`SELECT url,event_types,revision FROM webhook_endpoints WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(previous, "WEBHOOK_NOT_FOUND", 404); assert(previous.revision === expectedRevision, "REVISION_CONFLICT", 409);
      const routingChanged = previous.url !== data.url || [...previous.event_types].sort().join("|") !== [...data.events].sort().join("|");
      if (routingChanged) await assertWebhookUnreferenced(tx, s, id);
      await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, "webhooks");
      const row = (await sql<{ id: string; revision: number }>`UPDATE webhook_endpoints SET name=${data.name},url=${data.url},event_types=${data.events}::text[],revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision} RETURNING id,revision`.execute(tx)).rows[0];
      assert(row, "REVISION_CONFLICT", 409);
      await operationsAudit(tx, s, actor.key, "WEBHOOK_UPDATED", id, row.revision);
      return row;
    });
  }
  async delete(s: Scope, actor: Actor, id: string, expectedRevision: number) {
    z.uuid().parse(id); integrationRevision(expectedRevision);
    return this.db.transaction().execute(async tx => {
      await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof);
      const row = (await sql<{ revision: number; delivery_gate: string }>`SELECT revision,delivery_gate FROM webhook_endpoints WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row, "WEBHOOK_NOT_FOUND", 404); assert(row.revision === expectedRevision, "REVISION_CONFLICT", 409);
      assert(row.delivery_gate !== "UNKNOWN_BLOCKED", "WEBHOOK_RESULT_UNKNOWN", 409);
      await assertWebhookUnreferenced(tx, s, id);
      await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof);
      await sql`DELETE FROM webhook_secrets WHERE ${tenant(s)} AND endpoint_id=${id}::uuid`.execute(tx);
      await sql`DELETE FROM webhook_endpoints WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision}`.execute(tx);
      await operationsAudit(tx, s, actor.key, "WEBHOOK_DELETED", id, expectedRevision);
      return { id, deleted: true as const };
    });
  }
  async create(s: Scope, actor: Actor, input: unknown) {
    const data = webhookInput.parse(input),
      secret = randomBytes(32).toString("base64url");
    return this.db.transaction().execute(async (tx) => {
      if (this.maintenanceProof) await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "webhooks");
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
      if (this.maintenanceProof) await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, "webhooks");
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
  async rotate(s: Scope, actor: Actor, id: string, expectedRevision?: number) {
    z.uuid().parse(id);
    if (expectedRevision !== undefined) integrationRevision(expectedRevision);
    assert(!this.maintenanceProof || expectedRevision !== undefined, "REVISION_REQUIRED");
    const secret = randomBytes(32).toString("base64url");
    return this.db.transaction().execute(async (tx) => {
      if (this.maintenanceProof) await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, "webhooks");
      await operationsAccess(tx, s, actor, "CONFIGURE", "webhooks");
      await operationsLock(tx, s);
      if (expectedRevision !== undefined) assert((await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision} FOR UPDATE`.execute(tx)).rows.length, "REVISION_CONFLICT", 409);
      if (this.maintenanceProof) await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, "webhooks");
      const row = (
        await sql<{
          secret_version: number;
        }>`UPDATE webhook_endpoints SET secret_version=secret_version+1,revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid RETURNING secret_version`.execute(
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
  async setEnabled(s: Scope, actor: Actor, id: string, enabled: boolean, expectedRevision?: number) {
    z.uuid().parse(id);
    if (expectedRevision !== undefined) integrationRevision(expectedRevision);
    assert(!this.maintenanceProof || expectedRevision !== undefined, "REVISION_REQUIRED");
    return this.db.transaction().execute(async (tx) => {
      if (this.maintenanceProof) await integrationMaintenanceAccess(tx, s, actor, this.maintenanceProof, enabled ? "webhooks" : undefined);
      await operationsAccess(
        tx,
        s,
        actor,
        "CONFIGURE",
        enabled ? "webhooks" : undefined,
      );
      await operationsLock(tx, s);
      if (expectedRevision !== undefined) assert((await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${id}::uuid AND revision=${expectedRevision} FOR UPDATE`.execute(tx)).rows.length, "REVISION_CONFLICT", 409);
      if (enabled) {
        assert(!(await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${id}::uuid AND delivery_gate='UNKNOWN_BLOCKED'`.execute(tx)).rows.length, "WEBHOOK_RESULT_UNKNOWN", 409);
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
          await sql`UPDATE webhook_endpoints SET state=${enabled ? "ENABLED" : "DISABLED"},failures=0,revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid RETURNING id`.execute(
            tx,
          )
        ).rows.length,
        "WEBHOOK_NOT_FOUND",
        404,
      );
      if (this.maintenanceProof) await integrationMaintenanceCurrent(tx, s, actor, this.maintenanceProof, enabled ? "webhooks" : undefined);
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
          await sql<{id: string; name: string; url: string; event_types: string[]; state: string; secret_version: number; failures: number; created_at: Date; revision: number; delivery_gate: string}>`SELECT id,name,url,event_types,state,secret_version,failures,created_at,revision,delivery_gate FROM webhook_endpoints WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows.map(({ url, ...row }) => ({ ...row, urlConfigured: true, urlDisplay: outboundUrl(url).origin })),
        deliveries: (
          await sql`SELECT id,endpoint_id,event_id,state,attempts,last_status,last_error,available_at,completed_at FROM webhook_deliveries WHERE ${tenant(s)} ORDER BY available_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
}
async function assertWebhookUnreferenced(tx: Tx, s: Scope, id: string) {
  assert(!(await sql`SELECT 1 FROM integration_destinations WHERE ${tenant(s)} AND endpoint_id=${id}::uuid
    UNION ALL SELECT 1 FROM webhook_deliveries WHERE ${tenant(s)} AND endpoint_id=${id}::uuid LIMIT 1`.execute(tx)).rows.length,
    "WEBHOOK_REFERENCED", 409);
}
async function blockWebhookTarget(tx: Tx, s: Scope, id: string) {
  await sql`UPDATE webhook_endpoints SET delivery_gate='UNKNOWN_BLOCKED',safety_epoch=safety_epoch+1 WHERE ${tenant(s)} AND id=${id}::uuid AND delivery_gate<>'UNKNOWN_BLOCKED'`.execute(tx);
}
/** Erase event payload without cascading away uncertain deliveries. The caller
 * must run source removal in this same transaction; no event is re-expanded.
 * Existing created_at/expiry anchors are never refreshed by erasure. */
export async function redactWebhookEventSources(tx: Tx, s: Scope, eventIds: readonly string[]) {
  const ids = [...new Set(z.array(z.uuid()).parse(eventIds))].sort();
  const summary = { redactedEvents: 0, deletedEvents: 0, stoppedPending: 0, unknownDeliveries: 0, blockedEndpoints: 0 };
  if (!ids.length) return summary;
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
  await privacyReadLock(tx, s); await operationsLock(tx, s);
  const endpoints = (await sql<{ endpoint_id: string }>`SELECT DISTINCT endpoint_id FROM webhook_deliveries WHERE ${tenant(s)} AND event_id=ANY(${ids}::uuid[]) ORDER BY endpoint_id`.execute(tx)).rows;
  for (const endpoint of endpoints) await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${endpoint.endpoint_id}::uuid FOR UPDATE`.execute(tx);
  const deliveries = (await sql<{ id: string; endpoint_id: string; state: string; attempts: number; send_admitted_at: Date | null }>`SELECT id,endpoint_id,state,attempts,send_admitted_at FROM webhook_deliveries WHERE ${tenant(s)} AND event_id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`.execute(tx)).rows;
  const blocked = new Set<string>();
  for (const delivery of deliveries) {
    const uncertain = delivery.state === 'RUNNING' || delivery.state === 'UNKNOWN'
      || delivery.state !== 'SUCCEEDED' && (delivery.send_admitted_at !== null || delivery.attempts > 0);
    if (uncertain) {
      await sql`UPDATE webhook_deliveries SET state='UNKNOWN',last_error='SOURCE_DELETED_RESULT_UNKNOWN',lease_until=NULL,lease_token=NULL,completed_at=coalesce(completed_at,clock_timestamp()) WHERE ${tenant(s)} AND id=${delivery.id}::uuid`.execute(tx);
      ++summary.unknownDeliveries; blocked.add(delivery.endpoint_id);
    } else if (delivery.state === 'PENDING' || delivery.state === 'PAUSED_PLAN_LIMIT') {
      await sql`UPDATE webhook_deliveries SET state='FAILED',last_error='SOURCE_DELETED',lease_until=NULL,lease_token=NULL,completed_at=coalesce(completed_at,clock_timestamp()) WHERE ${tenant(s)} AND id=${delivery.id}::uuid`.execute(tx);
      ++summary.stoppedPending;
    }
  }
  for (const id of [...blocked].sort()) { await blockWebhookTarget(tx, s, id); ++summary.blockedEndpoints; }
  await sql`SELECT id FROM operations_domain_events WHERE ${tenant(s)} AND id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`.execute(tx);
  summary.redactedEvents = (await sql`UPDATE operations_domain_events e SET data='{}'::jsonb,dedupe_key='erased:'||id::text,expanded_at=coalesce(expanded_at,created_at)
    WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.id=ANY(${ids}::uuid[]) AND EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.organization_id=e.organization_id AND d.guild_id=e.guild_id AND d.event_id=e.id) RETURNING e.id`.execute(tx)).rows.length;
  summary.deletedEvents = (await sql`DELETE FROM operations_domain_events e WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.id=ANY(${ids}::uuid[])
    AND NOT EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.organization_id=e.organization_id AND d.guild_id=e.guild_id AND d.event_id=e.id) RETURNING e.id`.execute(tx)).rows.length;
  return summary;
}
type Delivery = {
  id: string;
  endpoint_id: string;
  event_id: string;
  secret_version: number;
  attempts: number;
  lease_token: string;
  endpoint_revision: number;
  available_at: string;
  source_expires_at: Date;
};
// Volatile queue-scan progress only: no payload, actor, admission or authority.
// Exact PG timestamps avoid repeatedly selecting the same microsecond prefix.
type WebhookCandidateCursor={availableAt:string;id:string;profile:string;expiresAt:number;timer:ReturnType<typeof setTimeout>};
const webhookCandidateCursors=new Map<string,WebhookCandidateCursor>();
const WEBHOOK_CURSOR_CACHE_MS=5*60*1000;
const webhookScopeKey=(s:Scope)=>s.organizationId+":"+s.guildId;
function removeWebhookCursor(key:string){
  const value=webhookCandidateCursors.get(key);if(value)clearTimeout(value.timer);webhookCandidateCursors.delete(key);
}
function currentWebhookCursor(s:Scope,profile:string,now:Date){
  const key=webhookScopeKey(s),value=webhookCandidateCursors.get(key);
  if(value&&(value.profile!==profile||value.expiresAt<=now.getTime())){removeWebhookCursor(key);return undefined;}
  return value;
}
function advanceWebhookCandidate(s:Scope,candidate:Delivery,profile:string,now:Date){
  const key=webhookScopeKey(s),previous=currentWebhookCursor(s,profile,now);
  const expiresAt=Math.min(previous?.expiresAt??now.getTime()+WEBHOOK_CURSOR_CACHE_MS,candidate.source_expires_at.getTime());
  webhookCandidateCursors.delete(key);
  if(previous&&previous.expiresAt===expiresAt){previous.availableAt=candidate.available_at;previous.id=candidate.id;webhookCandidateCursors.set(key,previous);}
  else {
    if(previous)clearTimeout(previous.timer);
    const timer=setTimeout(()=>{if(webhookCandidateCursors.get(key)?.timer===timer)webhookCandidateCursors.delete(key);},Math.max(1,expiresAt-Date.now()));
    timer.unref();
    webhookCandidateCursors.set(key,{availableAt:candidate.available_at,id:candidate.id,profile,expiresAt,timer});
  }
  while(webhookCandidateCursors.size>10000)removeWebhookCursor(webhookCandidateCursors.keys().next().value!);
}
export interface WebhookDispatchOptions {
  runtime: RuntimeOperatingProfile;
  dispatchPolicy: { approved: true; policyRevision: string; targetLiveSafetyMs: number;
    activationStartedAt: Date;
    independentRetentionEnforcementReady: true; targetWritersCompatible: true };
  /** Authoritative current tombstone/root observation. Database reads only. */
  verifyCurrentSafety(tx: Tx, scope: Scope, endpointId: string, safetyEpoch: string): Promise<boolean>;
}
export class WebhookWorker {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly transport = sendWebhook,
    private readonly options?: WebhookDispatchOptions,
  ) {}
  async tick(s: Scope, _now = new Date()) {
    // Alpha17 G3 must supply adopted runtime/retention and authoritative safety.
    // Missing policy never claims, discards, expands or pauses pending work.
    const options = this.options;
    if (!options) return false;
    try {
      assertRuntimeOperatingProfile(options.runtime);
      assert(options.dispatchPolicy.approved === true && options.dispatchPolicy.policyRevision.length > 0
        && options.dispatchPolicy.independentRetentionEnforcementReady === true
        && options.dispatchPolicy.targetWritersCompatible === true
        && Number.isFinite(options.dispatchPolicy.activationStartedAt?.getTime())
        && Number.isSafeInteger(options.dispatchPolicy.targetLiveSafetyMs)
        && options.dispatchPolicy.targetLiveSafetyMs > 0, "WEBHOOK_DISPATCH_POLICY_UNAPPROVED", 409);
    } catch { return false; }
    const admitted = await this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await privacyReadLock(tx, s);
      await operationsLock(tx, s);
      // Scope/domain locks prevent concurrent configuration creation; acquire
      // all endpoint roots in order before any recovery/delivery row locks.
      await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} ORDER BY id FOR UPDATE`.execute(tx);
      const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      const lost = (await sql<{ id: string; endpoint_id: string }>`SELECT id,endpoint_id FROM webhook_deliveries WHERE ${tenant(s)} AND state='RUNNING' AND lease_until<=${now} ORDER BY endpoint_id,id`.execute(tx)).rows;
      for (const item of lost) {
        await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${item.endpoint_id}::uuid FOR UPDATE`.execute(tx);
        const changed = (await sql`UPDATE webhook_deliveries SET state='UNKNOWN',last_error='LEASE_EXPIRED_RESULT_UNKNOWN',completed_at=coalesce(completed_at,${now}),lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND id=${item.id}::uuid AND state='RUNNING' AND lease_until<=${now} RETURNING id`.execute(tx)).rows.length;
        if (changed) await blockWebhookTarget(tx, s, item.endpoint_id);
      }
      if (!(await new EntitlementService(tx).can(s, "webhooks")) || !(await readOperatorDispatchGate(tx, s, {}, now)).allowed) return null;
      const events = (await sql<{ id: string; event_type: string; created_at: Date }>`SELECT id,event_type,created_at FROM operations_domain_events WHERE ${tenant(s)} AND expanded_at IS NULL AND created_at>=${options.dispatchPolicy.activationStartedAt} AND created_at<=${now} ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`.execute(tx)).rows;
      for (const event of events) {
        // Legacy pending rows have no admission snapshot; never infer one.
        const inserted = (await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,endpoint_id,event_id,secret_version,available_at,endpoint_revision,endpoint_safety_epoch)
          SELECT ${s.organizationId}::uuid,${s.guildId},id,${event.id}::uuid,secret_version,${now},revision,safety_epoch FROM webhook_endpoints WHERE ${tenant(s)} AND state='ENABLED' AND delivery_gate='OPEN' AND safety_expires_at>${now} AND safety_policy_revision=${options.dispatchPolicy.policyRevision} AND ${event.event_type}=ANY(event_types) AND created_at<=${event.created_at} ON CONFLICT DO NOTHING RETURNING id`.execute(tx)).rows.length;
        if (inserted) await sql`UPDATE operations_domain_events SET expanded_at=${now} WHERE ${tenant(s)} AND id=${event.id}::uuid`.execute(tx);
      }
      const scanProfile=createHash("sha256").update(JSON.stringify({runtime:options.runtime,policy:options.dispatchPolicy})).digest("hex");
      const cursor=currentWebhookCursor(s,scanProfile,now),minimumDeadline=new Date(now.getTime()+options.runtime.requestDeadlineMs);
      // Skip known expired/unadopted sources without mutating their queue state.
      // Authoritative per-target rejection is also local to that candidate.
      const candidates = (await sql<Delivery>`SELECT d.id,d.endpoint_id,d.event_id,d.secret_version,d.attempts,d.endpoint_revision,
          to_char(d.available_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS available_at,
          LEAST(e.safety_expires_at,coalesce(k.valid_until,e.safety_expires_at)) AS source_expires_at
        FROM webhook_deliveries d JOIN webhook_endpoints e ON e.organization_id=d.organization_id AND e.guild_id=d.guild_id AND e.id=d.endpoint_id
        JOIN webhook_secrets k ON k.organization_id=d.organization_id AND k.guild_id=d.guild_id AND k.endpoint_id=d.endpoint_id AND k.version=d.secret_version
        JOIN operations_domain_events v ON v.organization_id=d.organization_id AND v.guild_id=d.guild_id AND v.id=d.event_id
        WHERE d.organization_id=${s.organizationId}::uuid AND d.guild_id=${s.guildId} AND d.state='PENDING' AND d.send_admitted_at IS NULL AND d.available_at<=${now}
          AND d.endpoint_revision=e.revision AND d.endpoint_safety_epoch=e.safety_epoch AND e.state='ENABLED' AND e.delivery_gate='OPEN'
          AND e.safety_policy_revision=${options.dispatchPolicy.policyRevision} AND e.safety_expires_at>${minimumDeadline}
          AND e.safety_expires_at<=${new Date(now.getTime()+options.dispatchPolicy.targetLiveSafetyMs)}
          AND (k.valid_until IS NULL OR k.valid_until>${minimumDeadline}) AND v.created_at>=${options.dispatchPolicy.activationStartedAt}
        ORDER BY ${cursor?sql`(d.available_at,d.id)<=(${cursor.availableAt}::timestamptz,${cursor.id}::uuid),`:sql``}d.available_at,d.id LIMIT 100`.execute(tx)).rows;
      for(const candidate of candidates){
      advanceWebhookCandidate(s,candidate,scanProfile,now);
      const endpoint = (await sql<{ url: string; revision: number; safety_epoch: string; delivery_gate: string; safety_expires_at: Date | null; safety_policy_revision: string | null }>`SELECT url,revision,safety_epoch,delivery_gate,safety_expires_at,safety_policy_revision FROM webhook_endpoints WHERE ${tenant(s)} AND id=${candidate.endpoint_id}::uuid AND state='ENABLED' FOR UPDATE`.execute(tx)).rows[0];
      if (!endpoint || endpoint.revision !== candidate.endpoint_revision || endpoint.delivery_gate !== 'OPEN'
        || endpoint.safety_policy_revision !== options.dispatchPolicy.policyRevision || !endpoint.safety_expires_at
        || endpoint.safety_expires_at <= now || endpoint.safety_expires_at.getTime() > now.getTime() + options.dispatchPolicy.targetLiveSafetyMs
        ) continue;
      if (!(await options.verifyCurrentSafety(tx, s, candidate.endpoint_id, endpoint.safety_epoch))) continue;
      const delivery = (await sql`SELECT id FROM webhook_deliveries WHERE ${tenant(s)} AND id=${candidate.id}::uuid AND state='PENDING' AND endpoint_revision=${endpoint.revision} AND endpoint_safety_epoch=${endpoint.safety_epoch}::bigint FOR UPDATE`.execute(tx)).rows[0];
      if (!delivery) continue;
      const data = (await sql<{ secret_ciphertext: string; valid_until: Date | null; event_type: string; data: Record<string, unknown>; created_at: Date }>`SELECT k.secret_ciphertext,k.valid_until,v.event_type,v.data,v.created_at FROM webhook_secrets k JOIN operations_domain_events v ON v.organization_id=k.organization_id AND v.guild_id=k.guild_id AND v.id=${candidate.event_id}::uuid WHERE k.organization_id=${s.organizationId}::uuid AND k.guild_id=${s.guildId} AND k.endpoint_id=${candidate.endpoint_id}::uuid AND k.version=${candidate.secret_version}`.execute(tx)).rows[0];
      if (!data || data.valid_until && data.valid_until <= now) continue;
      const playbook = (await sql<{ id: string }>`SELECT id FROM playbook_action_runs WHERE ${tenant(s)} AND delivery_id=${candidate.id}::uuid`.execute(tx)).rows[0];
      const report = (await sql<{ id: string }>`SELECT id FROM report_runs WHERE ${tenant(s)} AND delivery_id=${candidate.id}::uuid`.execute(tx)).rows[0];
      if (playbook) await deliveryFence(tx, s, 'PLAYBOOK', playbook.id);
      if (report) await deliveryFence(tx, s, 'REPORT', report.id);
      const entitled = await new EntitlementService(tx).effective(s);
      const position = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM webhook_endpoints WHERE ${tenant(s)} AND state='ENABLED' AND (created_at,id)<=(SELECT created_at,id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${candidate.endpoint_id}::uuid)`.execute(tx)).rows[0]!.n;
      if (entitled.limits.webhooks !== null && position > entitled.limits.webhooks) continue;
      outboundUrl(endpoint.url);
      const body = JSON.stringify({ id: candidate.event_id, type: data.event_type, createdAt: data.created_at.toISOString(), scope: s, data: data.data });
      assert(Buffer.byteLength(body) <= 512 * 1024, 'WEBHOOK_PAYLOAD_TOO_LARGE', 413);
      const timestamp = String(Math.floor(now.getTime() / 1000)), leaseToken = randomUUID();
      const headers = { 'Nexus-Delivery-Id': candidate.id, 'Nexus-Timestamp': timestamp,
        'Nexus-Signature': webhookSignature(this.vault.open(s, data.secret_ciphertext), timestamp, candidate.id, body), 'Nexus-Key-Version': String(candidate.secret_version) };
      const checkedAt = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      const deadline = new Date(checkedAt.getTime() + options.runtime.requestDeadlineMs);
      if (!(await readOperatorDispatchGate(tx, s, {}, checkedAt)).allowed) return null;
      if (endpoint.safety_expires_at <= deadline || data.valid_until && data.valid_until <= deadline) continue;
      await sql`UPDATE webhook_deliveries SET state='RUNNING',attempts=attempts+1,send_admitted_at=${checkedAt},request_deadline_at=${deadline},lease_until=${new Date(checkedAt.getTime() + options.runtime.leaseMs)},lease_token=${leaseToken}::uuid WHERE ${tenant(s)} AND id=${candidate.id}::uuid AND state='PENDING'`.execute(tx);
      return { ...candidate, lease_token: leaseToken, url: endpoint.url, body, headers, deadline };
      }
      return null;
    });
    if (!admitted) return false;
    // Admission has committed. No transaction retry callback can POST.
    let status: number | null = null, error: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      assert(admitted.deadline.getTime() > Date.now(), 'WEBHOOK_TIMEOUT', 409);
      status = await Promise.race([this.transport(admitted.url, admitted.body, admitted.headers),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('WEBHOOK_TIMEOUT')), Math.max(1, admitted.deadline.getTime() - Date.now())); })]);
      assert(Number.isInteger(status) && status >= 100 && status <= 599, 'WEBHOOK_INVALID_RESPONSE', 409);
      if (status < 200 || status >= 300) error = 'HTTP_' + status;
    } catch (reason) {
      error = isDomainError(reason) ? reason.code : reason instanceof Error && /timeout/i.test(reason.message) ? 'TIMEOUT' : 'NETWORK_FAILURE';
    } finally { clearTimeout(timer); }
    await this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await privacyReadLock(tx, s); await operationsLock(tx, s);
      await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)} AND id=${admitted.endpoint_id}::uuid FOR UPDATE`.execute(tx);
      const changed = (await sql<{ state: string }>`UPDATE webhook_deliveries SET state=CASE WHEN ${Boolean(error)} OR request_deadline_at<=clock_timestamp() THEN 'UNKNOWN' ELSE 'SUCCEEDED' END,last_status=${status},last_error=CASE WHEN request_deadline_at<=clock_timestamp() THEN 'DEADLINE_EXPIRED_RESULT_UNKNOWN' ELSE ${error} END,lease_until=NULL,lease_token=NULL,completed_at=coalesce(completed_at,clock_timestamp()) WHERE ${tenant(s)} AND id=${admitted.id}::uuid AND state='RUNNING' AND lease_token=${admitted.lease_token}::uuid RETURNING state`.execute(tx)).rows[0];
      // Late results cannot overwrite recovery's UNKNOWN or reopen a root.
      if (!changed || changed.state === 'UNKNOWN') await blockWebhookTarget(tx, s, admitted.endpoint_id);
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
