import { createHash } from 'node:crypto';
import { assertRegisteredFact, registeredRule, REGISTERED_SOURCE_TYPES } from './rule-catalog';

/** Only aggregate/operational values from the registered adapters enter this model. */
export type FactQuality = 'SUFFICIENT' | 'PARTIAL' | 'STALE' | 'MISSING' | 'SUPPRESSED' | 'UNKNOWN';
export type PeriodRole = 'CURRENT' | 'PREVIOUS' | 'PERIOD_1' | 'PERIOD_2' | 'PERIOD_3';
export type RuleId = 'ONB-001' | 'HELP-001' | 'RET-001' | 'ENG-001' | 'EVENT-001' | 'REPORT-001' | 'AUTO-001' | 'AUTO-002' | 'PERM-001' | 'EXP-001' | 'PLAY-001' | 'DATA-001' | 'COMM-001';
export type RuleDecision = 'FIRE' | 'NO_FIRE' | 'INELIGIBLE' | 'DISABLED';
export type RulePriority = 'P1' | 'P2' | 'P3';
export type RuleCooldown = {unit:'CALENDAR_DAY';value:number;timeZone:string}|{unit:'SECOND';value:number};
export interface RuleTarget { targetType: string; targetId: string; liveVersion: string }
export interface SourceHealthRef { observationId: string; revision: string }
export interface FactRef { snapshotId: string; factId: string; sourceRevision: string }
export interface IssuePeriod {
  windowStart: string; windowEnd: string; state: 'FIRE' | 'NO_FIRE' | 'MISSING';
}
export type FactValue =
  | { kind: 'count'; value: string }
  | { kind: 'decimal'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'timestamp'; value: string }
  | { kind: 'enum'; value: 'PRESENT' | 'ABSENT' | 'ENABLED' | 'DISABLED' | 'UNKNOWN' | 'UNCLASSIFIED' | 'UNASSESSED' | 'NOT_SET' }
  | { kind: 'ratio'; numerator: string; denominator: string; eligibleEvents?: string }
  | { kind: 'generation'; dueAt: string | null; lastSuccessAt: string | null }
  | { kind: 'outcomes'; succeeded: string; failed: string; unknown: string; cancelled: string; unfinished: string; expired: string }
  | { kind: 'anomalies'; eligible: string; anomalous: string; expected: string; observed: string; projectionAsOf: string; waitGraceSeconds: string; heartbeatGraceSeconds: string }
  | { kind: 'permissions'; required: string; allowed: string; denied: string; unknown: string; suppressed: string; requirementRegistered: boolean }
  | { kind: 'issuePeriods'; issueCode: string; periods: readonly IssuePeriod[] };
