import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql, tenant, json, type Database, type Tx} from "../../db/src/index";
import {assert, type Scope} from "../../shared/src/index";
import type {Actor} from "../../settings/src/index";
import {EntitlementService} from "../../settings/src/billing/index";
import type {DiscordPort} from "../../discord/src/rest";
import {assertMaintenanceAuthorization, type MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import {lifecycleRequestExpiry, lifecycleRequestFingerprint, type LifecycleWebRequestPolicy} from "../../lifecycle/src/web-workspace";
import {OnboardingFlowDrafts, onboardingDraftMutation, type OnboardingDraftMutation} from "./flow-drafts";
import {validateFlow, type Flow} from "./flow";
interface RequestRow {operation: string; fingerprint: string; state: "PREPARED" | "CLAIMED" | "COMPLETED"; result: Record<string, unknown> | null; expires_at: Date;}
interface PublishSeal {draftId: string; hash: string; slot: "MAIN" | "HYBRID"; targets: string[];}
interface PublishProbe {seal: PublishSeal; fingerprint: string; actorHash: string; guildId: string; organizationId: string; checked: string[]; expiresAt: Date;}
export class OnboardingFlowAuthoring {
  readonly native: OnboardingFlowDrafts;
  constructor(readonly db: Database, readonly options: {authorization?: MaintenanceAuthorizationProof; requestPolicy?: LifecycleWebRequestPolicy; discord?: DiscordPort; authorize?: NonNullable<ConstructorParameters<typeof OnboardingFlowDrafts>[1]>["authorize"]} = {}) {this.native = new OnboardingFlowDrafts(db, {authorization: options.authorization, authorize: options.authorize});}
  private proof(scope: Scope, actor: Actor) {assertMaintenanceAuthorization(this.options.authorization, scope, actor);}
  private readiness() {try {lifecycleRequestExpiry(this.options.requestPolicy, new Date()); return {enabled: true, reasonCodes: [] as string[]};} catch {return {enabled: false, reasonCodes: ["LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED"]};}}
  async catalog(scope: Scope, actor: Actor) {const native = await this.native.list(scope, actor), features = await this.native.transaction(scope, actor, "READ", async (tx) => {const plans = new EntitlementService(tx); return {MAIN: await plans.can(scope, "fallback_onboarding"), HYBRID: await plans.can(scope, "hybrid_onboarding")};}); return {...native, features, readiness: this.readiness()};}
  async published(scope: Scope, actor: Actor) {return this.native.transaction(scope, actor, "READ", async (tx) => ({items: (await sql<{id: string; version: number; definition: Flow; published_at: Date}>`SELECT id,version,definition,published_at FROM flow_versions WHERE ${tenant(scope)} ORDER BY version DESC LIMIT 100`.execute(tx)).rows}));}
  private seal(draft: {id: string; content_hash: string; slot: "MAIN" | "HYBRID"; definition: Flow}): PublishSeal {const definition = validateFlow(draft.definition), targets = new Set<string>(); for (const node of definition.nodes) for (const option of node.options) {if (option.roleId) targets.add(`ROLE:${option.roleId}`); if (option.channelId) targets.add(`CHANNEL:${option.channelId}`);} return {draftId: draft.id, hash: draft.content_hash, slot: draft.slot, targets: [...targets].sort()};}
  private async validate(tx: Tx, scope: Scope, actor: Actor, input: OnboardingDraftMutation): Promise<PublishSeal | null> {
    if (input.operation === "FLOW_DRAFT_SAVE") {await this.native.authorize(tx, scope, actor, "CONFIGURE", input.slot); const current = await this.native.current(tx, scope, undefined, input.slot); assert(current.id === input.baseFlowId && current.settingsRevision === input.expectedSettingsRevision, "ONBOARDING_FLOW_BASE_CONFLICT", 412); if (input.workspaceId) assert((await this.native.workspace(tx, scope, input.workspaceId)).revision === input.expectedRevision, "ONBOARDING_DRAFT_VERSION_MISMATCH", 412); return null;}
    const workspace = await this.native.workspace(tx, scope, input.workspaceId); assert(workspace.revision === input.expectedRevision, "ONBOARDING_DRAFT_VERSION_MISMATCH", 412);
    if (input.operation === "FLOW_DRAFT_DELETE") return null;
    const draft = await this.native.draft(tx, scope, input.draftId); await this.native.authorize(tx, scope, actor, "CONFIGURE", draft.slot);
    assert(workspace.head_id === draft.id && draft.workspace_id === workspace.id && draft.content_hash === input.confirmationHash, "ONBOARDING_DRAFT_VERSION_MISMATCH", 412);
    const current = await this.native.current(tx, scope, undefined, draft.slot);
    assert(current.id === input.expectedFlowId && current.id === draft.base_flow_id && current.settingsRevision === input.expectedSettingsRevision && current.settingsRevision === draft.base_settings_revision, "ONBOARDING_FLOW_BASE_CONFLICT", 412);
    return this.seal(draft);
  }
  private async probe(scope: Scope, actor: Actor, input: OnboardingDraftMutation, seal: PublishSeal | null): Promise<PublishProbe | null> {
    if (!seal) return null; this.proof(scope, actor); const discord = this.options.discord; assert(discord, "DISCORD_UNAVAILABLE", 503); const checked: string[] = [];
    // All current native target reads happen after the read transaction closes.
    for (const target of seal.targets) {this.proof(scope, actor); const [kind, id] = target.split(":"); if (kind === "ROLE") await discord.validateRole(scope.guildId, id!); else await discord.checkChannel(scope.guildId, id!); this.proof(scope, actor); checked.push(target);}
    return {seal: structuredClone(seal), checked, fingerprint: lifecycleRequestFingerprint(input), actorHash: actor.key, organizationId: scope.organizationId, guildId: scope.guildId, expiresAt: new Date(this.options.authorization!.expiresAt.getTime())};
  }
  private assertProbe(scope: Scope, actor: Actor, input: OnboardingDraftMutation, seal: PublishSeal | null, probe: PublishProbe | null) {this.proof(scope, actor); if (!seal) {assert(probe === null, "ONBOARDING_TARGET_PROBE_MISMATCH", 409); return;} assert(probe && probe.actorHash === actor.key && probe.organizationId === scope.organizationId && probe.guildId === scope.guildId && probe.expiresAt > new Date() && probe.expiresAt.getTime() === this.options.authorization!.expiresAt.getTime() && probe.fingerprint === lifecycleRequestFingerprint(input) && lifecycleRequestFingerprint(probe.seal) === lifecycleRequestFingerprint(seal) && lifecycleRequestFingerprint(probe.checked) === lifecycleRequestFingerprint(seal.targets), "ONBOARDING_TARGET_PROBE_MISMATCH", 409);}
  async prepare(scope: Scope, actor: Actor, raw: unknown) {const input = onboardingDraftMutation.parse(raw), sealed = await this.native.transaction(scope, actor, "CONFIGURE", async (tx) => {lifecycleRequestExpiry(this.options.requestPolicy, new Date()); return this.validate(tx, scope, actor, input);}), probe = await this.probe(scope, actor, input, sealed);
    return this.native.transaction(scope, actor, "CONFIGURE", async (tx) => {const now = (await sql<{now: Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now, end = lifecycleRequestExpiry(this.options.requestPolicy, now); this.assertProbe(scope, actor, input, await this.validate(tx, scope, actor, input), probe); const key = randomUUID(); this.proof(scope, actor);
      await sql`INSERT INTO lifecycle_web_requests(organization_id,guild_id,id,actor_hash,domain,operation,fingerprint,state,created_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${key}::uuid,${actor.key},'onboarding_flow',${input.operation},${lifecycleRequestFingerprint(input)},'PREPARED',${now},${end})`.execute(tx); return {key, expiresAt: end.toISOString(), purpose: "LIFECYCLE_WEB_MUTATION"};});
  }
  private async request(tx: Tx, scope: Scope, actor: Actor, key: string, input?: OnboardingDraftMutation, lock = false) {z.uuid().parse(key); const row = (await sql<RequestRow>`SELECT * FROM lifecycle_web_requests WHERE ${tenant(scope)} AND id=${key}::uuid AND actor_hash=${actor.key} AND domain='onboarding_flow' ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx)).rows[0], now = (await sql<{now: Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now; this.proof(scope, actor); assert(row && row.expires_at > now, "LIFECYCLE_REQUEST_GONE", 410); if (input) assert(row.operation === input.operation && row.fingerprint === lifecycleRequestFingerprint(input), "LIFECYCLE_REQUEST_MISMATCH", 409); return row;}
  async status(scope: Scope, actor: Actor, key: string) {return this.native.transaction(scope, actor, "CONFIGURE", async (tx) => {const row = await this.request(tx, scope, actor, key); return {state: row.state === "COMPLETED" ? "COMPLETED" : row.state === "PREPARED" ? "NOT_STARTED" : "UNKNOWN", result: row.result};});}
  async mutate(scope: Scope, actor: Actor, key: string, raw: unknown) {
    const input = onboardingDraftMutation.parse(raw), preflight = await this.native.transaction(scope, actor, "CONFIGURE", async (tx) => {const request = await this.request(tx, scope, actor, key, input, true); if (request.state === "COMPLETED") return {completed: true as const, result: request.result!, seal: null}; assert(request.state === "PREPARED", "LIFECYCLE_RESULT_UNKNOWN", 409); return {completed: false as const, result: null, seal: await this.validate(tx, scope, actor, input)};});
    if (preflight.completed) return preflight.result;
    const probe = await this.probe(scope, actor, input, preflight.seal);
    return this.native.transaction(scope, actor, "CONFIGURE", async (tx) => {
      lifecycleRequestExpiry(this.options.requestPolicy, new Date()); const request = await this.request(tx, scope, actor, key, input, true); if (request.state === "COMPLETED") return request.result!; assert(request.state === "PREPARED", "LIFECYCLE_RESULT_UNKNOWN", 409); this.assertProbe(scope, actor, input, await this.validate(tx, scope, actor, input), probe);
      let result: Record<string, unknown>;
      if (input.operation === "FLOW_DRAFT_SAVE") result = await this.native.saveInTransaction(tx, scope, actor, input);
      else if (input.operation === "FLOW_DRAFT_DELETE") result = await this.native.removeInTransaction(tx, scope, actor, input);
      else result = await this.native.commitInTransaction(tx, scope, actor, input, async (connection) => {await this.native.authorize(connection, scope, actor, "CONFIGURE", preflight.seal!.slot); this.assertProbe(scope, actor, input, this.seal(await this.native.draft(connection, scope, input.draftId)), probe);});
      this.proof(scope, actor); await sql`UPDATE lifecycle_web_requests SET state='COMPLETED',result=${json(result)} WHERE ${tenant(scope)} AND id=${key}::uuid`.execute(tx); return result;
    });
  }
}
