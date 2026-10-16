/** alpha16 case contracts. Configuration and observations never grant authority. */
export type Truth = "TRUE" | "FALSE" | "UNKNOWN";
export type Quality = "SUFFICIENT" | "PARTIAL" | "STALE" | "MISSING" | "SUPPRESSED" | "UNKNOWN";
export type Scalar = string | number | boolean | null;
export type Unit = "state" | "boolean" | "count" | "ratio" | "seconds" | "minutes" | "instant" | "identifier";
export type FieldType = "enum" | "integer" | "decimal" | "boolean" | "timestamp" | "identifier" | "nullableTimestamp" | "nullableIdentifier" | "cohortMetric";
export interface Window {start: string; end: string;}
export interface Target {targetType: string; targetId: string; liveVersion: string | null;}
export interface AuthorityScope {guildId: string; targetType: string; targetId: string; liveVersion?: string | null; permissions: string[];}
export interface CohortMetadata {
  cohortId: string;
  cohortClass: "NEW" | "ESTABLISHED" | "EVENT";
  cohortDefinitionVersion: string;
  campaignClass: string;
  maturityOffset: number;
  maturityWindowSeconds: number;
  metricWindowSeconds: number;
  joinWindow: Window;
  windowContractId?: string;
  windowKind:"ELAPSED"|"CALENDAR_DAY";
  timeZone:string;
  calendarDays?:number;
  calendarStartDate?:string;
  calendarEndDateExclusive?:string;
  /** Resolved once by the internal source; never re-resolved on retry. */
  resolvedCalendar?:{start:string;end:string;boundaryRule:"firstValidEarlier";rulesVersion:string;confirmed:true};
}
export interface CohortMetricPoint {numerator: number; denominator: number; coverage: number;}
export type CaseValue = Scalar | CohortMetricPoint;
export interface Observation<T extends CaseValue = CaseValue> {
  observationId: string;
  value: T;
  quality: Quality;
  unit: Unit;
  sourceId: string;
  sourceRevision: string;
  sourceKind: "OPERATOR" | "SYSTEM_OBSERVATION";
  observedAt: string;
  expiresAt: string;
  authorityScope: AuthorityScope;
  periodRole: "CURRENT" | "PRIOR" | "CONTEXT";
  window: Window;
  metricId?: string;
  cohort?: CohortMetadata;
}
export interface FieldDefinition {
  id: string;
  type: FieldType;
  unit: Unit;
  sourceId: string;
  enumValues?: string[];
  requiredPermissions?: string[];
  metricId?: string;
  comparisonGroup?: string;
  periodRole?: "CURRENT" | "PRIOR" | "CONTEXT";
  projection?: "numerator" | "denominator" | "coverage" | "rate";
  /** A projected scalar shares the immutable observation at this key. */
  observationField?: string;
  min?: number;
  max?: number;
  cohortClass?: "NEW" | "ESTABLISHED" | "EVENT";
  windowContractId?: string;
}
export type Operand = {field: string} | {literal: Scalar; unit?: Unit} | {config: string; unit: Unit} | {evaluationAsOf: true} | {ratio: {numerator: Operand; denominator: Operand}};
export type Predicate =
  | {op: "AND"; args: Predicate[]}
  | {op: "OR"; args: Predicate[]}
  | {op: "NOT"; arg: Predicate}
  | {op: "=" | "!=" | "<" | "<=" | ">" | ">="; left: Operand; right: Operand}
  | {op: "IN"; value: Operand; values: Scalar[]}
  | {op: "BETWEEN"; value: Operand; min: Operand; max: Operand}
  | {op: "EXISTS"; value: Operand}
  | {op: "IS_NULL"; value: Operand}
  | {op: "AGE_WITHIN"; value: Operand; seconds: Operand};
