import {
  canonicalDecimal, canonicalRuleJson, compareRuleTimestamps, hashRuleValue,
  timestampMicros, verifySealedRuleInput,
} from './facts';
import type { FactSnapshot, RuleDecision, RuleId, RulePriority, RuleResult, RuleTarget, SealedRuleInput, SourceHealthObservation } from './facts';
import { BASE_ISSUE_CODES, BASE_RULE_IDS, registeredRule, RULE_CATALOG_VERSION, RULE_ENGINE_VERSION, RULE_EVALUATION_ORDER, RULE_SCHEMA_VERSION, assertRegisteredFact, validateRuleCatalog } from './rule-catalog';
import { validateRuleConfig } from './rule-config';
import type { PerRuleConfig, RuleEngineConfig } from './rule-config';

export interface RuleEvaluationControl { cancelled?: () => boolean; tombstoned?: () => boolean; nowMs?: () => number }
export interface RuleEvaluationOutput {
  status: 'COMPLETED' | 'DISABLED' | 'INCOMPLETE'; publishable: boolean;
  inputHash: string; reasonCodes: readonly string[]; results: readonly RuleResult[]; steps: number;
}
interface Finding { decision: RuleDecision; reasons: string[]; facts: FactSnapshot[]; health?: SourceHealthObservation[]; priority?: RulePriority; partial?: boolean; windowStart?: string; windowEnd?: string; communitySummary?:RuleResult['communitySummary'] }
interface Fraction { n: bigint; d: bigint }
function decimal(value: string): Fraction { const normalized = canonicalDecimal(value); const [whole = '0', fraction = ''] = normalized.split('.'); return { n: BigInt(`${whole}${fraction}`), d: 10n ** BigInt(fraction.length) }; }
function cmp(a: Fraction, b: Fraction): number { const difference = a.n * b.d - b.n * a.d; return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
function rate(n: string, d: string): Fraction { return { n: BigInt(n), d: BigInt(d) }; }
function mul(a: Fraction, b: Fraction): Fraction { return { n: a.n * b.n, d: a.d * b.d }; }
function minus(a: Fraction, b: Fraction): Fraction { return { n: a.n * b.d - b.n * a.d, d: a.d * b.d }; }
const issue = (decision: RuleDecision, reasons: string[], facts: FactSnapshot[] = []): Finding => ({ decision, reasons, facts });
const sameTarget = (a: RuleTarget, b: RuleTarget) => canonicalRuleJson(a) === canonicalRuleJson(b);
const QUALITY_REASON: Record<string, string> = { PARTIAL: 'PARTIAL_COVERAGE', STALE: 'STALE', MISSING: 'MISSING', SUPPRESSED: 'PRIVACY_SUPPRESSED', UNKNOWN: 'SOURCE_UNKNOWN' };
function factFor(input: SealedRuleInput, target: RuleTarget, metricId: string, periodRole = 'CURRENT'): FactSnapshot | undefined { return input.facts.find((fact) => sameTarget(fact.target, target) && fact.metricId === metricId && fact.periodRole === periodRole); }
function qualityReason(input: SealedRuleInput, fact: FactSnapshot | undefined, config: PerRuleConfig, checkHealth = true): string | null {
  if (!fact) return 'MISSING';
  if (fact.quality !== 'SUFFICIENT') return QUALITY_REASON[fact.quality] ?? 'SOURCE_UNKNOWN';
  if (fact.value === null) return 'MISSING';
  if (compareRuleTimestamps(fact.windowEnd, input.evaluationAsOf) > 0) return 'WINDOW_IN_FUTURE';
  if (fact.comparison?.windowKind === 'ELAPSED') {
    const duration = BigInt(config.windowDays) * 86_400_000_000n;
    // Recurrence divides the configured CURRENT window into three equal,
    // contiguous half-open periods (IID: three days => three UTC days).
    // The registry enum is a current census, not a period population.
    if (fact.value.kind === 'issuePeriods') {
      const periods=fact.value.periods,periodDuration=duration/3n;
      if(periods.length!==3||timestampMicros(fact.windowEnd)-timestampMicros(fact.windowStart)!==duration
        ||compareRuleTimestamps(periods[0]!.windowStart,fact.windowStart)!==0||compareRuleTimestamps(periods[2]!.windowEnd,fact.windowEnd)!==0
        ||periods.some((period,index)=>timestampMicros(period.windowEnd)-timestampMicros(period.windowStart)!==periodDuration
          ||index>0&&compareRuleTimestamps(period.windowStart,periods[index-1]!.windowEnd)!==0))return 'WINDOW_MISMATCH';
    } else if (!['issue.active_experiment_state', 'issue.playbook_coverage'].includes(fact.metricId)
      && timestampMicros(fact.windowEnd) - timestampMicros(fact.windowStart) !== duration) return 'WINDOW_MISMATCH';
  }
  const age = timestampMicros(input.evaluationAsOf) - timestampMicros(fact.observedAt);
  if (age < 0n) return 'SOURCE_IN_FUTURE';
  if (age > BigInt(config.freshnessSeconds) * 1_000_000n || compareRuleTimestamps(fact.expiresAt, input.evaluationAsOf) <= 0) return 'STALE';
  if (fact.coverage === null) return 'COVERAGE_UNKNOWN';
  if (cmp(decimal(fact.coverage), decimal(config.minimumCoverage)) < 0) return 'PARTIAL_COVERAGE';
  if (!checkHealth) return null;
  if (fact.sourceHealthRefs.length === 0) return 'SOURCE_HEALTH_UNKNOWN';
  const healthByRef=new Map(input.sourceHealth.map((health)=>[`${health.observationId}:${health.revision}`,health]));
  for (const ref of fact.sourceHealthRefs) {
    const health = healthByRef.get(`${ref.observationId}:${ref.revision}`);
    if (!health || health.quality !== 'SUFFICIENT' || health.state === 'UNKNOWN') return health?.quality === 'SUPPRESSED' ? 'PRIVACY_SUPPRESSED' : 'SOURCE_HEALTH_UNKNOWN';
    if (compareRuleTimestamps(health.expiresAt, input.evaluationAsOf) <= 0 || compareRuleTimestamps(health.observedAt, input.evaluationAsOf) > 0 || timestampMicros(input.evaluationAsOf) - timestampMicros(health.observedAt) > BigInt(config.freshnessSeconds) * 1_000_000n) return 'STALE_SOURCE_HEALTH';
  }
  return null;
}
function compatible(current: FactSnapshot, previous: FactSnapshot): boolean {
  if (current.metricId !== previous.metricId || current.unit !== previous.unit || current.metricDefinitionVersion !== previous.metricDefinitionVersion || current.windowStart !== previous.windowEnd) return false;
  const c = current.comparison, p = previous.comparison;
  if (!c || !p) return false;
  if (c.cohortDefinitionVersion !== p.cohortDefinitionVersion || c.campaignClass !== p.campaignClass || c.maturityOffset !== p.maturityOffset || c.windowKind !== p.windowKind || c.timeZone !== p.timeZone) return false;
  // Calendar intervals may have different elapsed lengths at a DST transition.
  if (c.windowKind === 'ELAPSED' && timestampMicros(current.windowEnd) - timestampMicros(current.windowStart) !== timestampMicros(previous.windowEnd) - timestampMicros(previous.windowStart)) return false;
  return true;
}
function ratioRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig, ruleId: RuleId): Finding {
  const rule = registeredRule(ruleId)!;
  const current = factFor(input, target, rule.metricIds[0]!);
  const reason = qualityReason(input, current, config);
  if (reason) return issue('INELIGIBLE', [reason], current ? [current] : []);
  if (current!.value?.kind !== 'ratio') return issue('INELIGIBLE', ['TYPE_MISMATCH'], [current!]);
  const value = current!.value;
  if (BigInt(value.denominator) === 0n) return issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!]);
  if (BigInt(value.denominator) < BigInt(config.minimumN)) return issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!]);
  if (ruleId === 'EVENT-001' && (config.minimumEvents === undefined || value.eligibleEvents === undefined || BigInt(value.eligibleEvents) < BigInt(config.minimumEvents))) return issue('INELIGIBLE', ['INSUFFICIENT_EVENTS'], [current!]);
  const currentRate = rate(value.numerator, value.denominator);
  const low = cmp(currentRate, decimal(config.threshold)) < 0;
  if (!rule.comparison) {
    const fires = ruleId === 'HELP-001' ? cmp(currentRate, decimal(config.threshold)) >= 0 : low;
    return issue(fires ? 'FIRE' : 'NO_FIRE', [fires ? 'THRESHOLD_CROSSED' : 'THRESHOLD_NOT_CROSSED'], [current!]);
  }
  const previous = factFor(input, target, rule.metricIds[0]!, 'PREVIOUS');
  const previousReason = qualityReason(input, previous, config);
  // A known absolute low is independently sufficient; missing comparison cannot hide it.
  if (previousReason) return low ? issue('FIRE', ['LOW_RATE'], [current!]) : issue('INELIGIBLE', [previousReason], previous ? [current!, previous] : [current!]);
  if (previous!.value?.kind !== 'ratio' || !compatible(current!, previous!)) return low ? issue('FIRE', ['LOW_RATE'], [current!]) : issue('INELIGIBLE', ['INCOMPATIBLE_COMPARISON'], [current!, previous!]);
  const pv = previous!.value;
  if (BigInt(pv.denominator) === 0n) return low ? issue('FIRE', ['LOW_RATE'], [current!]) : issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!, previous!]);
  if (BigInt(pv.denominator) < BigInt(config.minimumN) || (ruleId === 'EVENT-001' && (config.minimumEvents === undefined || pv.eligibleEvents === undefined || BigInt(pv.eligibleEvents) < BigInt(config.minimumEvents)))) return low ? issue('FIRE', ['LOW_RATE'], [current!]) : issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!, previous!]);
  if (config.decline === undefined) return issue('DISABLED', ['DISABLED_CONFIG'], [current!, previous!]);
  const previousRate = rate(pv.numerator, pv.denominator);
  const declined = ruleId === 'ENG-001' ? cmp(currentRate, mul(previousRate, minus(decimal('1'), decimal(config.decline)))) <= 0 : cmp(currentRate, minus(previousRate, decimal(config.decline))) <= 0;
  return issue(low || declined ? 'FIRE' : 'NO_FIRE', [...(low ? ['LOW_RATE'] : []), ...(declined ? [ruleId === 'ENG-001' ? 'RELATIVE_DECLINE' : 'PERCENTAGE_POINT_DECLINE'] : []), ...(!low && !declined ? ['THRESHOLD_NOT_CROSSED'] : [])], [current!, previous!]);
}
function reportRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig): Finding {
  const generation = factFor(input, target, 'REPORT.GENERATION_DUE_STATE');
  const generationReason = qualityReason(input, generation, config);
  let generationIncomplete = generationReason;
  if (!generationReason && generation!.value?.kind === 'generation') {
    const value = generation!.value;
    if (value.dueAt === null) generationIncomplete = 'MISSING';
    else if ((value.lastSuccessAt === null || compareRuleTimestamps(value.lastSuccessAt, value.dueAt) < 0) && config.generationGraceSeconds !== undefined && timestampMicros(input.evaluationAsOf) - timestampMicros(value.dueAt) > BigInt(config.generationGraceSeconds) * 1_000_000n) return issue('FIRE', ['GENERATION_OVERDUE'], [generation!]);
  } else if (!generationReason) generationIncomplete = 'TYPE_MISMATCH';
  const current = factFor(input, target, 'REPORT.DELIVERY_RESULT_COUNTS');
  const reason = qualityReason(input, current, config);
  if (reason) return issue('INELIGIBLE', [reason], [generation, current].filter((f): f is FactSnapshot => !!f));
  if (current!.value?.kind !== 'outcomes') return issue('INELIGIBLE', ['TYPE_MISMATCH'], [current!]);
  const value = current!.value;
  if (BigInt(value.unknown) > 0n) return issue('INELIGIBLE', ['DELIVERY_RESULT_UNKNOWN'], [current!]);
  const known = BigInt(value.succeeded) + BigInt(value.failed);
  if (known === 0n) return issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!]);
  if (known < BigInt(config.minimumN)) return issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!]);
  const c = { n: BigInt(value.succeeded), d: known };
  if (cmp(c, decimal(config.threshold)) < 0) return issue('FIRE', ['DELIVERY_FAILURE'], [current!]);
  const previous = factFor(input, target, 'REPORT.DELIVERY_RESULT_COUNTS', 'PREVIOUS');
  const previousReason = qualityReason(input, previous, config);
  if (previousReason) return issue('INELIGIBLE', [previousReason], [current!, ...(previous ? [previous] : [])]);
  if (previous!.value?.kind !== 'outcomes' || !compatible(current!, previous!)) return issue('INELIGIBLE', ['INCOMPATIBLE_COMPARISON'], [current!, previous!]);
  const pv = previous!.value, pk = BigInt(pv.succeeded) + BigInt(pv.failed);
  if (BigInt(pv.unknown) > 0n) return issue('INELIGIBLE', ['DELIVERY_RESULT_UNKNOWN'], [current!, previous!]);
  if (pk === 0n) return issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!, previous!]);
  if (pk < BigInt(config.minimumN)) return issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!, previous!]);
  if (config.decline === undefined) return issue('DISABLED', ['DISABLED_CONFIG'], [current!, previous!]);
  if (cmp(c, minus({ n: BigInt(pv.succeeded), d: pk }, decimal(config.decline))) <= 0) return issue('FIRE', ['DELIVERY_DECLINE'], [current!, previous!]);
  if (generationIncomplete) return issue('INELIGIBLE', [generationIncomplete], [current!, previous!]);
  return issue('NO_FIRE', ['THRESHOLD_NOT_CROSSED'], [generation!, current!, previous!]);
}
function automationRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig, ruleId: 'AUTO-001' | 'AUTO-002'): Finding {
  const current = factFor(input, target, registeredRule(ruleId)!.metricIds[0]!);
  const reason = qualityReason(input, current, config);
  if (reason) return issue('INELIGIBLE', [reason], current ? [current] : []);
  let numerator: bigint, denominator: bigint;
  if (ruleId === 'AUTO-001' && current!.value?.kind === 'outcomes') {
    const value = current!.value;
    denominator = BigInt(value.failed) + BigInt(value.succeeded); numerator = BigInt(value.failed);
    if (denominator === 0n) return issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!]);
    if (denominator < BigInt(config.minimumN)) return issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!]);
    if (config.unknownRateLimit === undefined) return issue('DISABLED', ['DISABLED_CONFIG'], [current!]);
    if (cmp({ n: BigInt(value.unknown), d: denominator + BigInt(value.unknown) }, decimal(config.unknownRateLimit)) > 0) return issue('INELIGIBLE', ['UNKNOWN_SUPPRESSED'], [current!]);
  } else if (ruleId === 'AUTO-002' && current!.value?.kind === 'anomalies') {
    const value = current!.value;
    if(value.projectionAsOf!==input.evaluationAsOf)return issue('INELIGIBLE',['ANOMALY_ASOF_MISMATCH'],[current!]);
    if(value.waitGraceSeconds!==String(config.waitGraceSeconds)||value.heartbeatGraceSeconds!==String(config.heartbeatGraceSeconds))return issue('INELIGIBLE',['ANOMALY_CONFIG_MISMATCH'],[current!]);
    if (BigInt(value.expected) === 0n || cmp(rate(value.observed, value.expected), decimal(config.minimumCoverage)) < 0) return issue('INELIGIBLE', ['PARTIAL_COVERAGE'], [current!]);
    denominator = BigInt(value.eligible); numerator = BigInt(value.anomalous);
  } else return issue('INELIGIBLE', ['TYPE_MISMATCH'], [current!]);
  if (denominator === 0n) return issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!]);
  if (denominator < BigInt(config.minimumN)) return issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!]);
  const fire = cmp({ n: numerator, d: denominator }, decimal(config.threshold)) >= 0;
  return issue(fire ? 'FIRE' : 'NO_FIRE', [fire ? 'THRESHOLD_CROSSED' : 'THRESHOLD_NOT_CROSSED'], [current!]);
}
function permissionRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig): Finding {
  const current = factFor(input, target, 'permission.confirmed_gap_rate');
  if (current?.value?.kind === 'permissions' && !current.value.requirementRegistered) return issue('DISABLED', ['REQUIREMENT_SOURCE_MISSING'], [current]);
  const reason = qualityReason(input, current, config);
  if (reason) return issue('INELIGIBLE', [reason], current ? [current] : []);
  if (current!.value?.kind !== 'permissions') return issue('INELIGIBLE', ['TYPE_MISMATCH'], [current!]);
  const value = current!.value, required = BigInt(value.required);
  if (!value.requirementRegistered) return issue('DISABLED', ['REQUIREMENT_SOURCE_MISSING'], [current!]);
  if (required === 0n) return issue('INELIGIBLE', ['ZERO_DENOMINATOR'], [current!]);
  if (BigInt(value.suppressed) > 0n) return issue('INELIGIBLE', ['PRIVACY_SUPPRESSED'], [current!]);
  if (cmp({ n: BigInt(value.allowed) + BigInt(value.denied), d: required }, decimal(config.minimumCoverage)) < 0) return issue('INELIGIBLE', ['OBSERVATION_UNAVAILABLE'], [current!]);
  if (required < BigInt(config.minimumN)) return issue('INELIGIBLE', ['INSUFFICIENT_N'], [current!]);
  const fire = cmp({ n: BigInt(value.denied), d: required }, decimal(config.threshold)) >= 0;
  return issue(fire ? 'FIRE' : 'NO_FIRE', [fire ? 'PERMISSION_GAP' : 'THRESHOLD_NOT_CROSSED'], [current!]);
}
function recurrenceRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig, ruleId: 'EXP-001' | 'PLAY-001'): Finding {
  const registry = factFor(input, target, ruleId === 'EXP-001' ? 'issue.active_experiment_state' : 'issue.playbook_coverage');
  const registryReason = qualityReason(input, registry, config);
  if(!registryReason&&registry?.value?.kind==='enum'&&((ruleId==='EXP-001'&&registry.value.value==='PRESENT')||(ruleId==='PLAY-001'&&registry.value.value==='ENABLED')))return issue('NO_FIRE',[ruleId==='EXP-001'?'ACTIVE_EXPERIMENT_EXISTS':'PLAYBOOK_EXISTS'],[registry]);
  const history = factFor(input, target, 'issue.recurrence_consecutive_periods');
  const reason = qualityReason(input, history, config);
  if (reason) return issue('INELIGIBLE', [reason], history ? [history] : []);
  if (history!.value?.kind !== 'issuePeriods' || !BASE_ISSUE_CODES.includes(history!.value.issueCode)) return issue('DISABLED', ['ISSUE_SOURCE_NOT_ALLOWED'], [history!]);
  const periods = history!.value.periods;
  if (periods.length !== 3 || periods.some((p) => p.state === 'MISSING') || periods.some((p, i) => i > 0 && p.windowStart !== periods[i - 1]!.windowEnd)) return issue('INELIGIBLE', ['PARTIAL_COVERAGE'], [history!]);
  let longest = 0, consecutive = 0;
  for (const period of periods) { consecutive = period.state === 'FIRE' ? consecutive + 1 : 0; longest = Math.max(longest, consecutive); }
  if (config.minimumConsecutivePeriods === undefined) return issue('DISABLED', ['DISABLED_CONFIG'], [history!]);
  if (longest < config.minimumConsecutivePeriods) return issue('NO_FIRE', ['RECURRENCE_NOT_MET'], [history!]);
  if (registryReason) return issue('INELIGIBLE', [ruleId === 'EXP-001' ? 'ACTIVE_EXPERIMENT_UNKNOWN' : 'MISSING_PLAYBOOK_REGISTRY'], [history!, ...(registry ? [registry] : [])]);
  if (registry!.value?.kind !== 'enum') return issue('INELIGIBLE', ['TYPE_MISMATCH'], [history!, registry!]);
  const state = registry!.value.value;
  if (ruleId === 'EXP-001') {
    if (state === 'PRESENT') return issue('NO_FIRE', ['ACTIVE_EXPERIMENT_EXISTS'], [history!, registry!]);
    if (state === 'ABSENT') return issue('FIRE', ['RECURRING_ISSUE_NO_EXPERIMENT'], [history!, registry!]);
    return issue('INELIGIBLE', ['ACTIVE_EXPERIMENT_UNKNOWN'], [history!, registry!]);
  }
  if (state === 'ENABLED') return issue('NO_FIRE', ['PLAYBOOK_EXISTS'], [history!, registry!]);
  if (state === 'ABSENT' || state === 'DISABLED') return issue('FIRE', [state === 'DISABLED' ? 'PLAYBOOK_DISABLED' : 'PLAYBOOK_MISSING'], [history!, registry!]);
  return issue('INELIGIBLE', ['PLAYBOOK_MAPPING_UNKNOWN'], [history!, registry!]);
}
function dataRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig): Finding {
  const observations = input.sourceHealth.filter((health) => sameTarget(health.target, target));
  if (observations.length === 0) return issue('INELIGIBLE', ['SOURCE_HEALTH_UNKNOWN']);
  // Each target names one source/metric; multiple revisions are an invalid selection, not a latest-row guess.
  if (observations.length !== 1) return issue('INELIGIBLE', ['SOURCE_HEALTH_AMBIGUOUS']);
  const health = observations[0]!;
  const business = input.facts.filter((fact) => sameTarget(fact.target, target) && fact.periodRole === 'CURRENT');
  const windowStart = `${new Date(Date.parse(input.evaluationAsOf) - config.windowDays * 86400000).toISOString().slice(0, 19)}${input.evaluationAsOf.slice(19)}`;
  const found = (decision: RuleDecision, reasons: string[]): Finding => ({ ...issue(decision, reasons, business), health: [health], windowStart, windowEnd: input.evaluationAsOf });
  if (health.quality === 'SUPPRESSED') return found('INELIGIBLE', ['PRIVACY_SUPPRESSED']);
  if (health.quality !== 'SUFFICIENT' || health.state === 'UNKNOWN') return found('INELIGIBLE', ['SOURCE_HEALTH_UNKNOWN']);
  const age = timestampMicros(input.evaluationAsOf) - timestampMicros(health.observedAt);
  if (age < 0n || age > BigInt(config.freshnessSeconds) * 1_000_000n || compareRuleTimestamps(health.expiresAt, input.evaluationAsOf) <= 0) return found('INELIGIBLE', ['STALE_SOURCE_HEALTH']);
  if (health.neverSucceeded === true) return found('FIRE', ['SOURCE_NEVER_SUCCEEDED']);
  if (health.lastSuccessfulIngestAt === null || health.neverSucceeded === null || health.coverage === null) return found('INELIGIBLE', ['SOURCE_HEALTH_UNKNOWN']);
  const reasons: string[] = [];
  if (timestampMicros(input.evaluationAsOf) - timestampMicros(health.lastSuccessfulIngestAt) > BigInt(config.freshnessSeconds) * 1_000_000n) reasons.push('BUSINESS_INGEST_STALE');
  if (cmp(decimal(health.coverage), decimal(config.minimumCoverage)) < 0) reasons.push('BUSINESS_PARTIAL_COVERAGE');
  if (health.state === 'FAILED' || health.state === 'DEGRADED') reasons.push('BUSINESS_SOURCE_DEGRADED');
  if (business.some((fact) => fact.quality === 'MISSING')) reasons.push('BUSINESS_FACT_MISSING');
  if (business.some((fact) => fact.quality === 'STALE')) reasons.push('BUSINESS_FACT_STALE');
  if (reasons.length === 0 && (business.length === 0 || business.some((fact) => fact.quality !== 'SUFFICIENT'))) return found('INELIGIBLE', ['BUSINESS_QUALITY_UNSUPPORTED']);
  return found(reasons.length ? 'FIRE' : 'NO_FIRE', reasons.length ? reasons : ['SOURCE_HEALTH_SUFFICIENT']);
}
function communityRule(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig, evaluated: readonly RuleResult[]): Finding {
  const slot = (ruleId:RuleId, value:RuleTarget) => canonicalRuleJson([ruleId,value]);
  const requested = input.requestedRuleIds.filter((id) => BASE_RULE_IDS.includes(id)).flatMap((id)=>(input.ruleTargets??input.targets).filter((value)=>value.targetType===registeredRule(id)!.targetType).map((value)=>slot(id,value))).sort();
  const eligible = evaluated.filter((result) => requested.includes(slot(result.ruleId,result.target)) && BASE_RULE_IDS.includes(result.ruleId) && (result.decision === 'FIRE' || (result.decision === 'NO_FIRE' && result.sufficient)));
  const eligibleSlots = new Set(eligible.map((result) => slot(result.ruleId,result.target)));
  if (requested.length === 0 || cmp({ n: BigInt(eligibleSlots.size), d: BigInt(requested.length) }, decimal(config.minimumCoverage)) < 0) return issue('INELIGIBLE', ['PARTIAL_COVERAGE']);
  const partial = eligibleSlots.size < requested.length;
  if (config.communityWindowPolicy !== 'DECLARED_RULE_WINDOWS_FIXTURE' && new Set(eligible.map((result)=>canonicalRuleJson([result.windowStart,result.windowEnd]))).size>1) return issue('INELIGIBLE',['INCOMPATIBLE_SUMMARY_WINDOWS']);
  const fires = eligible.filter((result) => result.decision === 'FIRE');
  const issues = deduplicateCommunityIssues(fires);
  const domains = new Set(issues.map((result) => result.domain));
  const facts = input.facts.filter((fact) => issues.some((result) => result.evidenceRefs.some((ref) => ref.factId === fact.factId && ref.snapshotId === fact.snapshotId && ref.sourceRevision === fact.sourceRevision)));
  const domainOrder=['SUPPORT','PERMISSION','ONBOARDING','RETENTION','CHANNEL_USAGE','EVENT','REPORTING','AUTOMATION'];
  const groups=[...domains].map((domain)=>({domain,issueCount:issues.filter((result)=>result.domain===domain).length,issues:issues.filter((result)=>result.domain===domain).map((result)=>({ruleId:result.ruleId,issueCode:result.issueCode,target:result.target,windowStart:result.windowStart,windowEnd:result.windowEnd,evidenceRefs:result.evidenceRefs}))})).sort((a,b)=>b.issueCount-a.issueCount||domainOrder.indexOf(a.domain)-domainOrder.indexOf(b.domain));
  const communitySummary:NonNullable<RuleResult['communitySummary']>={requestedSlots:requested,evaluatedSlots:evaluated.filter((result)=>requested.includes(slot(result.ruleId,result.target))).map((result)=>slot(result.ruleId,result.target)).sort(),eligibleSlots:[...eligibleSlots].sort(),issueCount:issues.length,domainCount:domains.size,groups};
  if (config.minimumDomains === undefined) return issue('DISABLED', ['DISABLED_CONFIG']);
  if (domains.size < config.minimumDomains) return { ...issue(partial ? 'INELIGIBLE' : 'NO_FIRE', [partial ? 'PARTIAL_COVERAGE' : 'DOMAIN_COUNT_BELOW_MIN'], facts), partial,communitySummary };
  const priority: RulePriority = domains.size >= 3 ? (partial ? 'P2' : 'P1') : issues.length >= 3 ? 'P2' : 'P3';
  return { ...issue('FIRE', partial ? ['PARTIAL_INPUT', ...(evaluated.some((r) => r.reasonCodes.includes('PRIVACY_SUPPRESSED')) ? ['PRIVACY_SUPPRESSED'] : [])] : ['MULTI_DOMAIN_ISSUES'], facts), partial, priority,communitySummary };
}
export function deduplicateCommunityIssues(results: readonly RuleResult[]): RuleResult[] {
  const deduped = new Map<string, RuleResult>();
  for (const result of results) {
    if (!BASE_RULE_IDS.includes(result.ruleId) || !BASE_ISSUE_CODES.includes(result.issueCode) || result.decision !== 'FIRE') continue;
    const key = canonicalRuleJson([result.issueCode, result.target, result.windowStart, result.windowEnd, [...result.evidenceRefs].sort((a,b)=>canonicalRuleJson(a).localeCompare(canonicalRuleJson(b)))]);
    if (!deduped.has(key)) deduped.set(key,result);
  }
  const order = ['SUPPORT','PERMISSION','ONBOARDING','RETENTION','CHANNEL_USAGE','EVENT','REPORTING','AUTOMATION'];
  return [...deduped.values()].sort((a,b)=>order.indexOf(a.domain)-order.indexOf(b.domain)||b.windowEnd.localeCompare(a.windowEnd)||a.issueCode.localeCompare(b.issueCode)||canonicalRuleJson(a.target).localeCompare(canonicalRuleJson(b.target)));
}
function evaluateOne(input: SealedRuleInput, target: RuleTarget, config: PerRuleConfig, ruleId: RuleId, results: readonly RuleResult[]): Finding {
  switch (ruleId) {
    case 'ONB-001': case 'HELP-001': case 'RET-001': case 'ENG-001': case 'EVENT-001': return ratioRule(input, target, config, ruleId);
    case 'REPORT-001': return reportRule(input, target, config);
    case 'AUTO-001': case 'AUTO-002': return automationRule(input, target, config, ruleId);
    case 'PERM-001': return permissionRule(input, target, config);
    case 'EXP-001': case 'PLAY-001': return recurrenceRule(input, target, config, ruleId);
    case 'DATA-001': return dataRule(input, target, config);
    case 'COMM-001': return communityRule(input, target, config, results);
  }
}
function toResult(input: SealedRuleInput, ruleId: RuleId, target: RuleTarget, finding: Finding,config:PerRuleConfig|undefined): RuleResult {
  const rule = registeredRule(ruleId)!;
  const health = [...(finding.health ?? []), ...input.sourceHealth.filter((candidate) => finding.facts.some((fact) => fact.sourceHealthRefs.some((ref) => ref.observationId === candidate.observationId && ref.revision === candidate.revision)))];
  const refs = [...new Map(health.map((item) => [item.observationId, { observationId: item.observationId, revision: item.revision }])).values()].sort((a, b) => a.observationId.localeCompare(b.observationId));
  const expiry = [...finding.facts.map((fact) => fact.expiresAt), ...health.map((item) => item.expiresAt)].sort()[0] ?? null;
  const windows = finding.facts.filter((fact) => fact.periodRole === 'CURRENT');
  const windowStart = finding.windowStart ?? windows.map((fact) => fact.windowStart).sort()[0] ?? input.evaluationAsOf;
  const windowEnd = finding.windowEnd ?? windows.map((fact) => fact.windowEnd).sort().at(-1) ?? input.evaluationAsOf;
  const metricScope={metricIds:[...rule.metricIds].sort(),...(ruleId==='EXP-001'||ruleId==='PLAY-001'?{baseIssueCodes:[...new Set(finding.facts.flatMap((fact)=>fact.value?.kind==='issuePeriods'?[fact.value.issueCode]:[]))].sort()}: {})};
  return { ruleId, ruleVersion: input.versions.ruleVersions[ruleId]!, target, decision: finding.decision, reasonCodes: finding.reasons, priority: finding.priority ?? rule.priority, issueCode: rule.issueCode, domain: rule.domain, evidenceRefs: finding.facts.map((fact) => ({ snapshotId: fact.snapshotId, factId: fact.factId, sourceRevision: fact.sourceRevision })), sourceHealthRefs: refs, windowStart, windowEnd, evaluationAsOf: input.evaluationAsOf, inputHash: input.inputHash, action: 'REVIEW_ONLY', sufficient: finding.decision === 'NO_FIRE' && !finding.partial, partialCoverage: finding.partial ?? false, actionableUntil: finding.decision === 'FIRE' ? expiry : null, lineageKey: hashRuleValue({ guildId: input.guildId, targetType: target.targetType, targetId: target.targetId, issueCode: rule.issueCode, normalizedMetricScope: metricScope }),...(finding.communitySummary?{communitySummary:finding.communitySummary}:{}),...(config?{cooldown:{...config.cooldown}}:{}) };
}
/** Fixed registry handlers only. No SQL, network, arbitrary expression, or wall-clock business inputs. */
export function evaluateRules(input: SealedRuleInput, config: RuleEngineConfig, control: RuleEvaluationControl = {}): RuleEvaluationOutput {
  let steps = 0;
  const results: RuleResult[] = [];
  const clock = control.nowMs ?? (() => performance.now());
  const started = clock();
  const output = (status: RuleEvaluationOutput['status'], reasons: string[]): RuleEvaluationOutput => ({ status, publishable: status === 'COMPLETED' && config.profile === 'OPERATIONAL', inputHash: input.inputHash, reasonCodes: reasons, results, steps });
  try { verifySealedRuleInput(input); validateRuleConfig(config); validateRuleCatalog(); input.facts.forEach(assertRegisteredFact); } catch { return output('INCOMPLETE', ['INPUT_CONTRACT_INVALID']); }
  if (config.approval !== 'APPROVED' || !config.budget || (config.profile === 'OPERATIONAL' && !config.retentionApproved)) return output('DISABLED', ['DISABLED_CONFIG']);
  if (config.configVersion !== input.versions.configVersion || input.versions.engineVersion !== RULE_ENGINE_VERSION || input.versions.catalogVersion !== RULE_CATALOG_VERSION || input.versions.schemaVersion !== RULE_SCHEMA_VERSION) return output('INCOMPLETE', ['VERSION_MISMATCH']);
  if (input.requestedRuleIds.some((id) => !registeredRule(id) || input.versions.ruleVersions[id] !== registeredRule(id)!.ruleVersion)) return output('INCOMPLETE', ['RULE_VERSION_MISMATCH']);
  const budget = config.budget;
  if (input.requestedRuleIds.length > budget.maxRules || input.facts.length+input.sourceHealth.length > budget.maxFacts || (input.ruleTargets??input.targets).length > budget.maxTargets || input.facts.reduce((total,fact)=>total+fact.sourceHealthRefs.length,0)>budget.maxSteps) return output('INCOMPLETE', ['BUDGET_EXCEEDED']);
  const interrupt = (): string | null => {
    steps++;
    if (control.cancelled?.()) return 'CANCELLED';
    if (control.tombstoned?.()) return 'TOMBSTONED';
    if (steps > budget.maxSteps) return 'BUDGET_EXCEEDED';
    if (clock() - started >= budget.maxDurationMs) return 'DEADLINE_EXCEEDED';
    return null;
  };
  for (const ruleId of RULE_EVALUATION_ORDER.filter((id) => input.requestedRuleIds.includes(id))) {
    const rule = registeredRule(ruleId)!;
    const rc = config.rules[ruleId];
    const targets = (input.ruleTargets??input.targets).filter((candidate) => candidate.targetType === rule.targetType);
    for (const target of targets) {
      const stopped = interrupt(); if (stopped) return output('INCOMPLETE', [stopped]);
      let finding: Finding;
      if (!rc?.enabled) finding = issue('DISABLED', ['DISABLED_CONFIG']);
      else if (rule.sourceTypes.some((source) => !config.approvedSourceTypes.includes(source))) finding = issue('DISABLED', ['SOURCE_ADAPTER_BLOCKED']);
      else finding = evaluateOne(input, target, rc, ruleId, results);
      // Bound lookup/comparison work as well as emitted result count.
      steps += input.facts.length + finding.facts.length + (finding.health?.length ?? 0);
      const stoppedAfter = interrupt(); if (stoppedAfter) return output('INCOMPLETE', [stoppedAfter]);
      results.push(toResult(input, ruleId, target, finding,rc));
    }
    if (targets.length === 0) return output('INCOMPLETE', ['REQUIRED_TARGET_MISSING']);
  }
  const stopped = interrupt(); if (stopped) return output('INCOMPLETE', [stopped]);
  return output('COMPLETED', []);
}
