import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { json, sql, tenant, type Database, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { AutomationService, type AutomationServiceOptions } from "../../automation/src/service";
import type { FlowDefinition } from "../../automation/src/types";
import { validateFlowDefinition } from "../../automation/src/definition";
import { scratchNumericOptions } from "../../automation/src/scratch-math-server";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { operationsAccess, type OperationPermission } from "./policy";
import { assertMaintenanceAuthorization, type MaintenanceAuthorizationProof } from "./maintenance-authorization";

export const personalizationClasses = ["TEMPLATE_DEFINITION", "PERSONAL_PREFERENCE", "PERSONALIZATION_REQUEST"] as const;
export type PersonalizationClass = typeof personalizationClasses[number];
export interface PersonalizationPolicy {
  revision: string;
  classes: Partial<Record<PersonalizationClass, {seconds: number; approvalReference: string}>>;
}
/** There is intentionally no operational default lifetime for these purposes. */
export const PERSONALIZATION_POLICY: PersonalizationPolicy | undefined = undefined;
export const preferenceSettings = z.object({
  suggestionDisplay: z.enum(["SHOW", "HIDE"]),
  personalNotifications: z.enum(["UNCHANGED", "MUTED"]),
}).strict();
export type PreferenceSettings = z.infer<typeof preferenceSettings>;
export const DEFAULT_PERSONAL_PREFERENCES: Readonly<PreferenceSettings> = Object.freeze({suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"});
// eslint-disable-next-line no-control-regex -- Deliberately reject ASCII control characters in bounded identifiers.
const name = z.string().trim().min(1).max(80).refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const flowId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const version = z.number().int().min(1).max(2147483647);
const baseVersion = z.number().int().min(0).max(2147483647);
export const personalizationMutation = z.discriminatedUnion("operation", [
  z.object({operation: z.literal("TEMPLATE_CREATE"), name, sourceFlowId: flowId, sourceRevision: version}).strict(),
  z.object({operation: z.literal("TEMPLATE_UPDATE"), templateId: z.uuid(), expectedVersion: version, name, sourceFlowId: flowId.optional(), sourceRevision: version.optional()}).strict().refine((value) => (value.sourceFlowId === undefined) === (value.sourceRevision === undefined)),
  z.object({operation: z.literal("TEMPLATE_COPY"), templateId: z.uuid(), expectedVersion: version, name}).strict(),
  z.object({operation: z.literal("TEMPLATE_DELETE"), templateId: z.uuid(), expectedVersion: version}).strict(),
  z.object({operation: z.literal("TEMPLATE_DRAFT"), templateId: z.uuid(), expectedVersion: version, draftName: name}).strict(),
  z.object({operation: z.literal("PREFERENCE_SAVE"), expectedVersion: baseVersion, settings: preferenceSettings}).strict(),
  z.object({operation: z.literal("PREFERENCE_RESET"), expectedVersion: baseVersion}).strict(),
]);
export type PersonalizationMutation = z.infer<typeof personalizationMutation>;
type Access = (tx: Tx, scope: Scope, actor: Actor, permission: OperationPermission) => Promise<unknown>;
interface TemplateRow {id: string; version: number; name: string | null; state: "ACTIVE" | "DELETED"; created_at: Date; updated_at: Date; expires_at: Date;}
interface RevisionRow {version: number; definition: FlowDefinition; definition_hash: string; source_flow_id: string | null; source_revision: number | null; created_at: Date; expires_at: Date;}
interface PreferenceRow {version: number; settings: PreferenceSettings | null; state: "ACTIVE" | "RESET"; updated_at: Date; expires_at: Date;}
interface RequestRow {id: string; actor_hash: string; operation: string; fingerprint: string; resource_id: string | null; state: "PREPARED" | "COMPLETED"; result: Record<string, string | number | boolean | null> | null; expires_at: Date;}
function canonical(value: unknown): string {
  const visit = (item: unknown): unknown => Array.isArray(item) ? item.map(visit) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, visit(child)])) : item;
  return JSON.stringify(visit(value));
}
export const personalizationFingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function personalizationExpiry(policy: PersonalizationPolicy | undefined, purpose: PersonalizationClass, now: Date, ceiling?: Date) {
  const rule = policy?.classes[purpose];
  assert(policy?.revision && rule && Number.isSafeInteger(rule.seconds) && rule.seconds > 0 && rule.approvalReference, "PERSONALIZATION_RETENTION_UNCONFIGURED", 409);
  const expiry = new Date(now.getTime() + rule.seconds * 1000);
  assert(Number.isFinite(expiry.getTime()), "PERSONALIZATION_POLICY_INVALID");
  return ceiling && ceiling < expiry ? ceiling : expiry;
}
export function assertTemplateHasNoCredentials(value: unknown) {
  const inspect = (item: unknown, depth: number) => {
    assert(depth <= 32, "TEMPLATE_DEFINITION_LIMIT");
    if (typeof item === "string") assert(!/^Bearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----|https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(item), "TEMPLATE_CREDENTIAL_FORBIDDEN");
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      assert(!/^(?:authorization|password|secret|apiKey|accessToken|refreshToken|credential|webhookUrl)$/i.test(key), "TEMPLATE_CREDENTIAL_FORBIDDEN");
      inspect(child, depth + 1);
    }
  };
  inspect(value, 0);
}