export type TerminalOutcome = "ACTION" | "NO_ACTION" | "INELIGIBLE" | "DIAGNOSTIC";
export type Next = {branchId: string} | {outcome: TerminalOutcome; actionId?: string; reasonCode: string};
export interface BranchNode {id: string; predicate: Predicate; trueNext: Next; falseNext: Next; unknownNext: Next; priority: number;}
export const ACTION_PRIORITY_BANDS=["SAFETY_INCIDENT","DATA_QUALITY","ACCESS_PERMISSION","PENDING_TASK","CAPACITY","PURPOSE_STRUCTURE","REVERSIBLE"] as const;
export type ActionPriorityBand=typeof ACTION_PRIORITY_BANDS[number];
export type TargetSpecificity="ENTITY"|"POLICY"|"GUILD";
export interface ActionDefinition {
  id: string;
  targetType: string;
  mode: "REVIEW_ONLY";
  ownerRole: string;
  requiredPermissions: string[];
  impact: "LOW" | "MEDIUM" | "HIGH";
  typedFields: Record<string, {type: FieldType; unit: Unit; enumValues?: string[]}>;
  reviewCriteria: string[];
  explanationId: string;
  priorityBand:ActionPriorityBand;
  targetSpecificity:TargetSpecificity;
}
export interface ExplanationSlots {
  /** Slots are fixed catalog keys; no untrusted text interpolation. */
  observation: string;
  branchReason: string;
  hypothesis: string | null;
  action: string;
  caution: string;
  alternative: string | null;
  reviewCondition: string;
}
export interface ExplanationTemplate extends ExplanationSlots {
  id: string;
  version: string;
  translations?: {ja: ExplanationSlots; en: ExplanationSlots};
}
export interface CaseReference {
  id: string;
  url: string;
  checkedOn: string;
  provenance: "CASE_OBSERVATION" | "OFFICIAL_GUIDANCE" | "DESIGN_INFERENCE";
  claimType: "OBSERVED_PATTERN" | "GUIDANCE" | "DESIGN_MAPPING";
  reportedPractice: string;
  effectMeasurement: "NOT_REPORTED" | "SELF_REPORTED_NOT_CAUSAL";
}
export interface SourceRegistration {
  id: string;
  confirmed: boolean;
  codeRefs: string[];
  requiredPermissions: string[];
  purpose: string;
}
export interface CaseDefinition {
  id: string;
  revision: string;
  rootTriggers: ("BASE_RULE_RESULT" | "AUTHORIZED_OPERATIONAL_CONTEXT")[];
  baseRuleIds?: string[];
  entryBranchId: string;
  fields: FieldDefinition[];
  branches: BranchNode[];
  actions: ActionDefinition[];
  explanations: ExplanationTemplate[];
  provenance: CaseReference[];
  sourceMappings: SourceRegistration[];
  requiredAudience?: "RESTRICTED_STAFF";
  targetIdentityField?: string;
}
export interface CaseVersions {
  catalog: string; rule: string; engine: string; config: string; schema: string;
  branch: string; action: string; explanation: string;
}
export interface SourceHealthObservation {
  observationId: string; sourceId: string; revision: string; quality: Quality;
  authorized: boolean; observedAt: string; expiresAt: string;
}
export interface DecisionContext {
  contextId: string;
  guildId: string;
  evaluationAsOf: string;
  target: Target;
  rootTrigger: {kind: "BASE_RULE_RESULT" | "AUTHORIZED_OPERATIONAL_CONTEXT"; ruleId?: string; outcome?: "FIRE" | "NO_FIRE" | "INELIGIBLE" | "DISABLED"; sourceId?: string; ruleResultRef?: {ruleId:string;ruleVersion:string;target:Target;window:Window;hash:string}};
  fields: Record<string, Observation>;
  sourceHealth: SourceHealthObservation[];
  permissions: string[];
  versions: CaseVersions;
  window: Window;
  scopeActive: boolean;
  tombstoned: boolean;
  cancelled: boolean;
  evaluationComplete: boolean;
  deadlineAt: string;
  audience?: "GUILD_AUTHORIZED" | "RESTRICTED_STAFF";
}
export interface CaseBudget {maxDepth: number; maxSteps: number; maxOperations: number; maxInputs: number;}
export interface AggregateBudget {
  maxSteps: number; maxOperations: number; maxInputs: number;
  steps: number; operations: number; inputs: number;
  exhausted?: boolean;
}
export interface EvaluationProfile {
  id: string;
  revision: string;
  kind: "SYNTHETIC_FIXTURE" | "OPERATIONAL";
  approved: boolean;
  retentionApproved: boolean;
  budget: CaseBudget;
  values: Record<string, {value: Scalar; unit: Unit}>;
  metricConfigs: Record<string, {revision: string; minN: number; minCoverage: number}>;
}
export interface CaseRegistry {version: string; sources: SourceRegistration[]; targetTypes: string[];}
export interface EvidenceRef {
  evidenceId: string;
  kind: "FACT" | "SOURCE_HEALTH" | "CASE_REFERENCE";
  refId: string;
  sourceRevision: string;
  observedAt: string;
  expiresAt: string;
  windowStart: string;
  windowEnd: string;
}
export interface ActionCandidate {
  actionId: string; target: Target; mode: "REVIEW_ONLY"; ownerRole: string;
  requiredPermissions: string[]; impact: "LOW" | "MEDIUM" | "HIGH";
  typedFields: Record<string, never>; reviewCriteria: string[];
  actionableUntil: string; branchPath: string[]; evidenceRefs: EvidenceRef[];
  audience: "GUILD_AUTHORIZED" | "RESTRICTED_STAFF";
  priority:{band:ActionPriorityBand;targetSpecificity:TargetSpecificity;satisfiedConditions:number;explicitPriority:number;branchId:string};
}
export interface ExplanationPlan {
  explanationId: string; explanationVersion: string; branchPath: string[];
  observationRefs: EvidenceRef[]; observation: string; branchReason: string;
  hypothesis: {textSlot: string; isHypothesis: true} | null;
  primaryAction: string; ownerRole: string; caution: string; alternative: string | null;
  reviewCondition: string; sourceRefs: CaseReference[];
}
export interface CaseEvaluation {
  caseId: string;
  outcome: TerminalOutcome | "DISABLED";
  reasonCode: string;
  complete: boolean;
  publishable: boolean;
  canonicalHash: string;
  branchPath: string[];
  action: ActionCandidate | null;
  explanation: ExplanationPlan | null;
  usedFields: string[];
  coverage: {requestedSourceIds: string[]; evaluatedSourceIds: string[]; unavailableSourceIds: string[]};
  budget: {steps: number; operations: number; inputs: number};
  arbitration?:{status:"SELECTED"|"CONFLICT_SUPPRESSED";winnerCaseId:string};
}
export interface CaseFixture {
  id: string;
  caseId: string;
  baselineId: string;
  changes: string[];
  context: DecisionContext;
  profile: EvaluationProfile;
  registry: CaseRegistry;
  expected: {branchPath: string[]; outcome: CaseEvaluation["outcome"]; reasonCode: string; actionId: string | null; mode: "REVIEW_ONLY" | null; explanationId: string | null};
}
export const f = (field: string): Operand => ({field});
export const literal = (value: Scalar, unit?: Unit): Operand => ({literal: value, ...(unit ? {unit} : {})});
export const config = (key: string, unit: Unit): Operand => ({config: key, unit});
/** Business time is sealed with the input, never supplied as a threshold. */
export const evaluationTime = (): Operand => ({evaluationAsOf: true});
export const ratio = (numerator: Operand, denominator: Operand): Operand => ({ratio: {numerator, denominator}});
export const cmp = (op: "=" | "!=" | "<" | "<=" | ">" | ">=", left: Operand, right: Operand): Predicate => ({op, left, right});
export const eq = (field: string, value: Scalar, unit?: Unit): Predicate => cmp("=", f(field), literal(value, unit));
export const inside = (field: string, values: Scalar[]): Predicate => ({op: "IN", value: f(field), values});
export const all = (...args: Predicate[]): Predicate => ({op: "AND", args});
export const any = (...args: Predicate[]): Predicate => ({op: "OR", args});
export const not = (arg: Predicate): Predicate => ({op: "NOT", arg});
export const isNull = (field: string): Predicate => ({op: "IS_NULL", value: f(field)});
export const terminal = (outcome: TerminalOutcome, reasonCode: string, actionId?: string): Next => ({outcome, reasonCode, ...(actionId ? {actionId} : {})});
