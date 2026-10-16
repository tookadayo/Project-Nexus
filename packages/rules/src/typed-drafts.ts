import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql, tenant, type Database, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { domainRevisions, onboardingConfigSchema } from "../../settings/src/domain-config";
import { configHash } from "../../settings/src/revisions";
import { operationsAccess, operationsLock } from "../../operations/src/policy";
import { assertMaintenanceAuthorization } from "../../operations/src/maintenance-authorization";
import { Playbooks, playbookDefinition, playbookDraftTargetVersion, type PlaybookHead } from "../../operations/src/playbooks";
import { Reports, reportDefinitionSchema } from "../../operations/src/reports";
import { experimentSchema } from "../../lifecycle/src/experiments";
import { interventionSchema } from "../../lifecycle/src/interventions";
import { boundedLifecycleStructure } from "../../lifecycle/src/web-workspace";
import { createOnboardingFlowDraftAdapter } from "../../onboarding/src/flow-drafts";
import { AutomationService } from "../../automation/src/service";
import { flowDefinitionSchema } from "../../automation/src/definition";
import { automationLock } from "../../automation/src/quota";
import { targetTypes, retentionExpiry, type PlatformPolicy } from "./domain";
import {nativeCohortDefinition,lockNativeCohortConfig,draftNativeCohortConfig} from "./native-cohort-config";
import {validateNativeCohortBinding} from "./native-cohort-projections";
import type { RuleAuthorizationProof, TargetDraftAdapter } from "./service";

const experimentChanges = z.object({ definition: experimentSchema }).strict();
const onboardingChanges = z.object({ definition: onboardingConfigSchema }).strict();
const playbookChanges = z.object({ definition: playbookDefinition }).strict();
const automationChanges = z.object({ definition: flowDefinitionSchema }).strict();
const reportChanges = z.object({definition:reportDefinitionSchema}).strict();
type CurrentExperiment = { id: string; version: number; hash: string };
type CurrentAutomation = { id: string; draft_revision: number; active_revision: number | null; generation: number; state: string; semantic_hash: string };
/** Both the authoring CAS and activation state belong to the sealed target. */
export function automationDraftTargetVersion(current: Pick<CurrentAutomation, "draft_revision" | "active_revision" | "generation" | "state">): string {
  return `${current.draft_revision}:${current.active_revision ?? "none"}:${current.generation}:${current.state}`;
}

/** A typed registry is separate from action admission. In particular, wiring an
 * editor never changes the initial catalog's REVIEW_ONLY mode. The other native
 * editors explicitly report the missing atomicity/immutability contract. */
