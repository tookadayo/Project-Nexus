import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql, tenant, type Tx} from "../../db/src/index";
import {assert, isDomainError, type Scope} from "../../shared/src/index";
import type {Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {canonicalDecimal, canonicalRuleTimestamp, canonicalRuleJson, hashRuleValue, immutableSourceHealthId, normalizeFact, normalizeSourceHealth, timestampMicros, type FactSnapshot, type FactValue, type RuleTarget, type SourceHealthObservation, type SourceHealthRef} from "./facts";
import {expandRuleInputRefs, loadRuleFacts} from "./fact-storage";
import {adaptAuthorizedFact, projectRuntimeOutcomes, type AuthorizedSourceProjection, type RuntimeOutcomeRow} from "./source-adapters";
import {registeredRule, METRIC_CATALOG, assertRegisteredFact} from "./rule-catalog";
import {ALPHA16_RETENTION_CONTRACT} from "./retention-contract";
import {readNativeCohortProjection,type NativeCohortKind} from "./native-cohort-projections";
import {readIssueRegistryCandidate} from "./issue-registry";
import {readNativeReportProjection} from "./native-report-projections";
import {readNativeExecutionObservation,readNativePermissionRequirements} from "./native-execution-permission-projections";
import type {RuleEngineConfig} from "./rule-config";
import {automationDraftTargetVersion} from "./typed-drafts";

import {nativeSourceRequest,type NativeSourceRequest} from "./native-source-request";
export {nativeSourceRequest,type NativeSourceRequest} from "./native-source-request";
/** Server-owned certification only. Browser requests never supply this object. */
export interface NativeProjectionRegistration extends AuthorizedSourceProjection {
  scope: Scope; actorHash: string; expiresAt: string; visibilityVerifiedAt: string;
  nativeId: string; target: RuleTarget;
}
export interface NativeSourceAuthority {scope: Scope; actorHash: string; expiresAt: Date;}
export interface NativeProjectionCandidate {
  sourceType: string; metricId: string; target: RuleTarget; value: FactValue | null;
  observedAt: string; expiresAt: string | null; sourceRevision: string;
  windowStart: string | null; windowEnd: string | null; periodRole: "CURRENT" | "PREVIOUS";
  sampleSize: string | null; sealable: boolean; reasonCodes: readonly string[];
  comparison?:FactSnapshot['comparison'];
  nativeDefinitionRef?:{sourceId:string;revisionId:string;contentHash:string};
  /** New immutable health from a proved native source assessment. A fresh
   * aggregate assessment keeps its asOf separate from actual business ingest;
   * existing health refs are still reused without copying. */
  generatedHealth?:readonly SourceHealthObservation[];
}
export interface NativeSourceDiagnostic {
  kind: NativeSourceRequest["kind"]; sourceType: string; status: "PROJECTED" | "REUSED" | "UNKNOWN" | "DISABLED"; reasonCodes: readonly string[];
  /** Only desired target/contract metadata, never an observed count or a
   * synthetic source identity/timestamp/expiry. */
  ruleId?: string; metricIds?: readonly string[]; requiredSourceTypes?: readonly string[]; target?: RuleTarget;
  requestedWindow?: {start: string; end: string; periodRole: "CURRENT" | "PREVIOUS"};
  projectionStatus?: "CONTRACT_CONNECTED_NATIVE_PROJECTION_UNAVAILABLE";
}
export interface NativeSourceReadResult {
  facts: FactSnapshot[]; sourceHealth: SourceHealthObservation[];
  generatedHealth:SourceHealthObservation[];
  /** Actual native observations also survive a closed business-Fact batch.
   * A separate explicit health read/persistence may consume these; Fact
   * callers never silently publish a partial set. */
  observedHealth:{metricId:string;observation:SourceHealthObservation}[];
  reusedHealthRefs: SourceHealthRef[]; diagnostics: NativeSourceDiagnostic[];
}
/** Implementation exists separately from its operational registration/gates. */
export const NATIVE_SOURCE_READERS = Object.freeze([
  {sourceType: "runtime_run_outcome_v1", reader: "TYPED_NATIVE_READER", completeness: "CONDITIONAL_ON_OPERATIONAL_APPROVAL_HEALTH_AND_RETAINED_WINDOW"},
  {sourceType: "ReportOperationalStatusAdapter", reader: "TYPED_NATIVE_READER", completeness: "NATIVE_IMMUTABLE_TEMPLATE_MAPPING_AND_SEPARATE_GENERATION_DELIVERY_RETENTION"},
  {sourceType: "experiment_registry_v1", reader: "TYPED_NATIVE_READER", completeness: "EXPLICIT_CURRENT_NATIVE_ISSUE_MAPPING_REQUIRED"},
  {sourceType: "playbook_mapping_registry_v1", reader: "TYPED_NATIVE_READER", completeness: "EXPLICIT_CURRENT_NATIVE_ISSUE_MAPPING_REQUIRED"},
  {sourceType: "source_health_observation_v1", reader: "IMMUTABLE_REFERENCE_READER", completeness: "EXACT_EXISTING_REF_ONLY"},
  ...(["ONBOARDING_AGGREGATE_V1","INTAKE_STATUS_AGGREGATE_V1","PERMITTED_ENGAGEMENT_AGGREGATE_V1","ChannelParticipationAggregateAdapter","EventParticipationAggregateAdapter"] as const).map(sourceType=>({sourceType,reader:"TYPED_COHORT_SQL_READER" as const,completeness:sourceType==="INTAKE_STATUS_AGGREGATE_V1"?"ELIGIBLE_COHORT_CONNECTED_FIRST_RESPONSE_AND_STALLED_SOURCE_MISSING":"CURRENT_DEFINITION_RETAINED_COMPLETE_NATIVE_WINDOW_REQUIRED"})),
  {sourceType:"runtime_execution_observation_v1",reader:"TYPED_NATIVE_READER",completeness:"AUTHORITATIVE_EXECUTION_OBSERVATIONS_AND_APPROVED_GRACE_REQUIRED"},
  {sourceType:"permission_observation_v1",reader:"TYPED_NATIVE_READER",completeness:"CURRENT_REQUIREMENT_EPOCH_AND_MATCHED_HEALTH_REQUIRED"},
  {sourceType:"permission_requirement_registry_v1",reader:"TYPED_NATIVE_READER",completeness:"CURRENT_ENABLED_NATIVE_REQUIREMENT_EPOCH_EXACT_PAIR"},
  {sourceType:"structured_issue_registry_v1",reader:"TYPED_NATIVE_READER",completeness:"REGISTERED_BASE_ISSUE_AND_RETAINED_PERIOD_RESULTS_REQUIRED"},
] as const);
/** Compatibility diagnostics for callers that have not selected a typed
 * source/config reference. Actual dispatch below now owns the readers. */
export const BLOCKED_NATIVE_SOURCE_CONTRACTS = Object.freeze([
  {kind: "ONBOARDING_FIRST_ACTION", ruleId: "ONB-001", sourceType: "ONBOARDING_AGGREGATE_V1", reasonCodes: ["MATURE_ONBOARDING_AND_FIRST_ACTION_INTERSECTION_REQUIRED", "ONBOARDING_NATIVE_REVISION_BINDING_UNVERIFIED"]},
  {kind: "HELP_BACKLOG_COHORT", ruleId: "HELP-001", sourceType: "INTAKE_STATUS_AGGREGATE_V1", reasonCodes: ["SLA_ELAPSED_OR_STRUCTURED_STALLED_COHORT_REQUIRED", "HELP_SLA_POLICY_REVISION_UNVERIFIED"]},
  {kind: "ENGAGEMENT_CONTINUATION_COHORT", ruleId: "RET-001", sourceType: "PERMITTED_ENGAGEMENT_AGGREGATE_V1", reasonCodes: ["PREVIOUS_ACTIVE_COHORT_INTERSECTION_REQUIRED", "RET_PERMISSION_ELIGIBLE_PERIODS_UNVERIFIED"]},
  {kind: "CHANNEL_PARTICIPATION_COHORT", ruleId: "ENG-001", sourceType: "ChannelParticipationAggregateAdapter", reasonCodes: ["MATCHED_ELIGIBLE_CHANNEL_AND_GUILD_POPULATION_REQUIRED"]},
  {kind: "EVENT_RSVP_ATTENDANCE_COHORT", ruleId: "EVENT-001", sourceType: "EventParticipationAggregateAdapter", reasonCodes: ["MATCHED_CONFIRMED_RSVP_ATTENDANCE_COHORT_REQUIRED", "EVENT_CAMPAIGN_MATURITY_BINDING_UNVERIFIED"]},
  {kind: "AUTO_EXECUTION_OBSERVATION", ruleId: "AUTO-002", sourceType: "runtime_execution_observation_v1", reasonCodes: ["AUTHORITATIVE_DUE_DEADLINE_LEASE_HEARTBEAT_REQUIRED", "RUNTIME_EXECUTION_UNIT_AND_COVERAGE_UNVERIFIED"]},
  {kind: "PERMISSION_REQUIREMENTS", ruleId: "PERM-001", sourceType: "permission_observation_v1", reasonCodes: ["APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED", "PERMISSION_REQUIREMENT_OBSERVATION_PAIRING_UNVERIFIED"]},
] as const);
type BlockedNativeKind = typeof BLOCKED_NATIVE_SOURCE_CONTRACTS[number]["kind"];
type BlockedNativeRequest = Extract<NativeSourceRequest, {kind: BlockedNativeKind}>;
for (const contract of BLOCKED_NATIVE_SOURCE_CONTRACTS) {Object.freeze(contract.reasonCodes); Object.freeze(contract);}
const sourceFor = (kind: NativeSourceRequest["kind"]) => ({AUTO_RUN_OUTCOMES: "runtime_run_outcome_v1", REPORT_DELIVERY: "ReportOperationalStatusAdapter",REPORT_GENERATION_STATE:"ReportOperationalStatusAdapter", EXPERIMENT_STATE: "experiment_registry_v1", PLAYBOOK_STATE: "playbook_mapping_registry_v1", DATA_SOURCE_HEALTH: "source_health_observation_v1",
  ONBOARDING_FIRST_ACTION: "ONBOARDING_AGGREGATE_V1", HELP_BACKLOG_COHORT: "INTAKE_STATUS_AGGREGATE_V1", ENGAGEMENT_CONTINUATION_COHORT: "PERMITTED_ENGAGEMENT_AGGREGATE_V1", CHANNEL_PARTICIPATION_COHORT: "ChannelParticipationAggregateAdapter", EVENT_RSVP_ATTENDANCE_COHORT: "EventParticipationAggregateAdapter", AUTO_EXECUTION_OBSERVATION: "runtime_execution_observation_v1", PERMISSION_REQUIREMENTS: "permission_observation_v1",STRUCTURED_ISSUE_PERIODS:"structured_issue_registry_v1"})[kind];
const sameTarget = (a: RuleTarget, b: RuleTarget) => canonicalRuleJson(a) === canonicalRuleJson(b);
const iso = (value: Date) => canonicalRuleTimestamp(value.toISOString());
const minimum = (...values: string[]) => values.reduce((a, b) => timestampMicros(a) <= timestampMicros(b) ? a : b);
const boundedEnd = (at: string) => iso(new Date(Date.parse(at) + ALPHA16_RETENTION_CONTRACT.factSnapshot.maximumSeconds * 1000));
function windowGuard(request: Extract<NativeSourceRequest, {windowStart: string}>, now: string) {
  assert(timestampMicros(request.windowStart) < timestampMicros(request.windowEnd) && timestampMicros(request.windowEnd) <= timestampMicros(now), "RULE_NATIVE_WINDOW_INVALID");
}
/** Pure diagnostic assembly for source semantics that cannot be established
 * from the known native DTOs. No fallback SQL, cohort inference or zero fill. */
export function blockedNativeSourceDiagnostic(request: BlockedNativeRequest, now: string): NativeSourceDiagnostic {
  windowGuard(request, now);
  const contract = BLOCKED_NATIVE_SOURCE_CONTRACTS.find(value => value.kind === request.kind)!;
  const rule = registeredRule(contract.ruleId)!;
  const targetId = request.kind === "CHANNEL_PARTICIPATION_COHORT" ? request.channelId : request.kind === "AUTO_EXECUTION_OBSERVATION" ? request.flowId : request.targetId;
  const liveVersion = request.kind === "AUTO_EXECUTION_OBSERVATION" ? String(request.liveRevision) : request.liveVersion;
  return {kind: request.kind, sourceType: contract.sourceType, ruleId: rule.ruleId, metricIds: rule.metricIds, requiredSourceTypes: rule.sourceTypes,
    target: {targetType: rule.targetType, targetId, liveVersion}, requestedWindow: {start: canonicalRuleTimestamp(request.windowStart), end: canonicalRuleTimestamp(request.windowEnd), periodRole: request.periodRole},
    status: "UNKNOWN", projectionStatus: "CONTRACT_CONNECTED_NATIVE_PROJECTION_UNAVAILABLE", reasonCodes: contract.reasonCodes};
}
async function readClock(tx: Tx) {return iso((await sql<{at: Date}>`SELECT clock_timestamp() AS at`.execute(tx)).rows[0]!.at);}
function requireAuthority(scope: Scope, actor: Actor, authority: NativeSourceAuthority | undefined, now: string) {
  assert(authority && authority.scope.organizationId === scope.organizationId && authority.scope.guildId === scope.guildId && authority.actorHash === actor.key && authority.expiresAt.getTime() > Date.parse(now), "RULE_NATIVE_CURRENT_AUTHORITY_REQUIRED", 403);
}
async function selectedHealth(tx: Tx, scope: Scope, refs: readonly SourceHealthRef[]) {
  const expanded = await expandRuleInputRefs(tx, scope, refs.map(value => ({kind: "SOURCE_HEALTH" as const, id: value.observationId, revision: value.revision})));
  const data = await loadRuleFacts(tx, scope, expanded);
  return {values: data.sourceHealth, expiresAt: iso(expanded.expiresAt)};
}
function coverageMinimum(values: readonly string[]): string {
  const units = (value: string) => {const [whole = "0", fraction = ""] = canonicalDecimal(value).split("."); return BigInt(whole) * 1000000000000000000n + BigInt(fraction.padEnd(18, "0"));};
  return values.reduce((a, b) => units(a) <= units(b) ? a : b);
}

interface NativeRunRow {id: string; revision: number; status: string; ended_at: Date | null; deadline_at: Date; updated_at: Date;}
/** Pure status projection; WAITING_APPROVAL is unfinished, and UNKNOWN stays UNKNOWN. */
export function nativeRuntimeOutcomes(rows: readonly NativeRunRow[]) {
  const projected: RuntimeOutcomeRow[] = rows.map(row => ({runId: row.id, revision: String(row.revision), status: (row.status === "WAITING_APPROVAL" ? "WAITING" : row.status) as RuntimeOutcomeRow["status"]}));
  return projectRuntimeOutcomes(projected);
}
async function runtimeCandidate(tx: Tx, scope: Scope, request: Extract<NativeSourceRequest, {kind: "AUTO_RUN_OUTCOMES"}>, now: string): Promise<NativeProjectionCandidate> {
  windowGuard(request, now);
  const flow = (await sql<{draft_revision:number;active_revision: number | null;generation:number;state:string}>`SELECT draft_revision,active_revision,generation,state FROM automation_flows WHERE ${tenant(scope)} AND id=${request.flowId} AND state<>'DELETED'`.execute(tx)).rows[0];
  const target = {targetType: "AUTOMATION_FLOW", targetId: request.flowId, liveVersion: flow?automationDraftTargetVersion(flow):String(request.liveRevision)};
  const empty = (reason: string): NativeProjectionCandidate => ({sourceType: sourceFor(request.kind), metricId: "automation.run.confirmed_failure_rate", target, value: null, observedAt: now, expiresAt: null, sourceRevision: "unavailable", windowStart: request.windowStart, windowEnd: request.windowEnd, periodRole: request.periodRole, sampleSize: null, sealable: false, reasonCodes: [reason]});
  if (!flow || flow.active_revision !== request.liveRevision) return empty("NATIVE_LIVE_REVISION_MISMATCH");
  // A wider period could have already lost terminal rows. Do not interpret its
  // remaining records as complete coverage after the existing seven-day purge.
  if (timestampMicros(request.windowStart) <= timestampMicros(now) - BigInt(ALPHA16_RETENTION_CONTRACT.runDerived.maximumSeconds) * 1000000n) return empty("NATIVE_RUN_WINDOW_EXCEEDS_RETAINED_COVERAGE");
  if((await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND requested_at>=${request.windowStart}::timestamptz LIMIT 1`.execute(tx)).rows.length)return empty("NATIVE_RUN_COVERAGE_PRIVACY_GAP");
  const rows = (await sql<NativeRunRow>`SELECT id,revision,status,ended_at,deadline_at,updated_at FROM automation_runs WHERE ${tenant(scope)} AND flow_id=${request.flowId} AND revision=${request.liveRevision} AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=automation_runs.organization_id AND d.guild_id=automation_runs.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=automation_runs.actor_hash)) AND ((started_at>=${request.windowStart}::timestamptz AND started_at<${request.windowEnd}::timestamptz) OR (ended_at>=${request.windowStart}::timestamptz AND ended_at<${request.windowEnd}::timestamptz)) ORDER BY id LIMIT 2001`.execute(tx)).rows;
  if (rows.length > 2000) return empty("NATIVE_SOURCE_LIMIT_EXCEEDED");
  if(!rows.length)return empty("NATIVE_RUN_NO_OUTCOME_OBSERVATION");
  const observedAt = now;
  if (rows.some(row => row.ended_at && row.ended_at.getTime() > Date.parse(observedAt) || row.updated_at.getTime() > Date.parse(observedAt))) return empty("NATIVE_SOURCE_TIME_UNVERIFIED");
  const terminal = new Set(["COMPLETED", "FAILED", "UNKNOWN", "CANCELLED", "EXPIRED"]);
  if (rows.some(row => terminal.has(row.status) !== (row.ended_at !== null))) return empty("NATIVE_RUN_TERMINAL_STATE_UNVERIFIED");
  const sourceEnd = rows.length ? minimum(...rows.map(row => iso(new Date((row.ended_at ?? row.deadline_at).getTime() + ALPHA16_RETENTION_CONTRACT.runDerived.maximumSeconds * 1000)))) : boundedEnd(observedAt);
  let value: ReturnType<typeof nativeRuntimeOutcomes>;
  try {value = nativeRuntimeOutcomes(rows);} catch {return empty("NATIVE_RUN_OUTCOME_UNREGISTERED");}
  const expiresAt=minimum(sourceEnd,boundedEnd(observedAt)),sourceRevision=hashRuleValue({target,windowStart:request.windowStart,windowEnd:request.windowEnd,rows:rows.map(row=>({id:row.id,revision:row.revision,status:row.status,updatedAt:iso(row.updated_at),terminalAt:row.ended_at?iso(row.ended_at):null}))}),lastIngest=rows.map(row=>iso(row.updated_at)).reduce((a,b)=>timestampMicros(a)>=timestampMicros(b)?a:b),sourceType=sourceFor(request.kind);
  const health:SourceHealthObservation={observationId:immutableSourceHealthId(scope,sourceType,sourceRevision,observedAt,target),revision:sourceRevision,sourceType,observedAt,expiresAt,quality:"SUFFICIENT",state:"HEALTHY",lastSuccessfulIngestAt:lastIngest,neverSucceeded:false,coverage:"1",target};
  return {sourceType, metricId: "automation.run.confirmed_failure_rate", target, value, observedAt,expiresAt,sourceRevision,
    windowStart: request.windowStart, windowEnd: request.windowEnd, periodRole: request.periodRole, sampleSize: String(rows.length), sealable: true, reasonCodes: [],generatedHealth:[health]};
}

export {nativeReportDeliveryOutcomes,type NativeReportDeliveryRow} from "./native-report-projections";
function registrationFor(candidate: NativeProjectionCandidate, scope: Scope, actor: Actor, registrations: readonly NativeProjectionRegistration[], now: string) {
  const matching = registrations.filter(value => value.approved && value.authorizationReference && value.scope.organizationId === scope.organizationId && value.scope.guildId === scope.guildId && value.actorHash === actor.key
    && value.sourceType === candidate.sourceType && value.nativeId === candidate.target.targetId && sameTarget(value.target, candidate.target) && value.metricIds.includes(candidate.metricId)
    && Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) > Date.parse(now) && Number.isFinite(Date.parse(value.visibilityVerifiedAt)) && Date.parse(value.visibilityVerifiedAt) <= Date.parse(now)
    && Date.parse(now) - Date.parse(value.visibilityVerifiedAt) <= 10000);
  return matching.length === 1 ? matching[0] : undefined;
}
/** Internal transaction-only reader. It never grants registration/retention,
 * collects content, creates health successes, writes rows or runs an engine. */
export async function readNativeRuleSources(tx: Tx, scope: Scope, actor: Actor, raw: unknown, options: {authority?: NativeSourceAuthority; registrations?: readonly NativeProjectionRegistration[];engineConfig?:RuleEngineConfig;evaluationAsOf?:string} = {}): Promise<NativeSourceReadResult> {
  assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
  assert(actor.source === "WEB_DASHBOARD" || actor.source === "DISCORD_PANEL", "CURRENT_USER_REQUIRED", 403);
  const requests = z.array(nativeSourceRequest).min(1).max(20).parse(raw), clock = await readClock(tx),now=options.evaluationAsOf?canonicalRuleTimestamp(options.evaluationAsOf):clock;
  assert(timestampMicros(now)<=timestampMicros(clock),"NATIVE_EVALUATION_AS_OF_IN_FUTURE",400);
  requireAuthority(scope, actor, options.authority, clock); await operationsAccess(tx, scope, actor, "ANALYZE");
  const result: NativeSourceReadResult = {facts: [], sourceHealth: [],generatedHealth:[],observedHealth:[], reusedHealthRefs: [], diagnostics: []}, slots = new Set<string>();
  for (const request of requests) {
    const sourceType = sourceFor(request.kind);
    const cohortKinds:readonly NativeCohortKind[]=["ONBOARDING_FIRST_ACTION","HELP_BACKLOG_COHORT","ENGAGEMENT_CONTINUATION_COHORT","CHANNEL_PARTICIPATION_COHORT","EVENT_RSVP_ATTENDANCE_COHORT"];
    const cohort=cohortKinds.includes(request.kind as NativeCohortKind);
    const relation = cohort?"rule_native_cohort_revisions":request.kind === "AUTO_RUN_OUTCOMES"||request.kind==="AUTO_EXECUTION_OBSERVATION" ? "automation_runs" : request.kind === "REPORT_DELIVERY"||request.kind==="REPORT_GENERATION_STATE" ? "report_runs" : ["EXPERIMENT_STATE","PLAYBOOK_STATE","STRUCTURED_ISSUE_PERIODS"].includes(request.kind) ? "rule_issue_registry" : "rule_source_health";
    const present = (await sql<{present: boolean}>`SELECT to_regclass(${relation}) IS NOT NULL AS present`.execute(tx)).rows[0]?.present;
    if (!present) {result.diagnostics.push({kind: request.kind, sourceType, status: "UNKNOWN", reasonCodes: ["NATIVE_SOURCE_SCHEMA_UNAVAILABLE"]}); continue;}
    if (request.kind === "DATA_SOURCE_HEALTH") {
      let selected: Awaited<ReturnType<typeof selectedHealth>>;
      try {selected = await selectedHealth(tx, scope, [request.healthRef]);}
      catch (error) {if (isDomainError(error) && ["RULE_HEALTH_REF_UNAVAILABLE", "RULE_INPUT_REF_UNAVAILABLE"].includes(error.code)) {result.diagnostics.push({kind: request.kind, sourceType, status: "UNKNOWN", reasonCodes: ["NATIVE_SOURCE_HEALTH_MISSING_OR_EXPIRED"]}); continue;} throw error;}
      const value = selected.values[0]!;
      if (value.target.targetType !== "DATA_SOURCE_METRIC") {result.diagnostics.push({kind: request.kind, sourceType, status: "UNKNOWN", reasonCodes: ["DATA_SOURCE_METRIC_TARGET_REQUIRED"]}); continue;}
      // Reuse the exact immutable observation. Its effective DB expiry remains
      // authoritative and no INSERT is performed for these refs by the caller.
      result.sourceHealth.push(normalizeSourceHealth(value)); result.reusedHealthRefs.push(request.healthRef);
      result.diagnostics.push({kind: request.kind, sourceType, status: "REUSED", reasonCodes: []}); continue;
    }
    let candidates:NativeProjectionCandidate[];
    if(cohort)candidates=await readNativeCohortProjection(tx,scope,actor,request as Extract<NativeSourceRequest,{kind:NativeCohortKind}>,now);
    else if(request.kind==="AUTO_EXECUTION_OBSERVATION"){
      if(!options.engineConfig){result.diagnostics.push({kind:request.kind,sourceType,status:"DISABLED",reasonCodes:["NATIVE_APPROVED_RULE_CONFIG_REQUIRED"]});continue;}
      candidates=await readNativeExecutionObservation(tx,scope,actor,request,{evaluationAsOf:options.evaluationAsOf??now,config:options.engineConfig});
    }else if(request.kind==="PERMISSION_REQUIREMENTS")candidates=await readNativePermissionRequirements(tx,scope,actor,request,{evaluationAsOf:options.evaluationAsOf??now});
    else if(request.kind==="AUTO_RUN_OUTCOMES")candidates=[await runtimeCandidate(tx,scope,request,now)];
    else if(request.kind==="REPORT_DELIVERY"||request.kind==="REPORT_GENERATION_STATE")candidates=await readNativeReportProjection(tx,scope,actor,request,now);
    else if(request.kind==="EXPERIMENT_STATE"||request.kind==="PLAYBOOK_STATE"||request.kind==="STRUCTURED_ISSUE_PERIODS")candidates=[await readIssueRegistryCandidate(tx,scope,actor,request,now)];
    else {assert(false,"NATIVE_SOURCE_KIND_UNSUPPORTED",400);}
    if(candidates.length===0){result.diagnostics.push({kind:request.kind,sourceType,status:"UNKNOWN",reasonCodes:["NATIVE_SOURCE_RETURNED_NO_OBSERVATION"]});continue;}
    for(const candidate of candidates){
    result.observedHealth.push(...(candidate.generatedHealth??[]).map(observation=>({metricId:candidate.metricId,observation:normalizeSourceHealth(observation)})));
    const slot = canonicalRuleJson([candidate.sourceType, candidate.metricId, candidate.target, candidate.periodRole]);
    if (slots.has(slot)) {result.diagnostics.push({kind: request.kind, sourceType, status: "DISABLED", reasonCodes: ["NATIVE_DUPLICATE_METRIC_TARGET_PERIOD"]}); continue;} slots.add(slot);
    if (!candidate.sealable || candidate.value === null || candidate.expiresAt === null || candidate.windowStart === null || candidate.windowEnd === null) {result.diagnostics.push({kind: request.kind, sourceType, status: "UNKNOWN", reasonCodes: candidate.reasonCodes}); continue;}
    const observedNow = await readClock(tx); requireAuthority(scope, actor, options.authority, observedNow);
    const registration = registrationFor(candidate, scope, actor, options.registrations ?? [], observedNow);
    // Closed, server-owned native readers prove their precise source contract;
    // a selected config is not an approval. Persistence still requires the
    // independently approved OPERATIONAL rule config and retention policy.
    const approved=options.engineConfig?.profile==="OPERATIONAL"&&options.engineConfig.approval==="APPROVED"&&options.engineConfig.retentionApproved&&options.engineConfig.approvedSourceTypes.includes(candidate.sourceType)&&(candidate.generatedHealth??[]).every(value=>options.engineConfig!.approvedSourceTypes.includes(value.sourceType));
    if (!registration&&!approved) {result.diagnostics.push({kind: request.kind, sourceType, status: "DISABLED", reasonCodes: ["NATIVE_PROJECTION_SOURCE_NOT_APPROVED"]}); continue;}
    const refs = "healthRefs" in request ? request.healthRefs??[] : [];
    let health: Awaited<ReturnType<typeof selectedHealth>>;
    const generated=(candidate.generatedHealth??[]).map(normalizeSourceHealth);
    if(!generated.length&&!refs.length){result.diagnostics.push({kind:request.kind,sourceType,status:"UNKNOWN",reasonCodes:["NATIVE_SOURCE_HEALTH_MISSING_OR_EXPIRED"]});continue;}
    try {const selected=refs.length?await selectedHealth(tx,scope,refs):null;health={values:[...generated,...(selected?.values??[])],expiresAt:minimum(...generated.map(value=>value.expiresAt),...(selected?[selected.expiresAt]:[]))};}
    catch (error) {if (isDomainError(error) && ["RULE_HEALTH_REF_UNAVAILABLE", "RULE_INPUT_REF_UNAVAILABLE"].includes(error.code)) {result.diagnostics.push({kind: request.kind, sourceType, status: "UNKNOWN", reasonCodes: ["NATIVE_SOURCE_HEALTH_MISSING_OR_EXPIRED"]}); continue;} throw error;}
    const requiredSources=candidate.sourceType==="permission_observation_v1"?["permission_observation_v1","permission_requirement_registry_v1"]:[candidate.sourceType];
    const matching = health.values.filter(value => requiredSources.includes(value.sourceType) && sameTarget(value.target, candidate.target));
    if (matching.length !== health.values.length || requiredSources.some(type=>!matching.some(value=>value.sourceType===type)) || matching.some(value => value.quality !== "SUFFICIENT" || value.state === "UNKNOWN" || value.coverage === null || timestampMicros(value.observedAt) > timestampMicros(now))) {
      result.diagnostics.push({kind: request.kind, sourceType, status: "UNKNOWN", reasonCodes: ["NATIVE_SOURCE_HEALTH_OR_COVERAGE_UNVERIFIED"]}); continue;
    }
    const coverage = coverageMinimum(matching.map(value => value.coverage!));
    const metric=METRIC_CATALOG.find(value=>value.metricId===candidate.metricId&&value.sourceType===candidate.sourceType);assert(metric,"RULE_METRIC_CONTRACT_MISMATCH",500);
    const candidateRefs=[...refs,...generated.map(value=>({observationId:value.observationId,revision:value.revision}))];
    const fact: FactSnapshot = {factId: randomUUID(), snapshotId: randomUUID(), metricId: candidate.metricId, metricDefinitionVersion: "1", dimension: {}, periodRole: candidate.periodRole,
      windowStart: candidate.windowStart, windowEnd: candidate.windowEnd, sourceType:candidate.sourceType, sourceRevision: candidate.sourceRevision, observedAt: candidate.observedAt,
      expiresAt: minimum(candidate.expiresAt, health.expiresAt,...(registration?[registration.expiresAt]:[])), sourceHealthRefs: candidateRefs, quality: "SUFFICIENT", value: candidate.value, unit: metric.unit, target: candidate.target, coverage, sampleSize: candidate.sampleSize,
      ...(candidate.comparison?{comparison:candidate.comparison}:candidate.sourceType==="runtime_run_outcome_v1"?{comparison:{cohortDefinitionVersion: "native-run-start-or-terminal-v1", campaignClass: "NATIVE_REVISION_RUNS", maturityOffset: "0", windowKind: "ELAPSED" as const, timeZone: "UTC", cohortId: hashRuleValue(candidate.target)}}:{})};
    const normalized=registration?adaptAuthorizedFact(fact,registration):normalizeFact(fact);assertRegisteredFact(normalized);
    result.facts.push(normalized); result.sourceHealth.push(...matching);
    if(generated.length)result.generatedHealth.push(...generated);result.reusedHealthRefs.push(...refs);
    result.diagnostics.push({kind: request.kind, sourceType, status: "PROJECTED", reasonCodes: []});
    }
  }
  result.sourceHealth = [...new Map(result.sourceHealth.map(value => [value.observationId, value])).values()];
  result.generatedHealth=[...new Map(result.generatedHealth.map(value=>[value.observationId,value])).values()];
  result.observedHealth=[...new Map(result.observedHealth.map(value=>[canonicalRuleJson([value.metricId,value.observation.observationId]),value])).values()];
  result.reusedHealthRefs = [...new Map(result.reusedHealthRefs.map(value => [value.observationId, value])).values()];
  requireAuthority(scope, actor, options.authority, await readClock(tx));
  return result;
}