export class PersonalizationService {
  private readonly access: Access;
  constructor(readonly db: Database, readonly options: {policy?: PersonalizationPolicy; authorization?: MaintenanceAuthorizationProof; authorize?: Access; automation?: AutomationServiceOptions} = {}) {
    this.access = options.authorize ?? ((tx, scope, actor, permission) => operationsAccess(tx, scope, actor, permission));
  }
  private currentAuthorization(scope: Scope, actor: Actor) {assertMaintenanceAuthorization(this.options.authorization, scope, actor);}
  private async transaction<T>(scope: Scope, actor: Actor, permission: OperationPermission, work: (tx: Tx, now: Date) => Promise<T>): Promise<T> {
    assert(actor.source === "WEB_DASHBOARD" || actor.source === "DISCORD_PANEL", "PERSONAL_IDENTITY_REQUIRED", 403);
    assert(typeof actor.key === "string" && actor.key.length > 0 && actor.key.length <= 180, "PERSONAL_IDENTITY_REQUIRED", 403);
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
      this.currentAuthorization(scope, actor);
      await this.access(tx, scope, actor, permission);
      assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
      const now = (await sql<{now: Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      this.currentAuthorization(scope, actor);
      const result = await work(tx, now);
      this.currentAuthorization(scope, actor);
      return result;
    });
  }
  private readiness(purpose: "TEMPLATE_DEFINITION" | "PERSONAL_PREFERENCE") {
    const required = [purpose, "PERSONALIZATION_REQUEST"] as const;
    const missing = required.filter((key) => {
      const policy = this.options.policy?.classes[key];
      return !this.options.policy?.revision || !policy || !Number.isSafeInteger(policy.seconds) || policy.seconds <= 0 || !policy.approvalReference;
    });
    return {enabled: missing.length === 0, reasonCode: missing.length ? "PERSONALIZATION_RETENTION_UNCONFIGURED" : null, missingClasses: missing};
  }
  private async template(tx: Tx, scope: Scope, id: string, now: Date, expected?: number, lock = false) {
    const row = (await sql<TemplateRow>`SELECT * FROM automation_template_definitions WHERE ${tenant(scope)} AND id=${id}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx)).rows[0];
    assert(row && row.state === "ACTIVE" && row.expires_at > now, "TEMPLATE_NOT_FOUND", 404);
    if (expected !== undefined) assert(row.version === expected, "TEMPLATE_VERSION_MISMATCH", 412);
    return row;
  }
  private async templateRevision(tx: Tx, scope: Scope, row: TemplateRow, now: Date) {
    const saved = (await sql<RevisionRow>`SELECT * FROM automation_template_revisions WHERE ${tenant(scope)} AND template_id=${row.id}::uuid AND version=${row.version} AND expires_at>${now}`.execute(tx)).rows[0];
    assert(saved, "TEMPLATE_NOT_FOUND", 404); return saved;
  }
  async templates(scope: Scope, actor: Actor, id?: string) {
    if (id) z.uuid().parse(id);
    return this.transaction(scope, actor, "READ", async (tx, now) => {
      const rows = id ? [await this.template(tx, scope, id, now)] : (await sql<TemplateRow>`SELECT * FROM automation_template_definitions WHERE ${tenant(scope)} AND state='ACTIVE' AND expires_at>${now} ORDER BY updated_at DESC,id LIMIT 100`.execute(tx)).rows;
      const items = rows.map((row) => ({templateId: row.id, name: row.name!, version: row.version, updatedAt: row.updated_at.toISOString(), expiresAt: row.expires_at.toISOString()}));
      return {items, ...(id ? {definition: (await this.templateRevision(tx, scope, rows[0]!, now)).definition} : {}), readiness: this.readiness("TEMPLATE_DEFINITION"), status: items.length ? "AVAILABLE" : "EMPTY", observedAt: now.toISOString()};
    });
  }
  async preferences(scope: Scope, actor: Actor) {
    return this.transaction(scope, actor, "READ", async (tx, now) => ({...await readPersonalPreferences(tx, scope, actor.key, now), readiness: this.readiness("PERSONAL_PREFERENCE"), observedAt: now.toISOString()}));
  }
  async requestStatus(scope: Scope, actor: Actor, key: string, kind: "templates" | "preferences") {
    z.uuid().parse(key);
    return this.transaction(scope, actor, kind === "templates" ? "CONFIGURE" : "READ", async (tx, now) => {
      const row = (await sql<RequestRow>`SELECT * FROM personalization_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key}`.execute(tx)).rows[0];
      assert(row && row.expires_at > now && row.operation.startsWith(kind === "templates" ? "TEMPLATE_" : "PREFERENCE_"), "PERSONALIZATION_REQUEST_GONE", 410);
      if (row.state === "COMPLETED") return {state: "COMPLETED", result: row.result};
      if (row.operation === "TEMPLATE_DRAFT") {
        const saved = (await sql<{flow_id: string; revision: number}>`SELECT flow_id,revision FROM automation_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} AND kind='SAVE' AND flow_id=${`template-${key}`}`.execute(tx)).rows[0];
        if (saved) return {state: "COMPLETED", result: {flowId: saved.flow_id, draftRevision: saved.revision, state: "DRAFT", activated: false}};
      }
      return {state: "UNKNOWN", result: null};
    });
  }
  async prepare(scope: Scope, actor: Actor, raw: unknown) {
    const input = personalizationMutation.parse(raw), preference = input.operation.startsWith("PREFERENCE_");
    return this.transaction(scope, actor, preference ? "READ" : "CONFIGURE", async (tx, now) => {
      const end = personalizationExpiry(this.options.policy, preference ? "PERSONAL_PREFERENCE" : "TEMPLATE_DEFINITION", now);
      let ceiling = end;
      if ("templateId" in input) ceiling = new Date(Math.min(ceiling.getTime(), (await this.template(tx, scope, input.templateId, now, input.expectedVersion, true)).expires_at.getTime()));
      if (input.operation === "PREFERENCE_SAVE" || input.operation === "PREFERENCE_RESET") {
        const row = (await sql<PreferenceRow>`SELECT * FROM personal_preferences WHERE ${tenant(scope)} AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
        assert((row?.version ?? 0) === input.expectedVersion, "PREFERENCE_VERSION_MISMATCH", 412);
        if (row) {assert(row.expires_at > now, "PREFERENCE_EXPIRED", 409); ceiling = new Date(Math.min(ceiling.getTime(), row.expires_at.getTime()));}
      }
      const expiresAt = personalizationExpiry(this.options.policy, "PERSONALIZATION_REQUEST", now, ceiling);
      const key = randomUUID(), resourceId = input.operation === "TEMPLATE_CREATE" || input.operation === "TEMPLATE_COPY" ? randomUUID() : "templateId" in input ? input.templateId : null;
      this.currentAuthorization(scope, actor);
      await sql`INSERT INTO personalization_requests(organization_id,guild_id,id,actor_hash,operation,fingerprint,resource_id,created_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${key}::uuid,${actor.key},${input.operation},${personalizationFingerprint(input)},${resourceId}::uuid,${now},${expiresAt})`.execute(tx);
      return {key, expiresAt: expiresAt.toISOString(), purpose: "PERSONALIZATION_MUTATION"};
    });
  }
  private async request(tx: Tx, scope: Scope, actor: Actor, key: string, input: PersonalizationMutation, now: Date) {
    const row = (await sql<RequestRow>`SELECT * FROM personalization_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
    this.currentAuthorization(scope, actor);
    assert(row, "PERSONALIZATION_REQUEST_GONE", 410);
    assert(row.expires_at > now, "PERSONALIZATION_REQUEST_EXPIRED", 410);
    assert(row.operation === input.operation && row.fingerprint === personalizationFingerprint(input), "PERSONALIZATION_REQUEST_MISMATCH", 409);
    return row;
  }
  private async definition(tx: Tx, scope: Scope, id: string, revision: number) {
    const row = (await sql<{definition: FlowDefinition}>`SELECT r.definition FROM automation_revisions r JOIN automation_flows f ON f.organization_id=r.organization_id AND f.guild_id=r.guild_id AND f.id=r.flow_id WHERE r.organization_id=${scope.organizationId}::uuid AND r.guild_id=${scope.guildId} AND r.flow_id=${id} AND r.revision=${revision} AND f.state<>'DELETED'`.execute(tx)).rows[0];
    assert(row, "AUTOMATION_REVISION_NOT_FOUND", 404); assertTemplateHasNoCredentials(row.definition);
    const validation = validateFlowDefinition(row.definition, {...await scratchNumericOptions(row.definition), temporalResolution: "fixed"});
    assert(validation.valid && validation.definition && validation.definition.guildId === scope.guildId, "TEMPLATE_DEFINITION_INVALID");
    assert(Buffer.byteLength(JSON.stringify(validation.definition)) <= 262144, "TEMPLATE_DEFINITION_LIMIT");
    return validation.definition;
  }
  async mutate(scope: Scope, actor: Actor, key: string, raw: unknown) {
    z.uuid().parse(key); const input = personalizationMutation.parse(raw), preference = input.operation.startsWith("PREFERENCE_");
    if (input.operation === "TEMPLATE_DRAFT") return this.createDraft(scope, actor, key, input);
    return this.transaction(scope, actor, preference ? "READ" : "CONFIGURE", async (tx, now) => {
      const end = personalizationExpiry(this.options.policy, preference ? "PERSONAL_PREFERENCE" : "TEMPLATE_DEFINITION", now);
      const template = "templateId" in input ? (await sql<TemplateRow>`SELECT * FROM automation_template_definitions WHERE ${tenant(scope)} AND id=${input.templateId}::uuid FOR UPDATE`.execute(tx)).rows[0] : null;
      const request = await this.request(tx, scope, actor, key, input, now);
      if (request.state === "COMPLETED") return request.result!;
      if ("templateId" in input) {
        assert(template && template.state === "ACTIVE" && template.expires_at > now, "TEMPLATE_NOT_FOUND", 404);
        assert(template.version === input.expectedVersion, "TEMPLATE_VERSION_MISMATCH", 412);
      }
      let result: Record<string, string | number | boolean | null>;
      if (preference) {
        assert(input.operation === "PREFERENCE_SAVE" || input.operation === "PREFERENCE_RESET", "INVALID_REQUEST");
        const row = (await sql<PreferenceRow>`SELECT * FROM personal_preferences WHERE ${tenant(scope)} AND actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
        assert((row?.version ?? 0) === input.expectedVersion, "PREFERENCE_VERSION_MISMATCH", 412);
        assert(!row || row.expires_at > now, "PREFERENCE_EXPIRED", 409);
        const nextVersion = (row?.version ?? 0) + 1, reset = input.operation === "PREFERENCE_RESET";
        const expiry = row ? new Date(Math.min(end.getTime(), row.expires_at.getTime())) : end;
        this.currentAuthorization(scope, actor);
        await sql`INSERT INTO personal_preferences(organization_id,guild_id,actor_hash,version,settings,state,created_at,updated_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${actor.key},${nextVersion},${reset ? null : json(input.settings)},${reset ? "RESET" : "ACTIVE"},${now},${now},${expiry}) ON CONFLICT(organization_id,guild_id,actor_hash) DO UPDATE SET version=EXCLUDED.version,settings=EXCLUDED.settings,state=EXCLUDED.state,updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at`.execute(tx);
        result = {version: nextVersion, state: reset ? "RESET" : "ACTIVE"};
      } else if (input.operation === "TEMPLATE_DELETE") {
        this.currentAuthorization(scope, actor);
        await sql`DELETE FROM automation_template_revisions WHERE ${tenant(scope)} AND template_id=${input.templateId}::uuid`.execute(tx);
        this.currentAuthorization(scope, actor);
        await sql`UPDATE automation_template_definitions SET version=version+1,name=NULL,state='DELETED',updated_at=${now} WHERE ${tenant(scope)} AND id=${input.templateId}::uuid AND version=${input.expectedVersion}`.execute(tx);
        result = {templateId: input.templateId, version: input.expectedVersion + 1, state: "DELETED"};
      } else {
        assert(input.operation === "TEMPLATE_CREATE" || input.operation === "TEMPLATE_UPDATE" || input.operation === "TEMPLATE_COPY", "INVALID_REQUEST");
        const prior = template ? await this.templateRevision(tx, scope, template, now) : null;
        const sourceDefinition = "sourceFlowId" in input && input.sourceFlowId ? await this.definition(tx, scope, input.sourceFlowId, input.sourceRevision!) : prior!.definition;
        assertTemplateHasNoCredentials(sourceDefinition);
        const id = input.operation === "TEMPLATE_UPDATE" ? input.templateId : request.resource_id!;
        const next = input.operation === "TEMPLATE_UPDATE" ? input.expectedVersion + 1 : 1;
        const expiry = prior ? new Date(Math.min(end.getTime(), prior.expires_at.getTime(), template!.expires_at.getTime())) : end;
        this.currentAuthorization(scope, actor);
        await sql`INSERT INTO automation_template_definitions(organization_id,guild_id,id,version,name,state,created_at,updated_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,${next},${input.name},'ACTIVE',${now},${now},${expiry}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET version=EXCLUDED.version,name=EXCLUDED.name,updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at`.execute(tx);
        this.currentAuthorization(scope, actor);
        await sql`INSERT INTO automation_template_revisions(organization_id,guild_id,template_id,version,definition,definition_hash,source_flow_id,source_revision,created_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,${next},${json(sourceDefinition)},${personalizationFingerprint(sourceDefinition)},${"sourceFlowId" in input ? input.sourceFlowId ?? prior?.source_flow_id ?? null : prior?.source_flow_id ?? null},${"sourceRevision" in input ? input.sourceRevision ?? prior?.source_revision ?? null : prior?.source_revision ?? null},${now},${expiry})`.execute(tx);
        result = {templateId: id, version: next, state: "ACTIVE"};
      }
      this.currentAuthorization(scope, actor);
      await sql`UPDATE personalization_requests SET state='COMPLETED',result=${json(result)} WHERE ${tenant(scope)} AND id=${key}::uuid`.execute(tx);
      return result;
    });
  }
  private async createDraft(scope: Scope, actor: Actor, key: string, input: Extract<PersonalizationMutation, {operation: "TEMPLATE_DRAFT"}>) {
    const prepared = await this.transaction(scope, actor, "CONFIGURE", async (tx, now) => {
      personalizationExpiry(this.options.policy, "TEMPLATE_DEFINITION", now);
      const row = (await sql<TemplateRow>`SELECT * FROM automation_template_definitions WHERE ${tenant(scope)} AND id=${input.templateId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const request = await this.request(tx, scope, actor, key, input, now);
      if (request.state === "COMPLETED") return {request, definition: null};
      assert(row && row.state === "ACTIVE" && row.expires_at > now, "TEMPLATE_NOT_FOUND", 404);
      assert(row.version === input.expectedVersion, "TEMPLATE_VERSION_MISMATCH", 412);
      return {request, definition: (await this.templateRevision(tx, scope, row, now)).definition};
    });
    if (prepared.request.state === "COMPLETED") return prepared.request.result!;
    const definition = structuredClone(prepared.definition!);
    definition.id = `template-${key}`; definition.name = input.draftName; definition.guildId = scope.guildId;
    const automation = new AutomationService(this.db, {...this.options.automation, authorize: async (tx, currentScope, currentActor, permission) => {
      if (!tx.isTransaction) {
        this.currentAuthorization(currentScope, currentActor);
        await this.access(tx, currentScope, currentActor, permission);
        this.currentAuthorization(currentScope, currentActor);
        return;
      }
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(currentScope));
      this.currentAuthorization(currentScope, currentActor);
      await this.access(tx, currentScope, currentActor, permission);
      assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(currentScope)} AND (lookup_hash IS NULL OR lookup_hash=${currentActor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
      const now = (await sql<{now: Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      await this.template(tx, currentScope, input.templateId, now, input.expectedVersion, true);
      await this.request(tx, currentScope, currentActor, key, input, now);
      this.currentAuthorization(currentScope, currentActor);
    }});
    let committedResult: Record<string, string | number | boolean | null> | undefined;
    try {
      const saved = await automation.save(scope, actor, {definition, expectedRevision: 0, requestId: key}, undefined, async () => this.currentAuthorization(scope, actor));
      const result = {flowId: saved.id, draftRevision: saved.draftRevision, state: "DRAFT", activated: false};
      committedResult = result;
      await this.transaction(scope, actor, "CONFIGURE", async (tx, now) => {
        await this.request(tx, scope, actor, key, input, now);
        this.currentAuthorization(scope, actor);
        await sql`UPDATE personalization_requests SET state='COMPLETED',result=${json(result)} WHERE ${tenant(scope)} AND id=${key}::uuid`.execute(tx);
      });
      return result;
    } catch {
      // The underlying SAVE already returned a known committed result. Failure
      // to persist its receipt must not turn it into a retryable failed save.
      if (committedResult) return {...committedResult, requestRecorded: false};
      // SAVE has its own transaction and durable request identity. Its commit
      // must be read-only reconciled before any new draft request is attempted.
      assert(false, "PERSONALIZATION_RESULT_UNKNOWN", 409);
    }
  }
}

/** Internal consumer helper: caller must already have current actor authorization.
 * No user identity parameter is exposed through the Browser API. */
export async function readPersonalPreferences(tx: Tx, scope: Scope, actorHash: string, now: Date) {
  const row = (await sql<PreferenceRow>`SELECT version,settings,state,updated_at,expires_at FROM personal_preferences WHERE ${tenant(scope)} AND actor_hash=${actorHash} AND expires_at>${now}`.execute(tx)).rows[0];
  return {version: row?.version ?? 0, settings: row?.state === "ACTIVE" ? preferenceSettings.parse(row.settings) : {...DEFAULT_PERSONAL_PREFERENCES}, source: row?.state === "ACTIVE" ? "SAVED" : "DEFAULT", updatedAt: row?.updated_at.toISOString() ?? null, expiresAt: row?.expires_at.toISOString() ?? null};
}
export async function purgePersonalizationActor(tx: Tx, scope: Scope, actorHash: string, userId?:string) {
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  if(userId){
    // A template is another immutable definition copy. Removing the original
    // flow must not leave a route for reviving an explicitly erased member.
    const references=(value:unknown):boolean=>typeof value==='string'?(value===userId||value.includes('<@'+userId+'>')||value.includes('<@!'+userId+'>')):Array.isArray(value)?value.some(references):!!value&&typeof value==='object'?Object.values(value as Record<string,unknown>).some(references):false;
    const definitions=(await sql<{template_id:string;definition:unknown}>`SELECT template_id,definition FROM automation_template_revisions WHERE ${tenant(scope)}`.execute(tx)).rows;
    const ids=[...new Set(definitions.filter(row=>references(row.definition)).map(row=>row.template_id))];
    await sql`DELETE FROM personalization_requests WHERE ${tenant(scope)} AND resource_id=ANY(${ids}::uuid[])`.execute(tx);
    await sql`DELETE FROM automation_template_definitions WHERE ${tenant(scope)} AND id=ANY(${ids}::uuid[])`.execute(tx);
  }
  await sql`DELETE FROM personal_preferences WHERE ${tenant(scope)} AND actor_hash=${actorHash}`.execute(tx);
  await sql`DELETE FROM personalization_requests WHERE ${tenant(scope)} AND actor_hash=${actorHash}`.execute(tx);
}
export async function purgePersonalizationGuild(tx: Tx, scope: Scope) {
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  for (const table of ["personalization_requests", "personal_preferences", "automation_template_definitions"])
    await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(scope)}`.execute(tx);
}
export async function purgeExpiredPersonalization(tx: Tx, scope: Scope, now: Date) {
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  for (const table of ["personalization_requests", "personal_preferences", "automation_template_revisions", "automation_template_definitions"])
    await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(scope)} AND expires_at<=${now}`.execute(tx);
}