export function createTargetDraftAdapters(db: Database, proof?: RuleAuthorizationProof, policy?:PlatformPolicy): readonly TargetDraftAdapter[] {
  const revisions = domainRevisions(db);
  const blocked = (
    targetType: TargetDraftAdapter["targetType"], reason: string, nativeSource: string,
    validate?: (input: unknown) => unknown,
  ): TargetDraftAdapter => ({
    targetType, adapterId: `native:${targetType}:1`, nativeSource,
    writerCompatible: false, unavailableReason: reason,
    validateFields(input) { if (validate) return validate(input); assert(false, reason, 409); },
    async lockCurrent(): Promise<never> { assert(false, reason, 409); },
    async createDraft(): Promise<never> { assert(false, reason, 409); },
  });
  const registry = new Map<TargetDraftAdapter["targetType"], TargetDraftAdapter>(targetTypes.map(targetType => [targetType,
    blocked(targetType, "TYPED_EDITOR_NOT_REGISTERED", "NO_NATIVE_IMMUTABLE_DRAFT_CONTRACT"),
  ]));
  const add = (adapter: TargetDraftAdapter) => registry.set(adapter.targetType, adapter);
  add(createOnboardingFlowDraftAdapter(db,proof));
  for(const [targetType,kind] of [
    ["HELP_INTAKE_POLICY","HELP_BACKLOG_COHORT"],
    ["COMMUNITY_ENGAGEMENT_POLICY","ENGAGEMENT_CONTINUATION_COHORT"],
    ["EVENT_PROGRAM","EVENT_RSVP_ATTENDANCE_COHORT"],
  ] as const){
    const changesSchema=z.object({definition:nativeCohortDefinition.refine(value=>value.kind===kind)}).strict();
    add({
      targetType,adapterId:`native:${targetType}:1`,nativeSource:"packages/rules/src/native-cohort-config.ts:draftNativeCohortConfig",writerCompatible:true,
      validateFields(input){return changesSchema.parse(input);},
      async lockCurrent(tx,scope,id){
        const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
        const current=await lockNativeCohortConfig(tx,scope,id,now);
        assert(current.definition.kind===kind,"RULE_COHORT_CONFIG_KIND_MISMATCH",409);
        return {version:String(current.version),contentHash:current.contentHash};
      },
      async createDraft(tx,scope,actor,targetId,liveVersion,input){
        const changes=changesSchema.parse(input),authorize=async(connection:Tx)=>{
          await authorizeNative(connection,scope,actor,false);
          const at=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(connection)).rows[0]!.now;
          await validateNativeCohortBinding(connection,scope,changes.definition,at);
        };
        await authorize(tx);
        const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
        const current=await lockNativeCohortConfig(tx,scope,targetId,now);
        assert(current.definition.kind===kind&&String(current.version)===liveVersion,"TARGET_VERSION_MISMATCH",412);
        await validateNativeCohortBinding(tx,scope,current.definition,now);
        const end=retentionExpiry(policy,"CONFIG",now,new Date(current.expiresAt));
        const draft=await draftNativeCohortConfig(tx,scope,{sourceId:targetId,revisionId:randomUUID(),baseVersion:current.version,definition:changes.definition},now,end,authorize);
        await authorize(tx);
        return {draftId:draft.revisionId,immutableRevisionId:draft.revisionId,contentHash:draft.contentHash};
      },
    });
  }
  const reports=new Reports(db,{authorization:proof});
  for(const targetType of ["REPORT","REPORT_DEFINITION"] as const)add({
    targetType,adapterId:`native:${targetType}:1`,nativeSource:"packages/operations/src/reports.ts:Reports.draftInTransaction",writerCompatible:true,
    validateFields(input){return reportChanges.parse(input);},
    async lockCurrent(tx,scope,id){const current=await reports.currentDefinitionInTransaction(tx,scope,id,true);return {version:current.liveVersion,contentHash:current.contentHash};},
    async createDraft(tx,scope,actor,targetId,liveVersion,input){
      const changes=reportChanges.parse(input),authorize=(connection:Tx)=>authorizeNative(connection,scope,actor,false);
      await authorize(tx);const draft=await reports.draftInTransaction(tx,scope,actor,targetId,liveVersion,changes.definition,undefined,authorize);await authorize(tx);
      return {draftId:draft.draftId,immutableRevisionId:draft.headRevisionId,contentHash:draft.contentHash};
    },
  });

  async function authorizeNative(connection: Tx, scope: Scope, actor: Actor, experiment: boolean) {
    const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(connection)).rows[0]!.now;
    assertMaintenanceAuthorization(proof, scope, actor, now);
    await operationsAccess(connection, scope, actor, "CONFIGURE", experiment ? "experiments" : undefined);
    assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(connection)).rows.length, "RESOURCE_DELETED", 410);
    assertMaintenanceAuthorization(proof, scope, actor);
  }
  async function currentConfig(tx: Tx, scope: Scope, id: string, lock: boolean, domain: "experiment" | "onboarding"): Promise<CurrentExperiment> {
    z.uuid().parse(id);
    assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
    if (lock) await sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.guildId + ":config:" + domain},0))`.execute(tx);
    // Target identity is the actual published revision UUID. A newer head is a
    // conflict even though the old immutable revision still exists.
    const row = (await sql<CurrentExperiment>`SELECT r.id,r.version,r.hash FROM guild_config_heads h JOIN guild_config_revisions r ON r.organization_id=h.organization_id AND r.guild_id=h.guild_id AND r.id=h.revision_id AND r.domain=h.domain WHERE h.organization_id=${scope.organizationId}::uuid AND h.guild_id=${scope.guildId} AND h.domain=${domain} AND r.id=${id}::uuid AND r.state='published' ${lock ? sql`FOR UPDATE OF h,r` : sql``}`.execute(tx)).rows[0];
    assert(row, domain === "experiment" ? "EXPERIMENT_CURRENT_HEAD_MISMATCH" : "ONBOARDING_CURRENT_HEAD_MISMATCH", 412);
    return row;
  }
  async function currentOnboarding(tx: Tx, scope: Scope, id: string, lock: boolean) {
    const current = await currentConfig(tx, scope, id, lock, "onboarding");
    // Onboarding settings can also be changed through SettingsService. Include
    // its native CAS revision and effective typed fields, rather than assuming
    // the historical domain revision still equals the current settings.
    const settings = (await sql<{ revision: number; settings: unknown }>`SELECT revision,settings FROM guild_settings WHERE ${tenant(scope)} ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx)).rows[0];
    assert(settings, "ONBOARDING_CURRENT_SETTINGS_UNAVAILABLE", 409);
    const raw = settings.settings;
    assert(raw && typeof raw === "object" && !Array.isArray(raw), "ONBOARDING_CURRENT_SETTINGS_UNAVAILABLE", 409);
    const fields = raw as Record<string, unknown>;
    const definition = onboardingConfigSchema.parse({ onboardingMode: fields.onboardingMode, hybrid: fields.hybrid });
    return { version: `${current.version}:${settings.revision}`, contentHash: configHash({ headHash: current.hash, settingsRevision: settings.revision, definition }) };
  }
  async function currentAutomation(tx: Tx, scope: Scope, id: string, lock: boolean) {
    assert(/^[a-zA-Z0-9_-]{1,100}$/.test(id), "AUTOMATION_FLOW_ID_INVALID", 400);
    assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
    // This native host/guild fence must precede the target row and Suggestion.
    // saveInTransaction only reacquires that already held native fence.
    if (lock) await automationLock(tx, scope);
    const row = (await sql<CurrentAutomation>`SELECT f.id,f.draft_revision,f.active_revision,f.generation,f.state,r.semantic_hash FROM automation_flows f JOIN automation_revisions r ON r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.flow_id=f.id AND r.revision=f.draft_revision WHERE f.organization_id=${scope.organizationId}::uuid AND f.guild_id=${scope.guildId} AND f.id=${id} AND f.state<>'DELETED' ${lock ? sql`FOR UPDATE OF f` : sql``}`.execute(tx)).rows[0];
    assert(row, "AUTOMATION_FLOW_NOT_FOUND", 404);
    return row;
  }
  async function currentPlaybook(tx: Tx, scope: Scope, id: string, lock: boolean) {
    z.uuid().parse(id);
    assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
    if (lock) await operationsLock(tx, scope);
    const row = (await sql<PlaybookHead>`SELECT p.*,r.definition,r.revision FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id AND r.playbook_id=p.id WHERE p.organization_id=${scope.organizationId}::uuid AND p.guild_id=${scope.guildId} AND p.id=${id}::uuid ${lock ? sql`FOR UPDATE OF p` : sql``}`.execute(tx)).rows[0];
    assert(row, "PLAYBOOK_NOT_FOUND", 404);
    return row;
  }
  const playbooks = new Playbooks(db);
  add({
    targetType: "PLAYBOOK", adapterId: "native:PLAYBOOK:1",
    nativeSource: "packages/operations/src/playbooks.ts:Playbooks.draftInTransaction",
    // Definition/head/approval writers save/transition and the plan-state writer
    // share canonical scopes and the native operations fence. Worker timing
    // updates do not mutate any field of this sealed authoring target.
    writerCompatible: true,
    validateFields(input) { return playbookChanges.parse(input); },
    async lockCurrent(tx, scope, id) {
      const current = await currentPlaybook(tx, scope, id, true);
      return { version: playbookDraftTargetVersion(current), contentHash: configHash(playbookDefinition.parse(current.definition)) };
    },
    async createDraft(tx, scope, actor, targetId, liveVersion, input) {
      const changes = playbookChanges.parse(input);
      const authorize = (connection: Tx) => authorizeNative(connection, scope, actor, false);
      await authorize(tx);
      const current = await currentPlaybook(tx, scope, targetId, false);
      assert(playbookDraftTargetVersion(current) === liveVersion, "TARGET_VERSION_MISMATCH", 412);
      const draft = await playbooks.draftInTransaction(tx, scope, actor, targetId, liveVersion, changes.definition, authorize);
      await authorize(tx);
      return { draftId: draft.revisionId, immutableRevisionId: draft.revisionId, contentHash: draft.contentHash };
    },
  });
  const automation = new AutomationService(db);
  for (const targetType of ["AUTOMATION", "AUTOMATION_FLOW"] as const) add({
    targetType, adapterId: `native:${targetType}:1`,
    nativeSource: "packages/automation/src/service.ts:AutomationService.saveInTransaction",
    writerCompatible: true,
    validateFields(input) { return automationChanges.parse(input); },
    async lockCurrent(tx, scope, id) {
      const current = await currentAutomation(tx, scope, id, true);
      return { version: automationDraftTargetVersion(current), contentHash: current.semantic_hash };
    },
    async createDraft(tx, scope, actor, targetId, liveVersion, input) {
      const changes = automationChanges.parse(input);
      assert(changes.definition.id === targetId && changes.definition.guildId === scope.guildId, "AUTOMATION_GUILD_MISMATCH", 403);
      const authorize = (connection: Tx) => authorizeNative(connection, scope, actor, false);
      await authorize(tx);
      const current = await currentAutomation(tx, scope, targetId, false);
      assert(automationDraftTargetVersion(current) === liveVersion, "TARGET_VERSION_MISMATCH", 412);
      const saved = await automation.saveInTransaction(tx, scope, actor, {
        definition: changes.definition, expectedRevision: current.draft_revision, requestId: randomUUID(),
      }, undefined, authorize, { kind: "RULE_TYPED_DRAFT", targetId, liveVersion });
      // Native checks/enablement remain a separate explicit workflow. A saved
      // revision does not inherit VALIDATE/TEST/IMPACT receipts or activation.
      const revision = (await sql<{ semantic_hash: string }>`SELECT semantic_hash FROM automation_revisions WHERE ${tenant(scope)} AND flow_id=${targetId} AND revision=${saved.draftRevision}`.execute(tx)).rows[0];
      assert(revision, "AUTOMATION_REVISION_NOT_FOUND", 404);
      await authorize(tx);
      return { draftId: targetId, immutableRevisionId: `${targetId}:${saved.draftRevision}`, contentHash: revision.semantic_hash };
    },
  });
  add({
    targetType: "EXPERIMENT", adapterId: "native:EXPERIMENT:1",
    nativeSource: "packages/settings/src/revisions.ts:RevisionService.draftInTransaction",
    // RevisionService is the sole native revision/head writer; both draft and
    // publish acquire canonical scope locks before the native domain lock.
    writerCompatible: true,
    validateFields(input) {
      assert(boundedLifecycleStructure(input), "INVALID_REQUEST", 400);
      return experimentChanges.parse(input);
    },
    async lockCurrent(tx, scope, id) {
      const current = await currentConfig(tx, scope, id, true, "experiment");
      return { version: String(current.version), contentHash: current.hash };
    },
    async createDraft(tx, scope, actor, targetId, liveVersion, input) {
      assert(boundedLifecycleStructure(input), "INVALID_REQUEST", 400);
      const changes = experimentChanges.parse(input);
      const authorize = (connection: Tx) => authorizeNative(connection, scope, actor, true);
      await authorize(tx);
      const current = await currentConfig(tx, scope, targetId, false, "experiment");
      assert(String(current.version) === liveVersion, "TARGET_VERSION_MISMATCH", 412);
      for (const variant of changes.definition.variants) if (variant.interventionRevisionId) {
        const source = await revisions.get(scope, variant.interventionRevisionId, tx);
        assert(source.domain === "intervention" && source.state === "published", "INTERVENTION_NOT_PUBLISHED", 409);
        interventionSchema.parse(source.definition);
      }
      const id = await revisions.draftInTransaction(tx, scope, actor, "experiment", changes.definition, authorize);
      const draft = await revisions.get(scope, id, tx);
      assert(draft.domain === "experiment" && draft.state === "draft", "DRAFT_RESULT_INVALID", 500);
      await authorize(tx);
      return { draftId: draft.id, immutableRevisionId: draft.id, contentHash: draft.hash };
    },
  });
  add({
    targetType: "ONBOARDING", adapterId: "native:ONBOARDING:1",
    nativeSource: "packages/settings/src/revisions.ts:RevisionService.draftInTransaction",
    writerCompatible: true,
    validateFields(input) {
      assert(boundedLifecycleStructure(input), "INVALID_REQUEST", 400);
      return onboardingChanges.parse(input);
    },
    lockCurrent(tx, scope, id) { return currentOnboarding(tx, scope, id, true); },
    async createDraft(tx, scope, actor, targetId, liveVersion, input) {
      assert(boundedLifecycleStructure(input), "INVALID_REQUEST", 400);
      const changes = onboardingChanges.parse(input);
      const authorize = (connection: Tx) => authorizeNative(connection, scope, actor, false);
      await authorize(tx);
      assert((await currentOnboarding(tx, scope, targetId, false)).version === liveVersion, "TARGET_VERSION_MISMATCH", 412);
      const id = await revisions.draftInTransaction(tx, scope, actor, "onboarding", changes.definition, authorize);
      const draft = await revisions.get(scope, id, tx);
      assert(draft.domain === "onboarding" && draft.state === "draft", "DRAFT_RESULT_INVALID", 500);
      await authorize(tx);
      return { draftId: draft.id, immutableRevisionId: draft.id, contentHash: draft.hash };
    },
  });
  return Object.freeze([...registry.values()].map(adapter => Object.freeze(adapter)));
}
