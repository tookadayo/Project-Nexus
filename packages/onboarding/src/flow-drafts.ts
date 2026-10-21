import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql, tenant, json, type Database, type Tx} from "../../db/src/index";
import {assert, type Scope} from "../../shared/src/index";
import {SettingsService, type Actor, type SettingsView} from "../../settings/src/index";
import {configHash} from "../../settings/src/revisions";
import {EntitlementService} from "../../settings/src/billing/index";
import {operationsAccess, type OperationPermission} from "../../operations/src/policy";
import {assertMaintenanceAuthorization, type MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import {acquireRuleScopeLocks, ruleScopeLockSet} from "../../rules/src/locks";
import type {TargetDraftAdapter, RuleAuthorizationProof} from "../../rules/src/service";
import {flowSchema, validateFlow, type Flow} from "./flow";
import {publishOnboardingFlowInTransaction, type OnboardingFlowSlot} from "./index";

const uuid = z.uuid(), revision = z.number().int().min(1).max(2147483647), settingsRevision = z.number().int().min(0).max(2147483647), slotSchema = z.enum(["MAIN", "HYBRID"]);
export const onboardingFlowChanges = z.object({definition: flowSchema, slot: slotSchema.optional()}).strict().transform((input) => ({...input, definition: validateFlow(input.definition)}));
export const onboardingDraftSave = z.object({operation: z.literal("FLOW_DRAFT_SAVE"), label: z.string().trim().min(1).max(80), slot: slotSchema, definition: flowSchema, baseFlowId: uuid.nullable(), expectedSettingsRevision: settingsRevision, workspaceId: uuid.optional(), expectedRevision: revision.optional()}).strict().superRefine((input, ctx) => {if ((input.workspaceId === undefined) !== (input.expectedRevision === undefined)) ctx.addIssue({code: "custom", message: "Workspace and revision must be paired"});}).transform((input) => ({...input, definition: validateFlow(input.definition)}));
export const onboardingDraftDelete = z.object({operation: z.literal("FLOW_DRAFT_DELETE"), workspaceId: uuid, expectedRevision: revision}).strict();
export const onboardingDraftPublish = z.object({operation: z.literal("FLOW_DRAFT_PUBLISH"), workspaceId: uuid, expectedRevision: revision, draftId: uuid, confirmationHash: z.string().regex(/^[a-f0-9]{64}$/), expectedFlowId: uuid.nullable(), expectedSettingsRevision: settingsRevision}).strict();
export const onboardingDraftMutation = z.union([onboardingDraftSave, onboardingDraftDelete, onboardingDraftPublish]);
export type OnboardingDraftMutation = z.infer<typeof onboardingDraftMutation>;
type Save = z.infer<typeof onboardingDraftSave>;
type Publish = z.infer<typeof onboardingDraftPublish>;
type Access = (tx: Tx, scope: Scope, actor: Actor, permission: OperationPermission) => Promise<unknown>;
interface FlowVersion {id: string; version: number; definition: Flow;}
export interface CurrentOnboardingFlow {id: string | null; flowVersion: number; definition: Flow | null; settingsRevision: number; mainFlowId: string | null; hybridFlowId: string | null; slots: OnboardingFlowSlot[]; contentHash: string;}
interface DraftRow {workspace_id: string; id: string; revision: number; slot: OnboardingFlowSlot; base_flow_id: string | null; base_settings_revision: number; definition: Flow; content_hash: string; created_at: Date;}
interface WorkspaceRow {id: string; revision: number; head_id: string; label: string; created_at: Date; updated_at: Date;}
export function onboardingFlowTargetVersion(current: CurrentOnboardingFlow) {return `${current.flowVersion}:${current.settingsRevision}:${configHash({mainFlowId: current.mainFlowId, hybridFlowId: current.hybridFlowId, definitionHash: current.definition ? configHash(current.definition) : null})}`;}
/** Shared with normal OnboardingService.publish/rollback via SettingsService. */
export async function lockOnboardingConfiguration(tx: Tx, scope: Scope) {
  assert(tx.isTransaction, "CONFIG_TRANSACTION_REQUIRED", 500); await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.organizationId + ":" + scope.guildId},0))`.execute(tx);
}
export class OnboardingFlowDrafts {
  readonly settings: SettingsService;
  private readonly access: Access;
  constructor(readonly db: Database, readonly options: {authorization?: MaintenanceAuthorizationProof; authorize?: Access} = {}) {this.settings = new SettingsService(db); this.access = options.authorize ?? ((tx, scope, actor, permission) => operationsAccess(tx, scope, actor, permission));}
  async authorize(tx: Tx, scope: Scope, actor: Actor, permission: OperationPermission, slot?: OnboardingFlowSlot) {
    assert(actor.source === "WEB_DASHBOARD" || actor.source === "DISCORD_PANEL", "CURRENT_USER_REQUIRED", 403);
    assertMaintenanceAuthorization(this.options.authorization, scope, actor); await this.access(tx, scope, actor, permission);
    assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
    if (slot) await new EntitlementService(tx).require(scope, slot === "HYBRID" ? "hybrid_onboarding" : "fallback_onboarding");
    assertMaintenanceAuthorization(this.options.authorization, scope, actor);
  }
  async transaction<T>(scope: Scope, actor: Actor, permission: OperationPermission, work: (tx: Tx) => Promise<T>) {
    return this.db.transaction().execute(async (tx) => {await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope)); await this.authorize(tx, scope, actor, permission); await lockOnboardingConfiguration(tx, scope); await this.authorize(tx, scope, actor, permission); const result = await work(tx); assertMaintenanceAuthorization(this.options.authorization, scope, actor); return result;});
  }
  async current(tx: Tx, scope: Scope, id?: string | null, slot: OnboardingFlowSlot = "MAIN", lock = false): Promise<CurrentOnboardingFlow> {
    assert(tx.isTransaction, "CONFIG_TRANSACTION_REQUIRED", 500); if (lock) await lockOnboardingConfiguration(tx, scope);
    if (lock) await sql`SELECT revision FROM guild_settings WHERE ${tenant(scope)} FOR UPDATE`.execute(tx);
    const settings = await this.settings.get(scope, tx), chosen = id === undefined ? slot === "MAIN" ? settings.flowVersionId : settings.hybrid.flowVersionId : id;
    if (chosen) uuid.parse(chosen);
    const slots: OnboardingFlowSlot[] = []; if (chosen && settings.flowVersionId === chosen) slots.push("MAIN"); if (chosen && settings.hybrid.flowVersionId === chosen) slots.push("HYBRID");
    assert(chosen === null || slots.length, "ONBOARDING_FLOW_CURRENT_HEAD_MISMATCH", 412);
    const row = chosen ? (await sql<FlowVersion>`SELECT id,version,definition FROM flow_versions WHERE ${tenant(scope)} AND id=${chosen}::uuid`.execute(tx)).rows[0] : null;
    assert(!chosen || row, "FLOW_NOT_FOUND", 404);
    const definition = row ? validateFlow(row.definition) : null;
    return {id: chosen, flowVersion: row?.version ?? 0, definition, settingsRevision: settings.revision, mainFlowId: settings.flowVersionId, hybridFlowId: settings.hybrid.flowVersionId, slots, contentHash: configHash({flowId: chosen, version: row?.version ?? 0, definition, settingsRevision: settings.revision, mainFlowId: settings.flowVersionId, hybridFlowId: settings.hybrid.flowVersionId})};
  }
  async workspace(tx: Tx, scope: Scope, id: string, lock = false) {uuid.parse(id); const row = (await sql<WorkspaceRow>`SELECT * FROM onboarding_flow_workspaces WHERE ${tenant(scope)} AND id=${id}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx)).rows[0]; assert(row, "ONBOARDING_DRAFT_NOT_FOUND", 404); return row;}
  async draft(tx: Tx, scope: Scope, id: string) {uuid.parse(id); const row = (await sql<DraftRow>`SELECT * FROM onboarding_flow_drafts WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(tx)).rows[0]; assert(row, "ONBOARDING_DRAFT_NOT_FOUND", 404); assert(configHash(validateFlow(row.definition)) === row.content_hash, "ONBOARDING_DRAFT_HASH_MISMATCH", 409); return row;}
  async saveInTransaction(tx: Tx, scope: Scope, actor: Actor, raw: unknown, beforeWrite?: (tx: Tx) => Promise<void>) {
    const input: Save = onboardingDraftSave.parse(raw); await lockOnboardingConfiguration(tx, scope); await this.authorize(tx, scope, actor, "CONFIGURE", input.slot);
    const current = await this.current(tx, scope, undefined, input.slot, true);
    assert(current.id === input.baseFlowId && current.settingsRevision === input.expectedSettingsRevision, "ONBOARDING_FLOW_BASE_CONFLICT", 412);
    const previous = input.workspaceId ? await this.workspace(tx, scope, input.workspaceId, true) : null;
    assert(!previous || previous.revision === input.expectedRevision, "ONBOARDING_DRAFT_VERSION_MISMATCH", 412);
    const id = previous?.id ?? randomUUID(), draftId = randomUUID(), next = (previous?.revision ?? 0) + 1, hash = configHash(input.definition);
    assert(Buffer.byteLength(JSON.stringify(input.definition)) <= 262144, "ONBOARDING_DEFINITION_TOO_LARGE", 413);
    await this.authorize(tx, scope, actor, "CONFIGURE", input.slot); await beforeWrite?.(tx);
    await sql`INSERT INTO onboarding_flow_workspaces(organization_id,guild_id,id,revision,head_id,label) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,${next},${draftId}::uuid,${input.label}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET revision=EXCLUDED.revision,head_id=EXCLUDED.head_id,label=EXCLUDED.label,updated_at=now()`.execute(tx);
    await this.authorize(tx, scope, actor, "CONFIGURE", input.slot); await beforeWrite?.(tx);
    await sql`INSERT INTO onboarding_flow_drafts(organization_id,guild_id,id,workspace_id,revision,slot,base_flow_id,base_settings_revision,definition,content_hash) VALUES(${scope.organizationId}::uuid,${scope.guildId},${draftId}::uuid,${id}::uuid,${next},${input.slot},${input.baseFlowId}::uuid,${input.expectedSettingsRevision},${json(input.definition)},${hash})`.execute(tx);
    await this.authorize(tx, scope, actor, "CONFIGURE", input.slot); await beforeWrite?.(tx);
    return {workspaceId: id, draftId, revision: next, contentHash: hash, state: "DRAFT" as const};
  }
  async removeInTransaction(tx: Tx, scope: Scope, actor: Actor, raw: unknown) {
    const input = onboardingDraftDelete.parse(raw); await lockOnboardingConfiguration(tx, scope); await this.authorize(tx, scope, actor, "CONFIGURE"); const row = await this.workspace(tx, scope, input.workspaceId, true); assert(row.revision === input.expectedRevision, "ONBOARDING_DRAFT_VERSION_MISMATCH", 412);
    await this.authorize(tx, scope, actor, "CONFIGURE"); await sql`DELETE FROM onboarding_flow_workspaces WHERE ${tenant(scope)} AND id=${row.id}::uuid`.execute(tx);
    return {workspaceId: row.id, state: "DELETED" as const};
  }
  async list(scope: Scope, actor: Actor) {return this.transaction(scope, actor, "READ", async (tx) => {
    const items = (await sql<WorkspaceRow & {slot: OnboardingFlowSlot; content_hash: string; draft_id: string}>`SELECT w.*,d.slot,d.content_hash,d.id AS draft_id FROM onboarding_flow_workspaces w JOIN onboarding_flow_drafts d ON d.organization_id=w.organization_id AND d.guild_id=w.guild_id AND d.id=w.head_id WHERE w.organization_id=${scope.organizationId}::uuid AND w.guild_id=${scope.guildId} ORDER BY w.updated_at DESC,w.id LIMIT 100`.execute(tx)).rows;
    return {items, current: {MAIN: await this.current(tx, scope, undefined, "MAIN"), HYBRID: await this.current(tx, scope, undefined, "HYBRID")}, status: items.length ? "AVAILABLE" : "EMPTY"};
  });}
  async detail(scope: Scope, actor: Actor, id: string) {return this.transaction(scope, actor, "READ", async (tx) => {const workspace = await this.workspace(tx, scope, id); const revisions = (await sql<DraftRow>`SELECT * FROM onboarding_flow_drafts WHERE ${tenant(scope)} AND workspace_id=${id}::uuid ORDER BY revision DESC LIMIT 100`.execute(tx)).rows; return {workspace, revisions};});}
  async previewInTransaction(tx: Tx, scope: Scope, actor: Actor, id: string) {
    await this.authorize(tx, scope, actor, "READ"); const workspace = await this.workspace(tx, scope, id), after = await this.draft(tx, scope, workspace.head_id), before = await this.current(tx, scope, undefined, after.slot);
    const publication = (await sql<{flow_version_id: string; settings_revision: number; published_at: Date}>`SELECT flow_version_id,settings_revision,published_at FROM onboarding_flow_publications WHERE ${tenant(scope)} AND draft_id=${after.id}::uuid`.execute(tx)).rows[0] ?? null;
    return {workspace, before, after, confirmationHash: after.content_hash, baseMatches: before.id === after.base_flow_id && before.settingsRevision === after.base_settings_revision, publication};
  }
  async commitInTransaction(tx: Tx, scope: Scope, actor: Actor, raw: unknown, beforeWrite?: (tx: Tx) => Promise<void>) {
    const input: Publish = onboardingDraftPublish.parse(raw); await lockOnboardingConfiguration(tx, scope); const workspace = await this.workspace(tx, scope, input.workspaceId, true); const draft = await this.draft(tx, scope, input.draftId); await this.authorize(tx, scope, actor, "CONFIGURE", draft.slot);
    assert(workspace.head_id === draft.id && workspace.revision === input.expectedRevision && draft.workspace_id === workspace.id && draft.content_hash === input.confirmationHash, "ONBOARDING_DRAFT_VERSION_MISMATCH", 412);
    const old = (await sql<{flow_version_id: string; settings_revision: number}>`SELECT flow_version_id,settings_revision FROM onboarding_flow_publications WHERE ${tenant(scope)} AND draft_id=${draft.id}::uuid`.execute(tx)).rows[0];
    if (old) return {workspaceId: workspace.id, draftId: draft.id, flowVersionId: old.flow_version_id, settingsRevision: old.settings_revision, state: "PUBLISHED" as const};
    const current = await this.current(tx, scope, undefined, draft.slot, true);
    assert(current.id === input.expectedFlowId && current.settingsRevision === input.expectedSettingsRevision && current.id === draft.base_flow_id && current.settingsRevision === draft.base_settings_revision, "ONBOARDING_FLOW_BASE_CONFLICT", 412);
    const cfg = await this.settings.get(scope, tx);
    if (draft.slot === "HYBRID" && cfg.flags.native_capability_v2) {
      const profile = (await sql<{profile: {checkedAt: string; nativePromptIds: string[]}}>`SELECT profile FROM guild_capabilities WHERE ${tenant(scope)} ORDER BY checked_at DESC LIMIT 1`.execute(tx)).rows[0]?.profile;
      assert(profile && Date.now() - new Date(profile.checkedAt).getTime() >= 0 && Date.now() - new Date(profile.checkedAt).getTime() < 3600000, "REFRESH_NATIVE_SETUP", 409);
      assert(!draft.definition.nodes.some((node) => profile.nativePromptIds.includes(node.nativePromptId ?? cfg.hybrid.nativePromptMappings[node.id] ?? "")), "DUPLICATE_NATIVE_QUESTION", 409);
    }
    const guard = async (connection: Tx) => {await this.authorize(connection, scope, actor, "CONFIGURE", draft.slot); await beforeWrite?.(connection);};
    const next: SettingsView = await publishOnboardingFlowInTransaction(tx, this.settings, scope, actor, current.settingsRevision, draft.definition, draft.slot, guard), publishedId = draft.slot === "MAIN" ? next.flowVersionId : next.hybrid.flowVersionId;
    assert(publishedId, "ONBOARDING_PUBLISH_RESULT_INVALID", 500); await guard(tx);
    await sql`INSERT INTO onboarding_flow_publications(organization_id,guild_id,draft_id,flow_version_id,settings_revision) VALUES(${scope.organizationId}::uuid,${scope.guildId},${draft.id}::uuid,${publishedId}::uuid,${next.revision})`.execute(tx);
    await guard(tx); return {workspaceId: workspace.id, draftId: draft.id, flowVersionId: publishedId, settingsRevision: next.revision, state: "PUBLISHED" as const};
  }
}
export function createOnboardingFlowDraftAdapter(db: Database, proof?: RuleAuthorizationProof): TargetDraftAdapter {
  const native = new OnboardingFlowDrafts(db, {authorization: proof});
  return {targetType: "ONBOARDING_FLOW", adapterId: "native:ONBOARDING_FLOW:1", nativeSource: "packages/onboarding/src/flow-drafts.ts:OnboardingFlowDrafts.saveInTransaction", writerCompatible: true,
    validateFields(input) {return onboardingFlowChanges.parse(input);},
    async lockCurrent(tx, scope, id) {const current = await native.current(tx, scope, uuid.parse(id), "MAIN", true); return {version: onboardingFlowTargetVersion(current), contentHash: current.contentHash};},
    async createDraft(tx, scope, actor, targetId, liveVersion, raw) {const changes = onboardingFlowChanges.parse(raw), current = await native.current(tx, scope, uuid.parse(targetId), "MAIN", false); await native.authorize(tx, scope, actor, "CONFIGURE"); assert(onboardingFlowTargetVersion(current) === liveVersion, "TARGET_VERSION_MISMATCH", 412); const slot = changes.slot ?? (current.slots.includes("MAIN") ? "MAIN" : "HYBRID"); assert(current.slots.includes(slot), "ONBOARDING_FLOW_CURRENT_HEAD_MISMATCH", 412);
      const saved = await native.saveInTransaction(tx, scope, actor, {operation: "FLOW_DRAFT_SAVE", label: "Onboarding draft", slot, definition: changes.definition, baseFlowId: targetId, expectedSettingsRevision: current.settingsRevision}); return {draftId: saved.workspaceId, immutableRevisionId: saved.draftId, contentHash: saved.contentHash};},
  };
}
export async function purgeOnboardingFlowDrafts(tx: Tx, scope: Scope, userId?: string) {
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  if (!userId) {await sql`DELETE FROM onboarding_flow_workspaces WHERE ${tenant(scope)}`.execute(tx); return;}
  const references = (value: unknown): boolean => typeof value === "string" ? value === userId || value.includes(`<@${userId}>`) || value.includes(`<@!${userId}>`) : Array.isArray(value) ? value.some(references) : !!value && typeof value === "object" ? Object.values(value).some(references) : false;
  const rows = (await sql<{workspace_id: string; definition: unknown}>`SELECT workspace_id,definition FROM onboarding_flow_drafts WHERE ${tenant(scope)}`.execute(tx)).rows, ids = [...new Set(rows.filter((row) => references(row.definition)).map((row) => row.workspace_id))];
  await sql`DELETE FROM onboarding_flow_workspaces WHERE ${tenant(scope)} AND id=ANY(${ids}::uuid[])`.execute(tx);
}