export interface FactSnapshot {
  factId: string; snapshotId: string; metricId: string; metricDefinitionVersion: string;
  dimension: Readonly<Record<string, string>>; periodRole: PeriodRole;
  windowStart: string; windowEnd: string; sourceType: string; sourceRevision: string;
  observedAt: string; expiresAt: string; sourceHealthRefs: readonly SourceHealthRef[];
  quality: FactQuality; value: FactValue | null; unit: string;
  target: RuleTarget; coverage: string | null; sampleSize: string | null;
  comparison?: { cohortDefinitionVersion: string; campaignClass: string; maturityOffset: string; windowKind: 'ELAPSED' | 'CALENDAR'; timeZone: string; cohortId: string };
}
export interface SourceHealthObservation extends SourceHealthRef {
  sourceType: string; observedAt: string; expiresAt: string; quality: FactQuality;
  state: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';
  lastSuccessfulIngestAt: string | null; neverSucceeded: boolean | null; coverage: string | null;
  target: RuleTarget;
}
export interface RuleVersionSet {
  engineVersion: string; configVersion: string; catalogVersion: string; schemaVersion: string;
  branchVersion: string; actionVersion: string; explanationVersion: string;
  ruleVersions: Readonly<Partial<Record<RuleId, string>>>;
}
export interface RuleInput {
  guildId: string; evaluationAsOf: string; versions: RuleVersionSet;
  requestedRuleIds: readonly RuleId[]; facts: readonly FactSnapshot[];
  sourceHealth: readonly SourceHealthObservation[]; targets: readonly RuleTarget[];
  /** Native fact/health targets evaluated by the 13 rules. targets also seals
   * independent CASE resources. Omission preserves the legacy input contract. */
  ruleTargets?: readonly RuleTarget[];
}
export interface SealedRuleInput extends RuleInput { inputHash: string }
export interface RuleResult {
  ruleId: RuleId; ruleVersion: string; target: RuleTarget; decision: RuleDecision;
  reasonCodes: readonly string[]; priority: RulePriority; issueCode: string; domain: string;
  evidenceRefs: readonly FactRef[]; sourceHealthRefs: readonly SourceHealthRef[];
  windowStart: string; windowEnd: string; evaluationAsOf: string;
  inputHash: string; action: 'REVIEW_ONLY'; sufficient: boolean; partialCoverage: boolean;
  actionableUntil: string | null; lineageKey: string;
  cooldown?:RuleCooldown;
  communitySummary?: {
    requestedSlots: readonly string[]; evaluatedSlots: readonly string[];
    eligibleSlots: readonly string[]; issueCount: number; domainCount: number;
    groups: readonly { domain: string; issueCount: number; issues: readonly {ruleId:RuleId;issueCode:string;target:RuleTarget;windowStart:string;windowEnd:string;evidenceRefs:readonly FactRef[]}[] }[];
  };
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const QUALITIES: readonly string[] = ['SUFFICIENT', 'PARTIAL', 'STALE', 'MISSING', 'SUPPRESSED', 'UNKNOWN'];
const PERIODS: readonly string[] = ['CURRENT', 'PREVIOUS', 'PERIOD_1', 'PERIOD_2', 'PERIOD_3'];
export function assertRuleIdentifier(value: string): void {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('RULE_IDENTIFIER_INVALID');
}
function exactKeys(value: object, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new Error('RULE_UNKNOWN_OR_MISSING_FIELD');
}
export function canonicalDecimal(value: string): string {
  if (typeof value !== 'string' || value.length > 80 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('RULE_DECIMAL_INVALID');
  const negative = value.startsWith('-');
  const [wholeRaw = '', fractionRaw = ''] = (negative ? value.slice(1) : value).split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '');
  const fraction = fractionRaw.replace(/0+$/, '');
  if (whole.length > 20 || fraction.length > 18 || whole.length + fraction.length > 38) throw new Error('RULE_DECIMAL_RANGE');
  const result = `${whole}${fraction ? `.${fraction}` : ''}`;
  return negative && result !== '0' ? `-${result}` : result;
}
export function canonicalCount(value: string): string {
  const result = canonicalDecimal(value);
  if (result.startsWith('-') || result.includes('.') || BigInt(result) > 9_223_372_036_854_775_807n) throw new Error('RULE_COUNT_INVALID');
  return result;
}
/** UTC microseconds, with no lossy rounding of sub-millisecond input. */
export function canonicalRuleTimestamp(value: string): string {
  if (typeof value !== 'string') throw new Error('RULE_TIMESTAMP_INVALID');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match) throw new Error('RULE_TIMESTAMP_INVALID');
  const base = match[1]!;
  const milliseconds = `${base}.${(match[2] ?? '').padEnd(3, '0').slice(0, 3)}Z`;
  const parsed = Date.parse(milliseconds);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== milliseconds) throw new Error('RULE_TIMESTAMP_INVALID');
  return `${base}.${(match[2] ?? '').padEnd(6, '0')}Z`;
}
export function timestampMicros(value: string): bigint {
  const normalized = canonicalRuleTimestamp(value);
  return BigInt(Date.parse(`${normalized.slice(0, 23)}Z`)) * 1000n + BigInt(normalized.slice(23, 26));
}
export function compareRuleTimestamps(a: string, b: string): number {
  const left = timestampMicros(a), right = timestampMicros(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function codePointCompare(a: string, b: string): number {
  const left = Array.from(a, (x) => x.codePointAt(0)!);
  const right = Array.from(b, (x) => x.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
}
/** Object keys follow Unicode code point order, not locale or UTF-16 order. */
export function canonicalRuleJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRuleJson).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort(codePointCompare).map((key) => `${JSON.stringify(key)}:${canonicalRuleJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new Error('RULE_CANONICAL_VALUE_INVALID');
}
export function hashRuleValue(value: unknown): string { return createHash('sha256').update(canonicalRuleJson(value), 'utf8').digest('hex'); }
/** Stable identity for the same native health observation. Re-reading an
 * unchanged source must reuse its immutable row, not create a second identity
 * for the database's source/revision/observed-at uniqueness constraint. */
export function immutableSourceHealthId(scope:{organizationId:string;guildId:string},sourceType:string,revision:string,observedAt:string,target:RuleTarget):string {
  const bytes=createHash('sha256').update(canonicalRuleJson({scope,sourceType,revision,observedAt:canonicalRuleTimestamp(observedAt),target})).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&0x0f)|0x80;bytes[8]=(bytes[8]!&0x3f)|0x80;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function target(input: RuleTarget): RuleTarget {
  exactKeys(input, ['targetType', 'targetId', 'liveVersion']);
  for (const value of Object.values(input)) assertRuleIdentifier(value);
  return { ...input };
}
function healthRef(input: SourceHealthRef): SourceHealthRef {
  exactKeys(input, ['observationId', 'revision']);
  assertObservationId(input.observationId); assertRuleIdentifier(input.revision);
  return { ...input };
}
export function assertObservationId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('RULE_OBSERVATION_ID_INVALID');
}
function ratio01(value: string | null): string | null {
  if (value === null) return null;
  const canonical = canonicalDecimal(value);
  if (!/^(?:0(?:\.\d+)?|1)$/.test(canonical)) throw new Error('RULE_COVERAGE_INVALID');
  return canonical;
}
function normalizeValue(input: FactValue): FactValue {
  switch (input.kind) {
    case 'count': exactKeys(input, ['kind', 'value']); return { kind: input.kind, value: canonicalCount(input.value) };
    case 'decimal': exactKeys(input, ['kind', 'value']); return { kind: input.kind, value: canonicalDecimal(input.value) };
    case 'boolean': exactKeys(input, ['kind', 'value']); if (typeof input.value !== 'boolean') throw new Error('RULE_BOOLEAN_INVALID'); return { ...input };
    case 'timestamp': exactKeys(input, ['kind', 'value']); return { kind: input.kind, value: canonicalRuleTimestamp(input.value) };
    case 'enum': exactKeys(input, ['kind', 'value']); if (!['PRESENT', 'ABSENT', 'ENABLED', 'DISABLED', 'UNKNOWN', 'UNCLASSIFIED', 'UNASSESSED', 'NOT_SET'].includes(input.value)) throw new Error('RULE_ENUM_INVALID'); return { ...input };
    case 'ratio': {
      exactKeys(input, ['kind', 'numerator', 'denominator'], ['eligibleEvents']);
      const numerator = canonicalCount(input.numerator), denominator = canonicalCount(input.denominator);
      if (BigInt(numerator) > BigInt(denominator)) throw new Error('RULE_RATIO_INVALID');
      return { kind: input.kind, numerator, denominator, ...(input.eligibleEvents === undefined ? {} : { eligibleEvents: canonicalCount(input.eligibleEvents) }) };
    }
    case 'generation': exactKeys(input, ['kind', 'dueAt', 'lastSuccessAt']); return { kind: input.kind, dueAt: input.dueAt === null ? null : canonicalRuleTimestamp(input.dueAt), lastSuccessAt: input.lastSuccessAt === null ? null : canonicalRuleTimestamp(input.lastSuccessAt) };
    case 'outcomes': exactKeys(input, ['kind', 'succeeded', 'failed', 'unknown', 'cancelled', 'unfinished', 'expired']); return { kind: input.kind, succeeded: canonicalCount(input.succeeded), failed: canonicalCount(input.failed), unknown: canonicalCount(input.unknown), cancelled: canonicalCount(input.cancelled), unfinished: canonicalCount(input.unfinished), expired: canonicalCount(input.expired) };
    case 'anomalies': {
      exactKeys(input, ['kind', 'eligible', 'anomalous', 'expected', 'observed', 'projectionAsOf', 'waitGraceSeconds', 'heartbeatGraceSeconds']);
      const value = { kind: input.kind, eligible: canonicalCount(input.eligible), anomalous: canonicalCount(input.anomalous), expected: canonicalCount(input.expected), observed: canonicalCount(input.observed), projectionAsOf:canonicalRuleTimestamp(input.projectionAsOf),waitGraceSeconds:canonicalCount(input.waitGraceSeconds),heartbeatGraceSeconds:canonicalCount(input.heartbeatGraceSeconds) };
      if (BigInt(value.anomalous) > BigInt(value.eligible) || BigInt(value.observed) > BigInt(value.expected)) throw new Error('RULE_ANOMALY_INVALID');
      return value;
    }
    case 'permissions': {
      exactKeys(input, ['kind', 'required', 'allowed', 'denied', 'unknown', 'suppressed', 'requirementRegistered']);
      if (typeof input.requirementRegistered !== 'boolean') throw new Error('RULE_PERMISSION_INVALID');
      const value = { kind: input.kind, required: canonicalCount(input.required), allowed: canonicalCount(input.allowed), denied: canonicalCount(input.denied), unknown: canonicalCount(input.unknown), suppressed: canonicalCount(input.suppressed), requirementRegistered: input.requirementRegistered };
      if (BigInt(value.allowed) + BigInt(value.denied) + BigInt(value.unknown) + BigInt(value.suppressed) !== BigInt(value.required)) throw new Error('RULE_PERMISSION_INVALID');
      return value;
    }
    case 'issuePeriods': {
      exactKeys(input, ['kind', 'issueCode', 'periods']); assertRuleIdentifier(input.issueCode);
      if (input.periods.length > 3) throw new Error('RULE_PERIOD_LIMIT');
      const periods = input.periods.map((period) => { exactKeys(period, ['windowStart', 'windowEnd', 'state']); if (!['FIRE', 'NO_FIRE', 'MISSING'].includes(period.state)) throw new Error('RULE_PERIOD_STATE_INVALID'); const windowStart = canonicalRuleTimestamp(period.windowStart), windowEnd = canonicalRuleTimestamp(period.windowEnd); if (windowStart >= windowEnd) throw new Error('RULE_WINDOW_INVALID'); return { windowStart, windowEnd, state: period.state }; }).sort((a, b) => a.windowStart.localeCompare(b.windowStart));
      if (periods.some((p, i) => i > 0 && p.windowStart < periods[i - 1]!.windowEnd)) throw new Error('RULE_PERIOD_OVERLAP');
      return { kind: input.kind, issueCode: input.issueCode, periods };
    }
    default: throw new Error('RULE_VALUE_KIND_INVALID');
  }
}
export function normalizeFact(input: FactSnapshot): FactSnapshot {
  exactKeys(input, ['factId', 'snapshotId', 'metricId', 'metricDefinitionVersion', 'dimension', 'periodRole', 'windowStart', 'windowEnd', 'sourceType', 'sourceRevision', 'observedAt', 'expiresAt', 'sourceHealthRefs', 'quality', 'value', 'unit', 'target', 'coverage', 'sampleSize'], ['comparison']);
  for (const value of [input.factId, input.snapshotId, input.metricId, input.metricDefinitionVersion, input.sourceType, input.sourceRevision, input.unit]) assertRuleIdentifier(value);
  assertObservationId(input.factId); assertObservationId(input.snapshotId);
  if (!QUALITIES.includes(input.quality) || !PERIODS.includes(input.periodRole)) throw new Error('RULE_FACT_ENUM_INVALID');
  if (!input.dimension || Object.keys(input.dimension).length > 7 || !Array.isArray(input.sourceHealthRefs) || input.sourceHealthRefs.length > 2000) throw new Error('RULE_INPUT_HARD_LIMIT');
  const dimension = Object.fromEntries(Object.entries(input.dimension).sort(([a], [b]) => codePointCompare(a, b)).map(([key, value]) => { assertRuleIdentifier(key); assertRuleIdentifier(value); return [key, value]; }));
  if (Object.keys(dimension).some((key) => !['targetType', 'targetId', 'issueCode', 'sourceType', 'metricId', 'cohortClass', 'campaignClass'].includes(key))) throw new Error('RULE_DIMENSION_UNREGISTERED');
  const windowStart = canonicalRuleTimestamp(input.windowStart), windowEnd = canonicalRuleTimestamp(input.windowEnd);
  if (windowStart >= windowEnd) throw new Error('RULE_WINDOW_INVALID');
  const refs = input.sourceHealthRefs.map(healthRef).sort((a, b) => codePointCompare(a.observationId, b.observationId) || codePointCompare(a.revision, b.revision));
  if (new Set(refs.map((r) => r.observationId)).size !== refs.length) throw new Error('RULE_HEALTH_REF_DUPLICATE');
  if (input.value === null && input.quality === 'SUFFICIENT') throw new Error('RULE_SUFFICIENT_NULL');
  if (input.value !== null && !['SUFFICIENT', 'PARTIAL'].includes(input.quality)) throw new Error('RULE_UNAVAILABLE_VALUE');
  let comparison: FactSnapshot['comparison'];
  if (input.comparison) {
    exactKeys(input.comparison, ['cohortDefinitionVersion', 'campaignClass', 'maturityOffset', 'windowKind', 'timeZone', 'cohortId']);
    for (const value of [input.comparison.cohortDefinitionVersion, input.comparison.campaignClass, input.comparison.maturityOffset, input.comparison.cohortId]) assertRuleIdentifier(value);
    if (!['ELAPSED', 'CALENDAR'].includes(input.comparison.windowKind)) throw new Error('RULE_WINDOW_KIND_INVALID');
    try { new Intl.DateTimeFormat('en', { timeZone: input.comparison.timeZone }); } catch { throw new Error('RULE_TIME_ZONE_INVALID'); }
    comparison = { ...input.comparison };
  }
  return { ...input, dimension, windowStart, windowEnd, observedAt: canonicalRuleTimestamp(input.observedAt), expiresAt: canonicalRuleTimestamp(input.expiresAt), target: target(input.target), sourceHealthRefs: refs, value: input.value === null ? null : normalizeValue(input.value), coverage: ratio01(input.coverage), sampleSize: input.sampleSize === null ? null : canonicalCount(input.sampleSize), ...(comparison ? { comparison } : {}) };
}
export function normalizeSourceHealth(input: SourceHealthObservation): SourceHealthObservation {
  exactKeys(input, ['observationId', 'revision', 'sourceType', 'observedAt', 'expiresAt', 'quality', 'state', 'lastSuccessfulIngestAt', 'neverSucceeded', 'coverage', 'target']);
  healthRef({ observationId: input.observationId, revision: input.revision }); assertRuleIdentifier(input.sourceType);
  if(!REGISTERED_SOURCE_TYPES.includes(input.sourceType))throw new Error('RULE_SOURCE_UNREGISTERED');
  if (!QUALITIES.includes(input.quality) || !['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN'].includes(input.state) || (input.neverSucceeded !== null && typeof input.neverSucceeded !== 'boolean')) throw new Error('RULE_HEALTH_INVALID');
  if (input.neverSucceeded === true && input.lastSuccessfulIngestAt !== null) throw new Error('RULE_HEALTH_CONTRADICTION');
  if (input.lastSuccessfulIngestAt !== null && compareRuleTimestamps(input.lastSuccessfulIngestAt,input.observedAt)>0) throw new Error('RULE_HEALTH_IN_FUTURE');
  return { ...input, observedAt: canonicalRuleTimestamp(input.observedAt), expiresAt: canonicalRuleTimestamp(input.expiresAt), lastSuccessfulIngestAt: input.lastSuccessfulIngestAt === null ? null : canonicalRuleTimestamp(input.lastSuccessfulIngestAt), coverage: ratio01(input.coverage), target: target(input.target) };
}
function deepFreeze<T>(value: T): T { if (typeof value === 'object' && value !== null) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
function normalizeInput(input: RuleInput): RuleInput {
  exactKeys(input, ['guildId', 'evaluationAsOf', 'versions', 'requestedRuleIds', 'facts', 'sourceHealth', 'targets'], ['ruleTargets']);
  assertRuleIdentifier(input.guildId);
  exactKeys(input.versions, ['engineVersion', 'configVersion', 'catalogVersion', 'schemaVersion', 'branchVersion', 'actionVersion', 'explanationVersion', 'ruleVersions']);
  for (const [key, value] of Object.entries(input.versions)) if (key !== 'ruleVersions') assertRuleIdentifier(value as string);
  if(Object.keys(input.versions.ruleVersions).length>13)throw new Error('RULE_INPUT_HARD_LIMIT');
  for (const [id, version] of Object.entries(input.versions.ruleVersions)) { if(!registeredRule(id))throw new Error('RULE_UNREGISTERED'); assertRuleIdentifier(version); }
  if (input.facts.length > 2000 || input.targets.length > 500 || (input.ruleTargets?.length??0)>500 || input.sourceHealth.length > 2000 || input.requestedRuleIds.length > 200) throw new Error('RULE_INPUT_HARD_LIMIT');
  const requestedRuleIds = [...input.requestedRuleIds].sort(codePointCompare);
  if (requestedRuleIds.some((id) => !registeredRule(id))) throw new Error('RULE_UNREGISTERED');
  if (new Set(requestedRuleIds).size !== requestedRuleIds.length) throw new Error('RULE_SLOT_DUPLICATE');
  const facts = input.facts.map(normalizeFact).sort((a, b) => codePointCompare(a.metricId, b.metricId) || codePointCompare(canonicalRuleJson(a.dimension), canonicalRuleJson(b.dimension)) || codePointCompare(a.periodRole, b.periodRole) || codePointCompare(a.windowStart, b.windowStart) || codePointCompare(a.windowEnd, b.windowEnd) || codePointCompare(a.sourceRevision, b.sourceRevision) || codePointCompare(a.snapshotId, b.snapshotId));
  facts.forEach(assertRegisteredFact);
  const sourceHealth = input.sourceHealth.map(normalizeSourceHealth).sort((a, b) => codePointCompare(a.observationId, b.observationId) || codePointCompare(a.revision, b.revision));
  if (new Set(sourceHealth.map((h) => h.observationId)).size !== sourceHealth.length) throw new Error('RULE_HEALTH_DUPLICATE');
  if (new Set(facts.map((f) => canonicalRuleJson([f.snapshotId, f.metricId, f.dimension, f.periodRole, f.windowStart, f.windowEnd]))).size !== facts.length || new Set(facts.map((f) => `${f.snapshotId}:${f.factId}`)).size !== facts.length) throw new Error('RULE_FACT_DUPLICATE');
  const healthKeys = new Set(sourceHealth.map((h) => `${h.observationId}:${h.revision}`));
  if (facts.some((f) => f.sourceHealthRefs.some((ref) => !healthKeys.has(`${ref.observationId}:${ref.revision}`)))) throw new Error('RULE_HEALTH_REF_MISSING');
  const targets = input.targets.map(target).sort((a, b) => codePointCompare(canonicalRuleJson(a), canonicalRuleJson(b)));
  if (targets.some((candidate) => candidate.targetType === 'GUILD' && candidate.targetId !== input.guildId)) throw new Error('RULE_GUILD_TARGET_MISMATCH');
  if (new Set(targets.map(canonicalRuleJson)).size !== targets.length) throw new Error('RULE_TARGET_DUPLICATE');
  const targetKeys = new Set(targets.map(canonicalRuleJson));
  if (facts.some((f) => !targetKeys.has(canonicalRuleJson(f.target))) || sourceHealth.some((h) => !targetKeys.has(canonicalRuleJson(h.target)))) throw new Error('RULE_TARGET_REFERENCE_INVALID');
  const ruleTargets=input.ruleTargets?.map(target).sort((a,b)=>codePointCompare(canonicalRuleJson(a),canonicalRuleJson(b)));
  if(ruleTargets){
    if(new Set(ruleTargets.map(canonicalRuleJson)).size!==ruleTargets.length)throw new Error('RULE_TARGET_DUPLICATE');
    const ruleKeys=new Set(ruleTargets.map(canonicalRuleJson));
    if(ruleTargets.some(value=>!targetKeys.has(canonicalRuleJson(value)))||facts.some(value=>!ruleKeys.has(canonicalRuleJson(value.target)))||sourceHealth.some(value=>!ruleKeys.has(canonicalRuleJson(value.target))))throw new Error('RULE_TARGET_REFERENCE_INVALID');
  }
  return { guildId: input.guildId, evaluationAsOf: canonicalRuleTimestamp(input.evaluationAsOf), versions: { ...input.versions, ruleVersions: { ...input.versions.ruleVersions } }, requestedRuleIds, facts, sourceHealth, targets,...(ruleTargets?{ruleTargets}:{}) };
}
/** Called once inside the first accepted server enqueue transaction. No clock read here. */
export function sealRuleInput(input: RuleInput): SealedRuleInput {
  const normalized = normalizeInput(input);
  return deepFreeze({ ...normalized, inputHash: hashRuleValue(normalized) });
}
export function verifySealedRuleInput(input: SealedRuleInput): void {
  exactKeys(input, ['guildId', 'evaluationAsOf', 'versions', 'requestedRuleIds', 'facts', 'sourceHealth', 'targets', 'inputHash'], ['ruleTargets']);
  const { inputHash, ...body } = input;
  if (!/^[a-f0-9]{64}$/.test(inputHash) || hashRuleValue(normalizeInput(body)) !== inputHash || canonicalRuleJson(body) !== canonicalRuleJson(normalizeInput(body))) throw new Error('RULE_INPUT_HASH_MISMATCH');
}
