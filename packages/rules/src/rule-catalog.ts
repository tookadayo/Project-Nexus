import type { FactSnapshot, FactValue, RuleId, RulePriority } from './facts.js';

export const RULE_ENGINE_VERSION = 'alpha16.1';
export const RULE_CATALOG_VERSION = 'alpha16.1';
export const RULE_SCHEMA_VERSION = 'alpha16.1';
export interface RegisteredMetric {
  metricId: string; version: '1'; sourceType: string; valueKind: FactValue['kind']; unit: string;
}
export const METRIC_CATALOG: readonly RegisteredMetric[] = Object.freeze([
  { metricId: 'ONB_FIRST_ACTION_COMPLETION_RATE', version: '1', sourceType: 'ONBOARDING_AGGREGATE_V1', valueKind: 'ratio', unit: 'RATIO' },
  { metricId: 'HELP_UNANSWERED_STALLED_RATE', version: '1', sourceType: 'INTAKE_STATUS_AGGREGATE_V1', valueKind: 'ratio', unit: 'RATIO' },
  { metricId: 'ENGAGEMENT_CONTINUATION_RATE', version: '1', sourceType: 'PERMITTED_ENGAGEMENT_AGGREGATE_V1', valueKind: 'ratio', unit: 'RATIO' },
  { metricId: 'COMM.CHANNEL_PARTICIPATION_RATE', version: '1', sourceType: 'ChannelParticipationAggregateAdapter', valueKind: 'ratio', unit: 'RATIO' },
  { metricId: 'EVENT.RSVP_TO_ATTENDANCE_CONVERSION', version: '1', sourceType: 'EventParticipationAggregateAdapter', valueKind: 'ratio', unit: 'RATIO' },
  { metricId: 'REPORT.GENERATION_DUE_STATE', version: '1', sourceType: 'ReportOperationalStatusAdapter', valueKind: 'generation', unit: 'STATE' },
  { metricId: 'REPORT.DELIVERY_RESULT_COUNTS', version: '1', sourceType: 'ReportOperationalStatusAdapter', valueKind: 'outcomes', unit: 'COUNT' },
  { metricId: 'automation.run.confirmed_failure_rate', version: '1', sourceType: 'runtime_run_outcome_v1', valueKind: 'outcomes', unit: 'COUNT' },
  { metricId: 'automation.runtime.operational_anomaly_rate', version: '1', sourceType: 'runtime_execution_observation_v1', valueKind: 'anomalies', unit: 'COUNT' },
  { metricId: 'permission.confirmed_gap_rate', version: '1', sourceType: 'permission_observation_v1', valueKind: 'permissions', unit: 'COUNT' },
  { metricId: 'issue.recurrence_consecutive_periods', version: '1', sourceType: 'structured_issue_registry_v1', valueKind: 'issuePeriods', unit: 'PERIODS' },
  { metricId: 'issue.active_experiment_state', version: '1', sourceType: 'experiment_registry_v1', valueKind: 'enum', unit: 'STATE' },
  { metricId: 'issue.playbook_coverage', version: '1', sourceType: 'playbook_mapping_registry_v1', valueKind: 'enum', unit: 'STATE' },
]);
export interface RegisteredRule {
  ruleId: RuleId; ruleVersion: '1'; issueCode: string; domain: string; targetType: string;
  metricIds: readonly string[]; sourceTypes: readonly string[]; dependencies: readonly RuleId[];
  priority: RulePriority; comparison: boolean;
}
const base = (ruleId: RuleId, issueCode: string, domain: string, targetType: string, metricIds: readonly string[], priority: RulePriority, comparison = false): RegisteredRule => ({ ruleId, ruleVersion: '1', issueCode, domain, targetType, metricIds, sourceTypes: [...new Set(metricIds.map((id) => METRIC_CATALOG.find((metric) => metric.metricId === id)!.sourceType))], dependencies: [], priority, comparison });
export const BASE_RULE_IDS: readonly RuleId[] = Object.freeze(['ONB-001', 'HELP-001', 'RET-001', 'ENG-001', 'EVENT-001', 'REPORT-001', 'AUTO-001', 'AUTO-002', 'PERM-001']);
export const RULE_CATALOG: readonly RegisteredRule[] = Object.freeze([
  base('ONB-001', 'ONB_LOW_COMPLETION', 'ONBOARDING', 'ONBOARDING_FLOW', ['ONB_FIRST_ACTION_COMPLETION_RATE'], 'P2'),
  base('HELP-001', 'HELP_BACKLOG', 'SUPPORT', 'HELP_INTAKE_POLICY', ['HELP_UNANSWERED_STALLED_RATE'], 'P1'),
  base('RET-001', 'RET_CONTINUATION_DROP', 'RETENTION', 'COMMUNITY_ENGAGEMENT_POLICY', ['ENGAGEMENT_CONTINUATION_RATE'], 'P2'),
  base('ENG-001', 'ENG_CHANNEL_UNDERUSE', 'CHANNEL_USAGE', 'CHANNEL', ['COMM.CHANNEL_PARTICIPATION_RATE'], 'P2', true),
  base('EVENT-001', 'EVENT_CONVERSION_DROP', 'EVENT', 'EVENT_PROGRAM', ['EVENT.RSVP_TO_ATTENDANCE_CONVERSION'], 'P2', true),
  base('REPORT-001', 'REPORT_DELIVERY_FAILURE', 'REPORTING', 'REPORT_DEFINITION', ['REPORT.GENERATION_DUE_STATE', 'REPORT.DELIVERY_RESULT_COUNTS'], 'P1', true),
  base('AUTO-001', 'AUTO_FAILURE_RATE', 'AUTOMATION', 'AUTOMATION_FLOW', ['automation.run.confirmed_failure_rate'], 'P2'),
  base('AUTO-002', 'AUTO_STALE_EXECUTION', 'AUTOMATION', 'AUTOMATION_RUNTIME', ['automation.runtime.operational_anomaly_rate'], 'P1'),
  { ...base('PERM-001', 'PERM_GAP', 'PERMISSION', 'GUILD_PERMISSION_PROFILE', ['permission.confirmed_gap_rate'], 'P1'), sourceTypes: ['permission_observation_v1', 'permission_requirement_registry_v1'] },
  { ...base('EXP-001', 'RECURRING_ISSUE_EXPERIMENT_GAP', 'EXPERIMENT', 'ISSUE_TARGET', ['issue.recurrence_consecutive_periods', 'issue.active_experiment_state'], 'P2'), dependencies: BASE_RULE_IDS },
  { ...base('PLAY-001', 'RECURRING_ISSUE_PLAYBOOK_GAP', 'PLAYBOOK', 'ISSUE_TARGET', ['issue.recurrence_consecutive_periods', 'issue.playbook_coverage'], 'P2'), dependencies: BASE_RULE_IDS },
  { ruleId: 'DATA-001', ruleVersion: '1', issueCode: 'DATA_QUALITY_WARNING', domain: 'DATA_QUALITY', targetType: 'DATA_SOURCE_METRIC', metricIds: [], sourceTypes: ['source_health_observation_v1'], dependencies: [], priority: 'P1', comparison: false },
  { ruleId: 'COMM-001', ruleVersion: '1', issueCode: 'COMM_MULTI_DOMAIN_REVIEW', domain: 'COMMUNITY', targetType: 'GUILD', metricIds: [], sourceTypes: [], dependencies: BASE_RULE_IDS, priority: 'P3', comparison: false },
]);
export const RULE_EVALUATION_ORDER: readonly RuleId[] = Object.freeze([...BASE_RULE_IDS, 'DATA-001', 'EXP-001', 'PLAY-001', 'COMM-001']);
export const BASE_ISSUE_CODES: readonly string[] = Object.freeze(RULE_CATALOG.filter((rule) => BASE_RULE_IDS.includes(rule.ruleId)).map((rule) => rule.issueCode));
for(const metric of METRIC_CATALOG)Object.freeze(metric);
for(const rule of RULE_CATALOG){Object.freeze(rule.metricIds);Object.freeze(rule.sourceTypes);Object.freeze(rule.dependencies);Object.freeze(rule);}
export const REGISTERED_SOURCE_TYPES:readonly string[]=Object.freeze([...new Set([...METRIC_CATALOG.map((metric)=>metric.sourceType),'permission_requirement_registry_v1','source_health_observation_v1','business_fact_registry_v1','COMM-RULE-RESULT-v1'])]);
export function registeredRule(ruleId: string): RegisteredRule | undefined { return RULE_CATALOG.find((rule) => rule.ruleId === ruleId); }
export function assertRegisteredFact(fact: FactSnapshot): void {
  const metric = METRIC_CATALOG.find((candidate) => candidate.metricId === fact.metricId);
  if (!metric || metric.version !== fact.metricDefinitionVersion || metric.sourceType !== fact.sourceType || metric.unit !== fact.unit || (fact.value !== null && fact.value.kind !== metric.valueKind)) throw new Error('RULE_METRIC_CONTRACT_MISMATCH');
  if(fact.target.targetType!=='DATA_SOURCE_METRIC'&&!RULE_CATALOG.some((rule)=>rule.metricIds.includes(fact.metricId)&&rule.targetType===fact.target.targetType))throw new Error('RULE_METRIC_TARGET_MISMATCH');
  if(fact.target.targetType==='DATA_SOURCE_METRIC'&&fact.target.targetId!==fact.metricId)throw new Error('RULE_METRIC_TARGET_MISMATCH');
  if((fact.dimension.targetType!==undefined&&fact.dimension.targetType!==fact.target.targetType)||(fact.dimension.targetId!==undefined&&fact.dimension.targetId!==fact.target.targetId)||(fact.dimension.metricId!==undefined&&fact.dimension.metricId!==fact.metricId)||(fact.dimension.sourceType!==undefined&&fact.dimension.sourceType!==fact.sourceType))throw new Error('RULE_DIMENSION_MISMATCH');
  if (fact.value?.kind === 'issuePeriods' && !BASE_ISSUE_CODES.includes(fact.value.issueCode)) throw new Error('RULE_ISSUE_SOURCE_NOT_ALLOWED');
  if (fact.value?.kind === 'enum' && !['PRESENT', 'ABSENT', 'ENABLED', 'DISABLED', 'UNKNOWN', 'UNCLASSIFIED', 'UNASSESSED', 'NOT_SET'].includes(fact.value.value)) throw new Error('RULE_METRIC_ENUM_INVALID');
  if (fact.metricId === 'issue.active_experiment_state' && fact.value?.kind === 'enum' && !['PRESENT', 'ABSENT', 'UNKNOWN'].includes(fact.value.value)) throw new Error('RULE_METRIC_ENUM_INVALID');
  if (fact.metricId === 'issue.playbook_coverage' && fact.value?.kind === 'enum' && !['ABSENT', 'ENABLED', 'DISABLED', 'UNKNOWN'].includes(fact.value.value)) throw new Error('RULE_METRIC_ENUM_INVALID');
}
/** Registry activation rejects duplicate IDs, missing dependencies, and cycles. */
export function validateRuleCatalog(catalog: readonly RegisteredRule[] = RULE_CATALOG): void {
  const entries = new Map(catalog.map((rule) => [rule.ruleId, rule]));
  if (entries.size !== catalog.length) throw new Error('RULE_CATALOG_DUPLICATE');
  const visiting = new Set<RuleId>(), visited = new Set<RuleId>();
  const visit = (id: RuleId): void => {
    if (visiting.has(id)) throw new Error('RULE_CATALOG_CYCLE');
    if (visited.has(id)) return;
    const rule = entries.get(id); if (!rule) throw new Error('RULE_CATALOG_DEPENDENCY_MISSING');
    visiting.add(id); rule.dependencies.forEach(visit); visiting.delete(id); visited.add(id);
  };
  catalog.forEach((rule) => visit(rule.ruleId));
}
