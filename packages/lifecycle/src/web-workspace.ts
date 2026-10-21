import {createHash, randomUUID} from "node:crypto";
import {z} from "zod";
import {sql, tenant, json, type Database, type Tx} from "../../db/src/index";
import {assert, type Scope} from "../../shared/src/index";
import {SettingsService, type Actor} from "../../settings/src/index";
import {domainRevisions} from "../../settings/src/domain-config";
import {EntitlementService} from "../../settings/src/billing/index";
import {operationsAccess} from "../../operations/src/policy";
import {assertMaintenanceAuthorization, type MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import {canAdmin, canOperatePanel} from "../../security/src/index";
import {acquireRuleScopeLocks, ruleScopeLockSet} from "../../rules/src/locks";
import type {DiscordPort} from "../../discord/src/rest";
import {ExperimentService, experimentSchema} from "./experiments";
import {InterventionService, interventionSchema, type InterventionDefinition} from "./interventions";
import {cancelInterventionRun} from "./intervention-control";

export type LifecycleDomain = "experiment" | "intervention";
export interface LifecycleWebRequestPolicy {revision: string; seconds: number; purposeReference: string;}
/** A request identity is a new retained purpose, not a Fact or suggestion log. */
export const LIFECYCLE_WEB_REQUEST_POLICY: LifecycleWebRequestPolicy | undefined = undefined;
export function boundedLifecycleStructure(value: unknown) {
  const pending = [{value, depth: 0}]; let count = 0;
  while (pending.length) {const item = pending.pop()!; if (++count > 2000 || item.depth > 16) return false; if (item.value && typeof item.value === "object") for (const child of Object.values(item.value)) pending.push({value: child, depth: item.depth + 1});}
  return true;
}
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const lifecycleWebMutation = z.discriminatedUnion("operation", [
  z.object({operation: z.literal("DRAFT"), domain: z.enum(["experiment", "intervention"]), definition: z.unknown(), sourceRevisionId: uuid.optional(), sourceHash: hash.optional()}).strict(),
  z.object({operation: z.literal("PUBLISH"), domain: z.enum(["experiment", "intervention"]), revisionId: uuid, expectedHead: uuid.nullable(), confirmationHash: hash}).strict(),
  z.object({operation: z.literal("EXPERIMENT_CONTROL"), domain: z.literal("experiment"), revisionId: uuid, expectedState: z.enum(["running", "paused", "stopped"]), state: z.enum(["running", "paused", "stopped"])}).strict(),
  z.object({operation: z.literal("EVALUATE_RESULT"), domain: z.literal("experiment"), revisionId: uuid}).strict(),
  z.object({operation: z.literal("INTERVENTION_APPROVE"), domain: z.literal("intervention"), runId: uuid, expectedState: z.enum(["suggested", "approval"])}).strict(),
  z.object({operation:z.literal("INTERVENTION_CANCEL"),domain:z.literal("intervention"),runId:uuid,expectedState:z.enum(["suggested","approval","queued"])}).strict(),
  z.object({operation: z.literal("INTERVENTION_SWITCH"), domain: z.literal("intervention"), expectedSettingsRevision: z.number().int().positive(), enabled: z.boolean()}).strict(),
]).superRefine((value, ctx) => {
  if (value.operation === "DRAFT" && (value.sourceRevisionId === undefined) !== (value.sourceHash === undefined)) ctx.addIssue({code: "custom", message: "Source revision and hash must be paired"});
  if (value.operation === "DRAFT" && (!boundedLifecycleStructure(value.definition) || !(value.domain === "experiment" ? experimentSchema : interventionSchema).safeParse(value.definition).success)) ctx.addIssue({code: "custom", message: "Invalid domain definition"});
});
export type LifecycleWebMutation = z.infer<typeof lifecycleWebMutation>;
export function lifecycleRequestFingerprint(input: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sorted(child)])) : value;
  return createHash("sha256").update(JSON.stringify(sorted(input))).digest("hex");
}
export function lifecycleRequestExpiry(policy: LifecycleWebRequestPolicy | undefined, now: Date) {
  assert(policy?.revision && policy.purposeReference && Number.isSafeInteger(policy.seconds) && policy.seconds > 0, "LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED", 409);
  const end = new Date(now.getTime() + policy.seconds * 1000); assert(Number.isFinite(end.getTime()), "LIFECYCLE_REQUEST_POLICY_INVALID"); return end;
}
interface RequestRow {state: "PREPARED" | "CLAIMED" | "COMPLETED"; domain: LifecycleDomain; operation: string; fingerprint: string; result: Record<string, unknown> | null; expires_at: Date;}
interface InterventionSeal {revisionId: string; revisionHash: string; definitionHash: string; definition: InterventionDefinition; runId: string | null; targets: string[];}
interface InterventionProbe {scope: Scope; actorHash: string; intentFingerprint: string; seal: InterventionSeal; observedAt: Date; expiresAt: Date; checkedTargets: string[];}
type Access = (tx: Tx, scope: Scope, actor: Actor, permission: "READ" | "CONFIGURE") => Promise<unknown>;
export class LifecycleWebWorkspace {
  readonly revisions;
  readonly experiments;
  readonly interventions;
  readonly settings;
  private readonly access: Access;
  constructor(readonly db: Database, readonly options: {policy?: LifecycleWebRequestPolicy; authorization?: MaintenanceAuthorizationProof; discord?: DiscordPort; authorize?: Access} = {}) {
    this.revisions = domainRevisions(db); this.experiments = new ExperimentService(db); this.interventions = new InterventionService(db); this.settings = new SettingsService(db);
    this.access = options.authorize ?? ((tx, scope, actor, permission) => operationsAccess(tx, scope, actor, permission));
  }
  private currentAuthorization(scope: Scope, actor: Actor) {assertMaintenanceAuthorization(this.options.authorization, scope, actor);}
  private async transaction<T>(scope: Scope, actor: Actor, write: boolean, work: (tx: Tx, now: Date) => Promise<T>) {
    assert(actor.source === "WEB_DASHBOARD" || actor.source === "DISCORD_PANEL", "CURRENT_USER_REQUIRED", 403);
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
      this.currentAuthorization(scope, actor);
      await this.access(tx, scope, actor, write ? "CONFIGURE" : "READ");
      assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
      const cfg = await this.settings.get(scope, tx);
      if (write) assert((actor.source === "DISCORD_PANEL" ? canOperatePanel : canAdmin)(actor.permissions, actor.roles, [cfg.adminRoleId, ...cfg.managerRoleIds]), "ADMIN_REQUIRED", 403);
      const now = (await sql<{now: Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      this.currentAuthorization(scope, actor);
      const result = await work(tx, now);
      this.currentAuthorization(scope, actor);
      return result;
    });
  }
  async catalog(scope: Scope, actor: Actor, domain: LifecycleDomain) {
    return this.transaction(scope, actor, false, async (tx, now) => {
      const revisions = (await sql<{id: string; version: number; definition: unknown; state: string; hash: string; published_at: Date | null}>`SELECT id,version,definition,state,hash,published_at FROM guild_config_revisions WHERE ${tenant(scope)} AND domain=${domain} ORDER BY version DESC LIMIT 100`.execute(tx)).rows;
      const head = (await sql<{revision_id: string}>`SELECT revision_id FROM guild_config_heads WHERE ${tenant(scope)} AND domain=${domain}`.execute(tx)).rows[0]?.revision_id ?? null;
      const cfg = await this.settings.get(scope, tx), entitlements = new EntitlementService(tx);
      const feature = await entitlements.can(scope, domain === "experiment" ? "experiments" : "interventions");
      const controls = domain === "experiment" ? (await sql<{revision_id: string; state: string}>`SELECT revision_id,state FROM experiment_controls WHERE ${tenant(scope)}`.execute(tx)).rows : [];
      const runs = domain === "intervention" ? (await sql<{id: string; revision_id: string; state: string; reason: string | null; created_at: Date; delivered_at: Date | null;can_cancel:boolean}>`SELECT r.id,r.revision_id,r.state,r.reason,r.created_at,r.delivered_at,(r.state IN ('suggested','approval','queued') AND r.attempts=0 AND NOT EXISTS(SELECT 1 FROM action_outbox a WHERE a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.kind='INTERVENTION_DELIVER' AND a.payload->>'runId'=r.id::text AND (a.state<>'PENDING' OR a.attempts<>0 OR a.operation_phase IS NOT NULL))) AS can_cancel FROM intervention_runs r WHERE r.organization_id=${scope.organizationId}::uuid AND r.guild_id=${scope.guildId} ORDER BY r.created_at DESC,r.id LIMIT 100`.execute(tx)).rows : [];
      const results = domain === "experiment" && await entitlements.can(scope, "improvement_tracking") ? (await sql<{revision_id: string; computed_at: Date; result: Record<string, unknown>}>`SELECT DISTINCT ON (revision_id) revision_id,computed_at,result FROM experiment_metric_results WHERE ${tenant(scope)} ORDER BY revision_id,computed_at DESC LIMIT 100`.execute(tx)).rows : [];
      let requestPolicy = true; try {lifecycleRequestExpiry(this.options.policy, now);} catch {requestPolicy = false;}
      return {domain, revisions, head, controls, runs, results, settingsRevision: cfg.revision, enabled: domain === "experiment" ? cfg.flags.experiments_v2 : cfg.flags.interventions_v2,
        canMutate: (actor.source === "DISCORD_PANEL" ? canOperatePanel : canAdmin)(actor.permissions, actor.roles, [cfg.adminRoleId, ...cfg.managerRoleIds]),
        featureAvailable: feature, canEvaluateResult: await entitlements.can(scope, "improvement_tracking"),
        readiness: {enabled: requestPolicy, reasonCodes: requestPolicy ? [] : ["LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED"]},
        runCancellation: {enabled:requestPolicy,preAdmissionOnly:true,reasonCode:requestPolicy?null:"LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED"}, observedAt: now.toISOString()};
    });
  }
  async preview(scope: Scope, actor: Actor, domain: LifecycleDomain, id: string) {
    uuid.parse(id); return this.transaction(scope, actor, false, async () => {
      const preview = await this.revisions.preview(scope, id); assert(preview.after.domain === domain, "REVISION_NOT_FOUND", 404); return preview;
    });
  }
  private async validate(scope: Scope, input: LifecycleWebMutation, tx: Tx): Promise<InterventionSeal | null> {
    if (input.operation === "DRAFT") {
      await new EntitlementService(tx).require(scope, input.domain === "experiment" ? "experiments" : "interventions");
      if (input.sourceRevisionId) {const source = await this.revisions.get(scope, input.sourceRevisionId, tx); assert(source.domain === input.domain && source.hash === input.sourceHash, "REVISION_CONFLICT", 409);}
      if (input.domain === "experiment") await this.validateExperiment(scope, input.definition, tx);
      return null;
    }
    if (input.operation === "INTERVENTION_SWITCH") {const cfg = await this.settings.get(scope, tx); assert(cfg.revision === input.expectedSettingsRevision, "REVISION_CONFLICT", 409); if (input.enabled) await new EntitlementService(tx).require(scope, "interventions"); return null;}
    if(input.operation==='INTERVENTION_CANCEL'){
      const run=(await sql<{state:string;attempts:number}>`SELECT state,attempts FROM intervention_runs WHERE ${tenant(scope)} AND id=${input.runId}::uuid`.execute(tx)).rows[0];
      assert(run&&run.state===input.expectedState,'RUN_STATE_CONFLICT',412);assert(run.attempts===0,'INTERVENTION_ALREADY_ADMITTED',409);return null;
    }
    if (input.operation === "INTERVENTION_APPROVE") {
      const row = (await sql<{state: string; revision_id: string}>`SELECT state,revision_id FROM intervention_runs WHERE ${tenant(scope)} AND id=${input.runId}::uuid`.execute(tx)).rows[0];
      assert(row && row.state === input.expectedState, "RUN_STATE_CONFLICT", 409); await new EntitlementService(tx).require(scope, "interventions");
      return this.sealIntervention(scope, await this.revisions.get(scope, row.revision_id, tx), tx, input.runId);
    }
    const revision = await this.revisions.get(scope, input.revisionId, tx); assert(revision.domain === input.domain, "REVISION_NOT_FOUND", 404);
    if (input.operation === "PUBLISH") {
      assert(revision.state === "draft" && revision.hash === input.confirmationHash, "PREVIEW_REQUIRED", 409);
      assert((await this.revisions.current(scope, input.domain, tx))?.id === input.expectedHead || input.expectedHead === null && !(await this.revisions.current(scope, input.domain, tx)), "REVISION_CONFLICT", 409);
      await new EntitlementService(tx).require(scope, input.domain === "experiment" ? "experiments" : "interventions");
      if (input.domain === "intervention") return this.sealIntervention(scope, revision, tx);
      else await this.validateExperiment(scope, revision.definition, tx);
    } else {
      assert(revision.state === "published", "EXPERIMENT_NOT_PUBLISHED");
      if (input.operation === "EVALUATE_RESULT" || input.state === "running") await new EntitlementService(tx).require(scope, "improvement_tracking");
      if (input.operation === "EXPERIMENT_CONTROL") {
        const state = (await sql<{state: string}>`SELECT state FROM experiment_controls WHERE ${tenant(scope)} AND revision_id=${input.revisionId}::uuid`.execute(tx)).rows[0]?.state ?? "running";
        assert(state === input.expectedState, "EXPERIMENT_STATE_CONFLICT", 409); assert(state !== "stopped" || input.state === "stopped", "STOPPED_EXPERIMENT_IMMUTABLE", 409);
      }
    }
    return null;
  }
  private async validateExperiment(scope: Scope, raw: unknown, tx: Tx) {
    const definition = experimentSchema.parse(raw);
    for (const variant of definition.variants) if (variant.interventionRevisionId) {
      const revision = await this.revisions.get(scope, variant.interventionRevisionId, tx);
      assert(revision.domain === "intervention" && revision.state === "published", "INTERVENTION_NOT_PUBLISHED", 409);
      interventionSchema.parse(revision.definition);
    }
  }
  private async sealIntervention(scope: Scope, revision: {id: string; domain: string; hash: string; definition: unknown}, tx: Tx, runId?: string): Promise<InterventionSeal> {
    assert(revision.domain === "intervention", "REVISION_NOT_FOUND", 404);
    const definition = interventionSchema.parse(revision.definition);
    await new EntitlementService(tx).require(scope, "interventions");
    if (definition.safetyMode === "auto") await new EntitlementService(tx).require(scope, "automation_auto");
    const targets = new Set<string>();
    for (const action of definition.actions) {
      if ("channelId" in action) targets.add(`CHANNEL:${action.channelId}`);
      if (action.type === "recommend_channels") for (const id of action.channels) targets.add(`CHANNEL:${id}`);
      if ("roleId" in action) targets.add(`ROLE:${action.roleId}`);
      if (action.type === "recommend_event") targets.add(`EVENT:${action.eventId}`);
    }
    return {revisionId: revision.id, revisionHash: revision.hash, definitionHash: lifecycleRequestFingerprint(definition), definition: structuredClone(definition), runId: runId ?? null, targets: [...targets].sort()};
  }
  /** No transaction or database lock is held while these existing external
   * checks run. This receipt is memory-only and bound to the original proof. */
  private async probeIntervention(scope: Scope, actor: Actor, input: LifecycleWebMutation, seal: InterventionSeal | null): Promise<InterventionProbe | null> {
    if (!seal) return null;
    this.currentAuthorization(scope, actor);
    const discord = this.options.discord; assert(discord, "DISCORD_UNAVAILABLE", 503);
    const checkedTargets: string[] = [];
    for (const target of seal.targets) {
      this.currentAuthorization(scope, actor);
      const separator = target.indexOf(":"), kind = target.slice(0, separator), id = target.slice(separator + 1);
      if (kind === "CHANNEL") await discord.checkChannel(scope.guildId, id);
      else if (kind === "ROLE") await discord.validateRole(scope.guildId, id);
      else {assert(kind === "EVENT" && discord.options, "DISCORD_UNAVAILABLE", 503); assert((await discord.options(scope.guildId)).events.some((event) => event.id === id), "EVENT_NOT_AVAILABLE");}
      this.currentAuthorization(scope, actor); checkedTargets.push(target);
    }
    return {scope: {...scope}, actorHash: actor.key, intentFingerprint: lifecycleRequestFingerprint(input), seal: structuredClone(seal), observedAt: new Date(), expiresAt: new Date(this.options.authorization!.expiresAt.getTime()), checkedTargets};
  }
  private assertInterventionProbe(scope: Scope, actor: Actor, input: LifecycleWebMutation, current: InterventionSeal | null, probe: InterventionProbe | null) {
    this.currentAuthorization(scope, actor);
    if (!current) {assert(probe === null, "INTERVENTION_PROBE_MISMATCH", 409); return;}
    assert(probe && probe.scope.organizationId === scope.organizationId && probe.scope.guildId === scope.guildId && probe.actorHash === actor.key && probe.intentFingerprint === lifecycleRequestFingerprint(input), "INTERVENTION_PROBE_MISMATCH", 409);
    const now = new Date();
    assert(probe.observedAt <= now && probe.expiresAt > now && probe.expiresAt.getTime() === this.options.authorization!.expiresAt.getTime(), "CURRENT_AUTHORIZATION_REQUIRED", 403);
    assert(current.revisionId === probe.seal.revisionId && current.revisionHash === probe.seal.revisionHash && current.definitionHash === probe.seal.definitionHash && current.runId === probe.seal.runId && lifecycleRequestFingerprint(current.targets) === lifecycleRequestFingerprint(probe.checkedTargets) && lifecycleRequestFingerprint(current.targets) === lifecycleRequestFingerprint(probe.seal.targets), "INTERVENTION_PROBE_MISMATCH", 409);
  }
  /** Native callbacks may run after their own intended state transition. Check
   * immutable source/target identity here without repeating the former state. */
  private async currentInterventionSeal(scope: Scope, input: LifecycleWebMutation, tx: Tx): Promise<InterventionSeal | null> {
    if (input.operation === "PUBLISH" && input.domain === "intervention") return this.sealIntervention(scope, await this.revisions.get(scope, input.revisionId, tx), tx);
    if (input.operation === "INTERVENTION_APPROVE") {
      const row = (await sql<{revision_id: string}>`SELECT revision_id FROM intervention_runs WHERE ${tenant(scope)} AND id=${input.runId}::uuid`.execute(tx)).rows[0];
      assert(row, "RUN_STATE_CONFLICT", 409); return this.sealIntervention(scope, await this.revisions.get(scope, row.revision_id, tx), tx, input.runId);
    }
    return null;
  }
  async prepare(scope: Scope, actor: Actor, raw: unknown) {
    const input = lifecycleWebMutation.parse(raw);
    const sealed = await this.transaction(scope, actor, true, async (tx, now) => {lifecycleRequestExpiry(this.options.policy, now); return this.validate(scope, input, tx);});
    const probe = await this.probeIntervention(scope, actor, input, sealed);
    return this.transaction(scope, actor, true, async (tx, now) => {
      const end = lifecycleRequestExpiry(this.options.policy, now), current = await this.validate(scope, input, tx); this.assertInterventionProbe(scope, actor, input, current, probe); const key = randomUUID();
      this.currentAuthorization(scope, actor);
      await sql`INSERT INTO lifecycle_web_requests(organization_id,guild_id,id,actor_hash,domain,operation,fingerprint,state,created_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${key}::uuid,${actor.key},${input.domain},${input.operation},${lifecycleRequestFingerprint(input)},'PREPARED',${now},${end})`.execute(tx);
      return {key, expiresAt: end.toISOString(), purpose: "LIFECYCLE_WEB_MUTATION"};
    });
  }
  async requestStatus(scope: Scope, actor: Actor, domain: LifecycleDomain, key: string) {
    uuid.parse(key); return this.transaction(scope, actor, true, async (tx, now) => {
      const row = (await sql<RequestRow>`SELECT * FROM lifecycle_web_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} AND domain=${domain}`.execute(tx)).rows[0]; assert(row && row.expires_at > now, "LIFECYCLE_REQUEST_GONE", 410);
      return {state: row.state === "COMPLETED" ? "COMPLETED" : row.state === "PREPARED" ? "NOT_STARTED" : "UNKNOWN", result: row.result};
    });
  }
  async mutate(scope: Scope, actor: Actor, key: string, raw: unknown) {
    uuid.parse(key); const input = lifecycleWebMutation.parse(raw);
    const preflight = await this.transaction(scope, actor, true, async (tx, now) => {
      lifecycleRequestExpiry(this.options.policy, now);
      const row = (await sql<RequestRow>`SELECT * FROM lifecycle_web_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
      assert(row && row.expires_at > now, "LIFECYCLE_REQUEST_GONE", 410); assert(row.domain === input.domain && row.operation === input.operation && row.fingerprint === lifecycleRequestFingerprint(input), "LIFECYCLE_REQUEST_MISMATCH", 409);
      if (row.state === "COMPLETED") return {completed: true as const, result: row.result!, seal: null};
      assert(row.state === "PREPARED", "LIFECYCLE_RESULT_UNKNOWN", 409);
      return {completed: false as const, result: null, seal: await this.validate(scope, input, tx)};
    });
    if (preflight.completed) return preflight.result;
    // CLAIMED/UNKNOWN was rejected above. Wire retries never trigger another
    // external probe or another native operation for an already claimed key.
    const probe = await this.probeIntervention(scope, actor, input, preflight.seal);
    const claim = await this.transaction(scope, actor, true, async (tx, now) => {
      lifecycleRequestExpiry(this.options.policy, now);
      const row = (await sql<RequestRow>`SELECT * FROM lifecycle_web_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
      assert(row && row.expires_at > now, "LIFECYCLE_REQUEST_GONE", 410); assert(row.domain === input.domain && row.operation === input.operation && row.fingerprint === lifecycleRequestFingerprint(input), "LIFECYCLE_REQUEST_MISMATCH", 409);
      if (row.state === "COMPLETED") return {completed: true as const, result: row.result!};
      assert(row.state === "PREPARED", "LIFECYCLE_RESULT_UNKNOWN", 409); const current = await this.validate(scope, input, tx); this.assertInterventionProbe(scope, actor, input, current, probe);
      this.currentAuthorization(scope, actor);
      await sql`UPDATE lifecycle_web_requests SET state='CLAIMED' WHERE ${tenant(scope)} AND id=${key}::uuid`.execute(tx); return {completed: false as const, result: null};
    });
    if (claim.completed) return claim.result;
    let committedResult: Record<string, unknown> | undefined;
    try {
      await this.transaction(scope, actor, true, async (tx, now) => {
      const current = await this.validate(scope, input, tx); this.assertInterventionProbe(scope, actor, input, current, probe);
      const claimed = (await sql<RequestRow>`SELECT * FROM lifecycle_web_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
      assert(claimed && claimed.expires_at > now && claimed.state === "CLAIMED", "LIFECYCLE_REQUEST_GONE", 410);
      });
      const beforeWrite = async (tx: Tx) => {
        this.currentAuthorization(scope, actor);
        await this.access(tx, scope, actor, "CONFIGURE");
        assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
        this.assertInterventionProbe(scope, actor, input, await this.currentInterventionSeal(scope, input, tx), probe);
        this.currentAuthorization(scope, actor);
      };
      // Existing domain services remain the only runtime. A claimed operation
      // is never re-issued after an uncertain result, even if the wire retries.
      let result: Record<string, unknown>;
      if (input.operation === "DRAFT") result = {revisionId: await this.revisions.draft(scope, actor, input.domain, input.definition, beforeWrite), state: "draft"};
      else if (input.operation === "PUBLISH") {await this.revisions.publish(scope, actor, input.revisionId, input.expectedHead, input.confirmationHash, beforeWrite); result = {revisionId: input.revisionId, state: "published"};}
      else if (input.operation === "EXPERIMENT_CONTROL") {await this.experiments.control(scope, actor, input.revisionId, input.state, input.expectedState, beforeWrite); result = {revisionId: input.revisionId, state: input.state};}
      else if (input.operation === "EVALUATE_RESULT") {await this.experiments.result(scope, input.revisionId, new Date(), beforeWrite); result = {revisionId: input.revisionId, state: "RESULT_EVALUATED"};}
      else if (input.operation === "INTERVENTION_APPROVE") {await this.interventions.approve(scope, actor, input.runId, input.expectedState, beforeWrite); result = {runId: input.runId, state: "queued"};}
      else if(input.operation==='INTERVENTION_CANCEL')result=await cancelInterventionRun(this.db,scope,actor,{runId:input.runId,expectedState:input.expectedState},this.options.authorization,beforeWrite);
      else {const cfg = await this.settings.get(scope); const next = await this.settings.update(scope, actor, input.expectedSettingsRevision, {flags: {...cfg.flags, interventions_v2: input.enabled}}, beforeWrite); result = {settingsRevision: next.revision, enabled: next.flags.interventions_v2};}
      committedResult = result;
      await this.transaction(scope, actor, true, async (tx, now) => {
        const claimed = (await sql<RequestRow>`SELECT * FROM lifecycle_web_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
        assert(claimed && claimed.state === "CLAIMED" && claimed.expires_at > now, "LIFECYCLE_REQUEST_GONE", 410);
        await beforeWrite(tx);
        await sql`UPDATE lifecycle_web_requests SET state='COMPLETED',result=${json(result)} WHERE ${tenant(scope)} AND id=${key}::uuid`.execute(tx);
      });
      return result;
    } catch {
      // A separate legacy transaction has already returned its committed
      // result. An expired proof may prevent the receipt write; it is not a
      // reason to deny that known success or resend the effect.
      if (committedResult) return {...committedResult, requestRecorded: false};
      assert(false, "LIFECYCLE_RESULT_UNKNOWN", 409);
    }
  }
}
export async function purgeLifecycleWebActor(tx: Tx, scope: Scope, actorHash: string) {await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope)); await sql`DELETE FROM lifecycle_web_requests WHERE ${tenant(scope)} AND actor_hash=${actorHash}`.execute(tx);}
export async function purgeLifecycleWebGuild(tx: Tx, scope: Scope) {await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope)); await sql`DELETE FROM lifecycle_web_requests WHERE ${tenant(scope)}`.execute(tx);}
export async function purgeExpiredLifecycleWeb(tx: Tx, scope: Scope, now: Date) {await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope)); await sql`DELETE FROM lifecycle_web_requests WHERE ${tenant(scope)} AND expires_at<=${now}`.execute(tx);}
