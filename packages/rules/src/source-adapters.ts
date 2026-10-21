import { canonicalCount, canonicalDecimal, canonicalRuleJson, canonicalRuleTimestamp, normalizeFact, timestampMicros } from './facts';
import type { FactSnapshot, FactValue } from './facts';
import { assertRegisteredFact, METRIC_CATALOG } from './rule-catalog';

export const SOURCE_ADAPTER_CATALOG = Object.freeze([
  { sourceType: 'ONBOARDING_AGGREGATE_V1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'MATURE_CASE_AND_SAME_PINNED_FIRST_ACTION_INTERSECTION', requestContract: 'ONBOARDING_FIRST_ACTION',reader:'native-cohort-projections.readNativeCohortProjection',nativeProjection:'TYPED_NATIVE_SQL',remaining:'CURRENT_TYPED_CONFIG_AND_COMPLETE_RETAINED_SOURCE_REQUIRED' },
  { sourceType: 'INTAKE_STATUS_AGGREGATE_V1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'CREATED_IN_WINDOW_AND_SLA_ELAPSED_COHORT', requestContract: 'HELP_BACKLOG_COHORT',reader:'native-cohort-projections.readNativeCohortProjection',nativeProjection:'TYPED_ELIGIBILITY_SQL_NUMERATOR_SOURCE_MISSING',remaining:'FIRST_RESPONSE_AND_EXPLICIT_STALLED_OBSERVATIONS_UNAVAILABLE' },
  { sourceType: 'PERMITTED_ENGAGEMENT_AGGREGATE_V1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'PREVIOUS_UNIQUE_PARTICIPANT_COHORT_INTERSECTION', requestContract: 'ENGAGEMENT_CONTINUATION_COHORT',reader:'native-cohort-projections.readNativeCohortProjection',nativeProjection:'TYPED_NATIVE_SQL',remaining:'BOTH_PERIODS_WITHIN_EXISTING_DETAIL_RETENTION' },
  { sourceType: 'ChannelParticipationAggregateAdapter', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'MATCHED_CHANNEL_AND_GUILD_UNIQUE_PARTICIPANTS', requestContract: 'CHANNEL_PARTICIPATION_COHORT',reader:'native-cohort-projections.readNativeCohortProjection',nativeProjection:'TYPED_NATIVE_SQL',remaining:'CURRENT_SELECTED_OBSERVABLE_NONSTAFF_CHANNELS_ONLY' },
  { sourceType: 'EventParticipationAggregateAdapter', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'CONFIRMED_DISCORD_RSVP_AND_SAME_EVENT_ATTENDANCE', requestContract: 'EVENT_RSVP_ATTENDANCE_COHORT',reader:'native-cohort-projections.readNativeCohortProjection',nativeProjection:'TYPED_NATIVE_SQL',remaining:'RETAINED_CREATED_STARTED_COMPLETED_EVENT_METADATA_AND_RSVP_REQUIRED' },
  { sourceType: 'ReportOperationalStatusAdapter', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'GENERATION_DUE_AND_CONFIRMED_DELIVERY_SEPARATE', reader: 'native-report-projections.readNativeReportProjection', remaining: 'NATIVE_TEMPLATE_BINDING_REQUIRED_GENERATION_48H_SEPARATE_FROM_RETAINED_DELIVERY' },
  { sourceType: 'runtime_run_outcome_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'ONE_RUN_ONE_OUTCOME_COMPLETED_MAPS_TO_SUCCEEDED', reader: 'native-projections.readNativeRuleSources', remaining: 'OPERATIONAL_APPROVAL_HEALTH_COVERAGE_AND_RETAINED_WINDOW_REQUIRED' },
  { sourceType: 'runtime_execution_observation_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'AUTHORITATIVE_DUE_DEADLINE_HEARTBEAT_ONLY', requestContract: 'AUTO_EXECUTION_OBSERVATION',reader:'native-execution-permission-projections.readNativeExecutionObservation',nativeProjection:'TYPED_NATIVE_SQL',remaining:'LEGACY_OR_MISSING_EXECUTION_OBSERVATION_IS_UNKNOWN' },
  { sourceType: 'permission_observation_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'CURRENT_REQUIREMENT_EPOCH_AND_SNAPSHOT_PAIR', requestContract: 'PERMISSION_REQUIREMENTS',reader:'native-execution-permission-projections.readNativePermissionRequirements',nativeProjection:'TYPED_NATIVE_SQL',remaining:'UNCOLLECTED_CHANNEL_OVERWRITES_AND_ROLE_HIERARCHY_STAY_UNKNOWN' },
  { sourceType: 'permission_requirement_registry_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'REQUIREMENT_DEFINITION_NOT_INFERRED_FROM_OBSERVATION', requestContract: 'PERMISSION_REQUIREMENTS',reader:'native-execution-permission-projections.readNativePermissionRequirementRegistry',nativeProjection:'TYPED_NATIVE_SQL',remaining:'MATCHED_IMMUTABLE_HEALTH_REF_REQUIRED' },
  { sourceType: 'structured_issue_registry_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'ONLY_NINE_REGISTERED_BASE_ISSUES',reader:'issue-registry.readIssueRegistryCandidate',remaining:'EXPLICIT_REGISTRY_AND_RETAINED_BASE_RESULTS_REQUIRED' },
  { sourceType: 'experiment_registry_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'KNOWN_ACTIVE_EXPERIMENT_STATE_REQUIRED', reader: 'issue-registry.readIssueRegistryCandidate', remaining: 'EXPLICIT_BASE_ISSUE_AND_CURRENT_NATIVE_MAPPING_REQUIRED' },
  { sourceType: 'playbook_mapping_registry_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'EXPLICIT_BASE_ISSUE_TO_PLAYBOOK_MAPPING_REQUIRED', reader: 'issue-registry.readIssueRegistryCandidate', remaining: 'EXPLICIT_BASE_ISSUE_AND_CURRENT_NATIVE_MAPPING_REQUIRED' },
  { sourceType: 'source_health_observation_v1', compatibility: 'EXPLICIT_PROJECTION_REQUIRED', reason: 'HEALTH_OBSERVATION_FRESHNESS_SEPARATE_FROM_BUSINESS_INGEST', reader: 'native-projections.readNativeRuleSources', remaining: 'EXACT_EXISTING_IMMUTABLE_REF_ONLY' },
] as const);
export interface AuthorizedSourceProjection {
  sourceType: string; projectionVersion: string; approved: boolean;
  authorizationReference: string; metricIds: readonly string[];
}
/** A source's existence never grants authorization, retention, or metric compatibility. */
export function adaptAuthorizedFact(input: FactSnapshot, registration: AuthorizedSourceProjection): FactSnapshot {
  if (!registration.approved || !registration.authorizationReference || registration.sourceType !== input.sourceType || !registration.metricIds.includes(input.metricId) || !SOURCE_ADAPTER_CATALOG.some((source) => source.sourceType === registration.sourceType) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(registration.projectionVersion)) throw new Error('RULE_SOURCE_ADAPTER_BLOCKED');
  const fact = normalizeFact(input); assertRegisteredFact(fact); return fact;
}
export interface RuntimeOutcomeRow { runId: string; revision: string; status: 'COMPLETED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'RESULT_UNKNOWN' | 'CANCELLED' | 'EXPIRED' | 'QUEUED' | 'RUNNING' | 'WAITING' }
/** Caller selects one immutable flow revision/window and supplies a unique run set. */
export function projectRuntimeOutcomes(rows: readonly RuntimeOutcomeRow[]): Extract<FactValue, { kind: 'outcomes' }> {
  if (rows.length > 2000) throw new Error('RULE_SOURCE_LIMIT');
  const ids = new Set<string>();
  const result = { succeeded: 0n, failed: 0n, unknown: 0n, cancelled: 0n, unfinished: 0n, expired: 0n };
  for (const row of rows) {
    if (ids.has(row.runId)) throw new Error('RULE_RUN_DUPLICATE'); ids.add(row.runId);
    if (!row.runId || !row.revision || Object.keys(row).some((key) => !['runId', 'revision', 'status'].includes(key))) throw new Error('RULE_RUN_PROJECTION_INVALID');
    switch (row.status) {
      case 'COMPLETED': case 'SUCCEEDED': result.succeeded++; break;
      case 'FAILED': result.failed++; break;
      case 'UNKNOWN': case 'RESULT_UNKNOWN': result.unknown++; break;
      case 'CANCELLED': result.cancelled++; break;
      case 'EXPIRED': result.expired++; break;
      case 'QUEUED': case 'RUNNING': case 'WAITING': result.unfinished++; break;
      default: throw new Error('RULE_RUN_STATUS_UNREGISTERED');
    }
  }
  return { kind: 'outcomes', ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.toString()])) } as Extract<FactValue, { kind: 'outcomes' }>;
}
export interface RuntimeExecutionObservation {
  executionRef: string; state: 'WAITING' | 'RESUMABLE' | 'EXECUTING' | 'CLAIMED' | 'QUEUED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';
  dueAt: string | null; deadlineAt: string | null; terminalAt: string | null;
  leaseExpiresAt: string | null; heartbeatAt: string | null;
}
/** Excludes future waits and deduplicates the union of confirmed anomaly causes. */
export function projectRuntimeAnomalies(rows: readonly RuntimeExecutionObservation[], asOf: string, graceSeconds: number, heartbeatGraceSeconds: number, expected: string): Extract<FactValue, { kind: 'anomalies' }> {
  if (rows.length > 2000 || !Number.isInteger(graceSeconds) || graceSeconds < 0 || !Number.isInteger(heartbeatGraceSeconds) || heartbeatGraceSeconds < 0) throw new Error('RULE_RUNTIME_PROJECTION_INVALID');
  const at = timestampMicros(asOf), grace = BigInt(graceSeconds) * 1_000_000n, heartbeatGrace = BigInt(heartbeatGraceSeconds) * 1_000_000n;
  const ids = new Set<string>(); let eligible = 0n, anomalous = 0n;
  for (const row of rows) {
    if (ids.has(row.executionRef)) throw new Error('RULE_EXECUTION_DUPLICATE'); ids.add(row.executionRef);
    if (Object.keys(row).some((key) => !['executionRef', 'state', 'dueAt', 'deadlineAt', 'terminalAt', 'leaseExpiresAt', 'heartbeatAt'].includes(key)) || !row.executionRef || !['WAITING', 'RESUMABLE', 'EXECUTING', 'CLAIMED', 'QUEUED','COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN'].includes(row.state)) throw new Error('RULE_RUNTIME_PROJECTION_INVALID');
    const due = row.dueAt === null ? null : timestampMicros(row.dueAt);
    const deadline = row.deadlineAt === null ? null : timestampMicros(row.deadlineAt);
    const lease = row.leaseExpiresAt === null ? null : timestampMicros(row.leaseExpiresAt);
    const heartbeat = row.heartbeatAt === null ? null : timestampMicros(row.heartbeatAt);
    if (row.terminalAt !== null) {
      timestampMicros(row.terminalAt);
      if(['WAITING','RESUMABLE','EXECUTING','CLAIMED','QUEUED'].includes(row.state))throw new Error('RULE_RUNTIME_STATE_CONTRADICTION');
      eligible++;continue;
    }
    if(['COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN'].includes(row.state))throw new Error('RULE_RUNTIME_TERMINAL_UNKNOWN');
    const wait = row.state === 'WAITING' || row.state === 'RESUMABLE';
    if (wait && due === null) throw new Error('RULE_RUNTIME_DUE_UNKNOWN');
    if (wait && due! > at) continue;
    if ((row.state === 'EXECUTING' || row.state === 'CLAIMED') && lease === null && heartbeat === null) throw new Error('RULE_RUNTIME_LIVENESS_UNKNOWN');
    eligible++;
    const overdue = wait && due !== null && due + grace < at;
    const expired = deadline !== null && deadline + grace < at;
    const stale = (row.state === 'EXECUTING' || row.state === 'CLAIMED') && ((lease !== null && lease < at) || (heartbeat !== null && heartbeat + heartbeatGrace < at));
    if (overdue || expired || stale) anomalous++;
  }
  const expectedCount = canonicalCount(expected);
  if (BigInt(expectedCount) < BigInt(rows.length)) throw new Error('RULE_RUNTIME_COVERAGE_INVALID');
  return { kind: 'anomalies', eligible: eligible.toString(), anomalous: anomalous.toString(), expected: expectedCount, observed: String(rows.length),projectionAsOf:canonicalRuleTimestamp(asOf),waitGraceSeconds:String(graceSeconds),heartbeatGraceSeconds:String(heartbeatGraceSeconds) };
}

export type ScalarKind = 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'ENUM' | 'TIMESTAMP';
export interface FactScalarComponent { componentKey: string; valueKind: ScalarKind; value: string | boolean | null }
const scalar = (componentKey: string, valueKind: ScalarKind, value: string | boolean | null): FactScalarComponent => ({ componentKey, valueKind, value });
/** Composite engine values are decomposed to registered typed scalar rows; no JSON value column. */
export function projectFactValue(value: FactValue | null): FactScalarComponent[] {
  if (value === null) return [];
  switch (value.kind) {
    case 'count': return [scalar('value', 'INTEGER', canonicalCount(value.value))];
    case 'decimal': return [scalar('value', 'DECIMAL', canonicalDecimal(value.value))];
    case 'boolean': return [scalar('value', 'BOOLEAN', value.value)];
    case 'timestamp': return [scalar('value', 'TIMESTAMP', canonicalRuleTimestamp(value.value))];
    case 'enum': return [scalar('value', 'ENUM', value.value)];
    case 'ratio': return [scalar('numerator', 'INTEGER', value.numerator), scalar('denominator', 'INTEGER', value.denominator), ...(value.eligibleEvents === undefined ? [] : [scalar('eligibleEvents', 'INTEGER', value.eligibleEvents)])];
    case 'generation': return [scalar('dueAt', 'TIMESTAMP', value.dueAt), scalar('lastSuccessAt', 'TIMESTAMP', value.lastSuccessAt)];
    case 'outcomes': return (['succeeded', 'failed', 'unknown', 'cancelled', 'unfinished', 'expired'] as const).map((key) => scalar(key, 'INTEGER', value[key]));
    case 'anomalies': return [...(['eligible', 'anomalous', 'expected', 'observed','waitGraceSeconds','heartbeatGraceSeconds'] as const).map((key) => scalar(key, 'INTEGER', value[key])),scalar('projectionAsOf','TIMESTAMP',value.projectionAsOf)];
    case 'permissions': return [...(['required', 'allowed', 'denied', 'unknown', 'suppressed'] as const).map((key) => scalar(key, 'INTEGER', value[key])), scalar('requirementRegistered', 'BOOLEAN', value.requirementRegistered)];
    case 'issuePeriods': return [scalar('issueCode', 'ENUM', value.issueCode), ...value.periods.flatMap((period, i) => [scalar(`period${i}.windowStart`, 'TIMESTAMP', period.windowStart), scalar(`period${i}.windowEnd`, 'TIMESTAMP', period.windowEnd), scalar(`period${i}.state`, 'ENUM', period.state)])];
  }
}
export function restoreFactValue(kind: FactValue['kind'] | null, components: readonly FactScalarComponent[]): FactValue | null {
  if (kind === null) { if (components.length) throw new Error('RULE_SCALAR_COMPONENT_INVALID'); return null; }
  const entries = new Map(components.map((part) => [part.componentKey, part]));
  if (entries.size !== components.length) throw new Error('RULE_SCALAR_COMPONENT_DUPLICATE');
  const read = (key: string, valueKind: ScalarKind, nullable = false): string | boolean | null => {
    const part = entries.get(key);
    if (!part || part.valueKind !== valueKind || (!nullable && part.value === null) || (part.value !== null && typeof part.value !== (valueKind === 'BOOLEAN' ? 'boolean' : 'string'))) throw new Error('RULE_SCALAR_COMPONENT_INVALID');
    entries.delete(key); return part.value;
  };
  const text = (key: string, valueKind: ScalarKind) => read(key, valueKind) as string;
  let value: FactValue;
  switch (kind) {
    case 'count': value = { kind, value: text('value', 'INTEGER') }; break;
    case 'decimal': value = { kind, value: text('value', 'DECIMAL') }; break;
    case 'boolean': value = { kind, value: read('value', 'BOOLEAN') as boolean }; break;
    case 'timestamp': value = { kind, value: text('value', 'TIMESTAMP') }; break;
    case 'enum': value = { kind, value: text('value', 'ENUM') as Extract<FactValue, { kind: 'enum' }>['value'] }; break;
    case 'ratio': value = { kind, numerator: text('numerator', 'INTEGER'), denominator: text('denominator', 'INTEGER'), ...(entries.has('eligibleEvents') ? { eligibleEvents: text('eligibleEvents', 'INTEGER') } : {}) }; break;
    case 'generation': value = { kind, dueAt: read('dueAt', 'TIMESTAMP', true) as string | null, lastSuccessAt: read('lastSuccessAt', 'TIMESTAMP', true) as string | null }; break;
    case 'outcomes': value = { kind, succeeded: text('succeeded', 'INTEGER'), failed: text('failed', 'INTEGER'), unknown: text('unknown', 'INTEGER'), cancelled: text('cancelled', 'INTEGER'), unfinished: text('unfinished', 'INTEGER'), expired: text('expired', 'INTEGER') }; break;
    case 'anomalies': value = { kind, eligible: text('eligible', 'INTEGER'), anomalous: text('anomalous', 'INTEGER'), expected: text('expected', 'INTEGER'), observed: text('observed', 'INTEGER'),projectionAsOf:text('projectionAsOf','TIMESTAMP'),waitGraceSeconds:text('waitGraceSeconds','INTEGER'),heartbeatGraceSeconds:text('heartbeatGraceSeconds','INTEGER') }; break;
    case 'permissions': value = { kind, required: text('required', 'INTEGER'), allowed: text('allowed', 'INTEGER'), denied: text('denied', 'INTEGER'), unknown: text('unknown', 'INTEGER'), suppressed: text('suppressed', 'INTEGER'), requirementRegistered: read('requirementRegistered', 'BOOLEAN') as boolean }; break;
    case 'issuePeriods': {
      const issueCode = text('issueCode', 'ENUM'); const periods = [];
      for (let i = 0; i < 3 && entries.has(`period${i}.state`); i++) periods.push({ windowStart: text(`period${i}.windowStart`, 'TIMESTAMP'), windowEnd: text(`period${i}.windowEnd`, 'TIMESTAMP'), state: text(`period${i}.state`, 'ENUM') as 'FIRE' | 'NO_FIRE' | 'MISSING' });
      value = { kind, issueCode, periods }; break;
    }
    default: throw new Error('RULE_VALUE_KIND_INVALID');
  }
  if (entries.size || canonicalRuleJson(projectFactValue(value)) !== canonicalRuleJson(components)) {
    // Storage row ordering is irrelevant, but the set of registered paths and values is exact.
    const order = (parts: readonly FactScalarComponent[]) => [...parts].sort((a, b) => a.componentKey.localeCompare(b.componentKey));
    if (entries.size || canonicalRuleJson(order(projectFactValue(value))) !== canonicalRuleJson(order(components))) throw new Error('RULE_SCALAR_COMPONENT_INVALID');
  }
  return value;
}
export const REGISTERED_FACT_PROJECTIONS = Object.freeze(METRIC_CATALOG.map((metric) => ({ metricId: metric.metricId, sourceType: metric.sourceType, valueKind: metric.valueKind, projectionVersion: '1' })));
