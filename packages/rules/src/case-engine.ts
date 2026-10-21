import {createHash} from "node:crypto";
import type {ActionCandidate, AggregateBudget, BranchNode, CaseDefinition, CaseEvaluation, CaseRegistry, DecisionContext, EvaluationProfile, EvidenceRef, FieldDefinition, Next, Observation, Operand, Predicate, Scalar, Truth, Unit,Window} from "./case-types";
import {ACTION_PRIORITY_BANDS} from "./case-types";
import {addCalendarDays,assertTimeZone,dateBoundary,parseDateOnly} from "../../automation/src/datetime";

export interface CaseValidationIssue {caseId: string; code: string; path: string;}
const knownOps = new Set(["AND", "OR", "NOT", "=", "!=", "<", "<=", ">", ">=", "IN", "BETWEEN", "EXISTS", "IS_NULL", "AGE_WITHIN"]);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0,19) === value.slice(0,19);
export const normalizeCaseTimestamp = (value: string): string => {if (!instant(value)) throw new Error("CASE_TIMESTAMP_INVALID"); const [whole, fraction] = value.slice(0,-1).split("."); return `${whole}.${(fraction ?? "").padEnd(6,"0")}Z`;};
const micros = (value: string): bigint => {const normalized=normalizeCaseTimestamp(value);return BigInt(Date.parse(normalized.slice(0,19)+"Z"))*1000n+BigInt(normalized.slice(20,26));};
const windowValid = (value: {start: string; end: string}) => instant(value?.start) && instant(value?.end) && micros(value.start) < micros(value.end);
const key = (value: unknown): unknown => Array.isArray(value) ? value.map(key) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, item]) => [name, key(item)])) : instant(value) ? normalizeCaseTimestamp(value) : value;
export const canonicalCaseHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(key(value))).digest("hex");
export const createAggregateBudget = (limits: Pick<AggregateBudget, "maxSteps" | "maxOperations" | "maxInputs">): AggregateBudget => ({...limits, steps: 0, operations: 0, inputs: 0});
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
export function caseWindowContains(window:Window,at:string):boolean{return windowValid(window)&&instant(at)&&micros(at)>=micros(window.start)&&micros(at)<micros(window.end);}
/** Fixed snapshots retain their confirmed boundary instants across tzdata
 * changes. Only a newly accepted source snapshot resolves local boundaries. */
export function validCohortWindow(observation:Observation,resolveNewCalendar=false):boolean{
 try{
  const c=observation.cohort;if(!c||!windowValid(observation.window)||typeof c.timeZone!=="string"||c.timeZone.length>128||!/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/.test(c.timeZone)||!positive(c.metricWindowSeconds))return false;
  const elapsed=micros(observation.window.end)-micros(observation.window.start);
  if(elapsed!==BigInt(c.metricWindowSeconds)*1000000n)return false;
  if(resolveNewCalendar)assertTimeZone(c.timeZone);
  if(c.windowKind==="ELAPSED")return c.calendarDays===undefined&&c.calendarStartDate===undefined&&c.calendarEndDateExclusive===undefined&&c.resolvedCalendar===undefined;
  if(c.windowKind!=="CALENDAR_DAY"||!c.calendarDays||!positive(c.calendarDays)||c.calendarDays>366||!c.calendarStartDate||!c.calendarEndDateExclusive||!c.resolvedCalendar)return false;
  const startDate=parseDateOnly(c.calendarStartDate),endDate=parseDateOnly(c.calendarEndDateExclusive),resolved=c.resolvedCalendar;
  if(addCalendarDays(startDate,c.calendarDays)!==endDate||resolved.boundaryRule!=="firstValidEarlier"||resolved.confirmed!==true||!identifier(resolved.rulesVersion)||normalizeCaseTimestamp(resolved.start)!==normalizeCaseTimestamp(observation.window.start)||normalizeCaseTimestamp(resolved.end)!==normalizeCaseTimestamp(observation.window.end))return false;
  if(resolveNewCalendar){
   if(normalizeCaseTimestamp(dateBoundary(startDate,c.timeZone))!==normalizeCaseTimestamp(resolved.start)||normalizeCaseTimestamp(dateBoundary(endDate,c.timeZone))!==normalizeCaseTimestamp(resolved.end))return false;
   for(let day=0;day<c.calendarDays;day++)dateBoundary(addCalendarDays(startDate,day),c.timeZone);
  }
  return true;
 }catch{return false;}
}

/** Static catalog size is never charged to a runtime budget. */
export function validateCaseCatalog(definitions: readonly CaseDefinition[]): CaseValidationIssue[] {
  const issues: CaseValidationIssue[] = [], caseIds = new Set<string>(), actionIds = new Set<string>();
  for (const definition of definitions) {
    const report = (code: string, path: string) => issues.push({caseId: definition.id, code, path});
    if (!identifier(definition.id) || caseIds.has(definition.id)) report("CASE_ID", "id"); caseIds.add(definition.id);
    if (!identifier(definition.revision)) report("CASE_REVISION", "revision");
    if(!definition.rootTriggers.length||definition.rootTriggers.some(root=>root!=="BASE_RULE_RESULT"&&root!=="AUTHORIZED_OPERATIONAL_CONTEXT")||definition.baseRuleIds?.some(rule=>["EXP-001","PLAY-001","COMM-001"].includes(rule)))report("ROOT_TRIGGER_SCHEMA","rootTriggers");
    if(new Set(definition.sourceMappings.map(source=>source.id)).size!==definition.sourceMappings.length)report("SOURCE_ID","sourceMappings");
    const fields = new Map<string, FieldDefinition>(), branches = new Map<string, BranchNode>(), actions = new Set<string>();
    for (const field of definition.fields) {
      if (!identifier(field.id) || fields.has(field.id)) report("FIELD_ID", field.id);
      fields.set(field.id, field);
      if (!definition.sourceMappings.some(source => source.id === field.sourceId)) report("SOURCE_UNREGISTERED", field.id);
      if (field.type === "enum" && (!field.enumValues?.length || new Set(field.enumValues).size !== field.enumValues.length)) report("ENUM_SCHEMA", field.id);
    }
    for (const action of definition.actions) {
      if (!identifier(action.id) || actions.has(action.id) || actionIds.has(action.id)) report("ACTION_ID", action.id);
      actions.add(action.id); actionIds.add(action.id);
      if (action.mode !== "REVIEW_ONLY" || !action.requiredPermissions.length || !definition.explanations.some(template => template.id === action.explanationId)) report("ACTION_CONTRACT", action.id);
      if(!ACTION_PRIORITY_BANDS.includes(action.priorityBand)||!["ENTITY","POLICY","GUILD"].includes(action.targetSpecificity))report("ACTION_PRIORITY_UNCLASSIFIED",action.id);
    }
    if(definition.targetIdentityField&&!fields.has(definition.targetIdentityField))report("FIELD_UNDECLARED","targetIdentityField");
    const expressionObjects = new WeakSet<object>();
    const operandType = (operand: Operand, path: string, depth: number): {unit?: Unit; type: string; field?: FieldDefinition} => {
      if (!operand || typeof operand !== "object" || depth > 64) {report("OPERAND_SCHEMA", path); return {type: "invalid"};}
      if ("field" in operand) {
        const field = fields.get(operand.field); if (!field) report("FIELD_UNDECLARED", path);
        return {type: field?.projection ? "number" : field?.type ?? "invalid", unit: field?.unit, field};
      }
      if ("literal" in operand) return {type: operand.literal === null ? "null" : typeof operand.literal, unit: operand.unit};
      if ("config" in operand) return {type: "number", unit: operand.unit};
      if ("evaluationAsOf" in operand) return {type: "timestamp", unit: "instant"};
      if ("ratio" in operand) {
        const a = operandType(operand.ratio.numerator, path + ".numerator", depth + 1), b = operandType(operand.ratio.denominator, path + ".denominator", depth + 1);
        if (a.unit !== b.unit) report("RATIO_UNIT", path);
        return {type: "number", unit: "ratio"};
      }
      report("OPERAND_SCHEMA", path); return {type: "invalid"};
    };
    const inspect = (predicate: Predicate, path: string, depth = 0): void => {
      if (!predicate || typeof predicate !== "object" || expressionObjects.has(predicate) || depth > 64 || !knownOps.has(predicate.op)) {report("PREDICATE_SCHEMA", path); return;}
      expressionObjects.add(predicate);
      if (predicate.op === "AND" || predicate.op === "OR") {
        if (!Array.isArray(predicate.args) || !predicate.args.length) report("PREDICATE_ARITY", path);
        else predicate.args.forEach((part, index) => inspect(part, path + "." + index, depth + 1));
      } else if (predicate.op === "NOT") inspect(predicate.arg, path + ".not", depth + 1);
      else if ("left" in predicate) {
        const a = operandType(predicate.left, path + ".left", 0), b = operandType(predicate.right, path + ".right", 0);
        if (a.unit && b.unit && a.unit !== b.unit) report("PREDICATE_UNIT", path);
        if (a.field?.type === "enum" && "literal" in predicate.right && !a.field.enumValues?.includes(String(predicate.right.literal))) report("ENUM_LITERAL", path);
      } else if ("value" in predicate) {
        const a = operandType(predicate.value, path + ".value", 0);
        if (predicate.op === "IN" && a.field?.type === "enum" && predicate.values.some(value => !a.field!.enumValues!.includes(String(value)))) report("ENUM_LITERAL", path);
        if (predicate.op === "BETWEEN") {operandType(predicate.min, path + ".min", 0); operandType(predicate.max, path + ".max", 0);}
        if (predicate.op === "AGE_WITHIN") {const seconds = operandType(predicate.seconds, path + ".seconds", 0); if (a.unit !== "instant" || seconds.unit !== "seconds") report("AGE_UNIT", path);}
      }
      expressionObjects.delete(predicate);
    };
    for (const branch of definition.branches) {
      if (!identifier(branch.id) || branches.has(branch.id)) report("BRANCH_ID", branch.id);
      branches.set(branch.id, branch);
      if (!Number.isSafeInteger(branch.priority)) report("BRANCH_PRIORITY", branch.id);
      if (!branch.unknownNext) report("UNKNOWN_NEXT_REQUIRED", branch.id);
      else if("outcome" in branch.unknownNext&&branch.unknownNext.outcome==="ACTION")report("UNKNOWN_NORMAL_ACTION_FORBIDDEN",branch.id);
      inspect(branch.predicate, branch.id);
    }
    const reached = new Set<string>(), active = new Set<string>();
    const next = (edge: Next | undefined, path: string): void => {
      if (!edge) {report("NEXT_REQUIRED", path); return;}
      if ("branchId" in edge) {
        if (active.has(edge.branchId)) {report("BRANCH_CYCLE", path); return;}
        if (reached.has(edge.branchId)) return;
        const branch = branches.get(edge.branchId); if (!branch) {report("BRANCH_UNDECLARED", path); return;}
        reached.add(branch.id); active.add(branch.id);
        next(branch.trueNext, branch.id + ".true"); next(branch.falseNext, branch.id + ".false"); next(branch.unknownNext, branch.id + ".unknown"); active.delete(branch.id);
      } else if (edge.outcome === "ACTION" ? !edge.actionId || !actions.has(edge.actionId) : edge.actionId !== undefined) report("TERMINAL_ACTION", path);
    };
    next({branchId: definition.entryBranchId}, "entryBranchId");
    for (const id of branches.keys()) if (!reached.has(id)) report("BRANCH_UNREACHABLE", id);
  }
  return issues;
}

class Stop extends Error {constructor(readonly code: string) {super(code);}}
type Rational = {numerator: bigint; denominator: bigint};
type Value = {known: false} | {known: true; value: Scalar | Rational; unit?: Unit};
const unknown: Value = {known: false};
const isRational = (value: Scalar | Rational): value is Rational => typeof value === "object" && value !== null;
function rational(value: number): Rational {
  const [mantissa, exponentRaw] = value.toString().toLowerCase().split("e"), exponent = Number(exponentRaw ?? 0), pieces = mantissa!.split("."), decimals = pieces[1]?.length ?? 0;
  const numerator = BigInt(pieces.join("")), scale = decimals - exponent;
  return scale >= 0 ? {numerator, denominator: 10n ** BigInt(scale)} : {numerator: numerator * 10n ** BigInt(-scale), denominator: 1n};
}
function compareValues(a: Value, b: Value, operation: "=" | "!=" | "<" | "<=" | ">" | ">="): Truth {
  if (!a.known || !b.known || a.unit && b.unit && a.unit !== b.unit) return "UNKNOWN";
  let comparison: number;
  if ((typeof a.value === "number" || isRational(a.value)) && (typeof b.value === "number" || isRational(b.value))) {
    const left = typeof a.value === "number" ? rational(a.value) : a.value, right = typeof b.value === "number" ? rational(b.value) : b.value;
    const delta = left.numerator * right.denominator - right.numerator * left.denominator; comparison = delta < 0n ? -1 : delta > 0n ? 1 : 0;
  } else if (a.unit === "instant" && b.unit === "instant" && instant(a.value) && instant(b.value)) {const left = normalizeCaseTimestamp(a.value), right = normalizeCaseTimestamp(b.value); comparison = left < right ? -1 : left > right ? 1 : 0;}
  else if (typeof a.value === "string" && typeof b.value === "string") comparison = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  else if (typeof a.value === "boolean" && typeof b.value === "boolean") comparison = a.value === b.value ? 0 : a.value ? 1 : -1;
  else if (a.value === null && b.value === null) comparison = 0;
  else return "UNKNOWN";
  const result = operation === "=" ? comparison === 0 : operation === "!=" ? comparison !== 0 : operation === "<" ? comparison === -1 : operation === "<=" ? comparison === -1 || comparison === 0 : operation === ">" ? comparison === 1 : comparison === 1 || comparison === 0;
  return result ? "TRUE" : "FALSE";
}

export function evaluateCase(definition: CaseDefinition, context: DecisionContext, profile: EvaluationProfile, registry: CaseRegistry, options: {aggregateBudget?: AggregateBudget; now?: () => number} = {}): CaseEvaluation {
  const hash = canonicalCaseHash({case: definition, context: {...context, permissions: [...context.permissions].sort(), sourceHealth: [...context.sourceHealth].sort((a,b)=>a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0), fields: Object.fromEntries(definition.fields.map(field => [field.observationField ?? field.id, context.fields[field.observationField ?? field.id] ?? null]))}, profile, registry});
  const budget = {steps: 0, operations: 0, inputs: 0}, path: string[] = [], used = new Set<string>(), evaluatedSources = new Set<string>(), unavailableSources = new Set<string>(), evidence = new Map<string, EvidenceRef>();
  const aggregate = options.aggregateBudget, now = options.now ?? Date.now;
  const finish = (outcome: CaseEvaluation["outcome"], reasonCode: string, complete = false, action: ActionCandidate | null = null): CaseEvaluation => {
    const template = action ? definition.explanations.find(item => item.id === definition.actions.find(item => item.id === action.actionId)?.explanationId) : undefined;
    return {caseId: definition.id, outcome, reasonCode, complete, publishable: complete && profile.kind === "OPERATIONAL" && outcome === "ACTION", canonicalHash: hash, branchPath: [...path], action, explanation: template && action ? {explanationId: template.id, explanationVersion: template.version, branchPath: [...path], observationRefs: [...evidence.values()], observation: template.observation, branchReason: template.branchReason, hypothesis: template.hypothesis ? {textSlot: template.hypothesis, isHypothesis: true} : null, primaryAction: action.actionId, ownerRole: action.ownerRole, caution: template.caution, alternative: template.alternative, reviewCondition: template.reviewCondition, sourceRefs: definition.provenance} : null, usedFields: [...used].sort(), coverage: {requestedSourceIds: [...new Set([...used].flatMap(id => {const field=definition.fields.find(field => field.id === id);return field?[field.sourceId]:[];}))].sort(), evaluatedSourceIds: [...evaluatedSources].sort(), unavailableSourceIds: [...unavailableSources].sort()}, budget: {...budget}};
  };
  const check = () => {
    if (context.cancelled) throw new Stop("CANCELLED"); if (context.tombstoned) throw new Stop("TOMBSTONED");
    if (!context.scopeActive) throw new Stop("SCOPE_REVOKED");
    if (!instant(context.deadlineAt) || now() >= Date.parse(context.deadlineAt)) throw new Stop("DEADLINE_EXCEEDED");
    if (aggregate?.exhausted) throw new Stop("AGGREGATE_BUDGET_EXCEEDED");
  };
  const charge = (kind: "steps" | "operations" | "inputs") => {
    check(); budget[kind]++;
    const maximum = kind === "steps" ? profile.budget.maxSteps : kind === "operations" ? profile.budget.maxOperations : profile.budget.maxInputs;
    if (budget[kind] > maximum) throw new Stop("CASE_BUDGET_EXCEEDED");
    if (aggregate) {
      aggregate[kind]++; const max = kind === "steps" ? aggregate.maxSteps : kind === "operations" ? aggregate.maxOperations : aggregate.maxInputs;
      if (aggregate[kind] > max) {aggregate.exhausted = true; throw new Stop("AGGREGATE_BUDGET_EXCEEDED");}
    }
  };
  const fields = new Map(definition.fields.map(field => [field.id, field])), cached = new Map<string, Value>(), unknownReasons = new Map<string,string>();
  let branchUnknownReason = "INPUT_UNKNOWN";
  let satisfiedConditions=0;
  const asOf = () => micros(context.evaluationAsOf);
  const read = (id: string): Value => {
    if (cached.has(id)) {if(unknownReasons.get(id)==="INPUT_QUALITY")branchUnknownReason="INPUT_QUALITY"; return cached.get(id)!;}
    charge("inputs"); used.add(id);
    const field = fields.get(id); if (!field) throw new Stop("FIELD_UNDECLARED");
    const source = registry.sources.find(item => item.id === field.sourceId), mapping = definition.sourceMappings.find(item => item.id === field.sourceId);
    if (!source || !mapping || !source.confirmed || profile.kind === "OPERATIONAL" && !mapping.confirmed) throw new Stop("SOURCE_DISABLED");
    const requiredPermissions=[...source.requiredPermissions,...mapping.requiredPermissions,...(field.requiredPermissions??[])];
    if (requiredPermissions.some(permission => !context.permissions.includes(permission))) throw new Stop("PERMISSION_REVOKED");
    const observation = context.fields[field.observationField ?? field.id], health = context.sourceHealth.find(item => item.sourceId === field.sourceId);
    const unavailable = (): Value => {const reason=health&&health.quality!=="SUFFICIENT"||observation&&observation.quality!=="SUFFICIENT"?"INPUT_QUALITY":"INPUT_UNKNOWN";unknownReasons.set(id,reason);if(reason==="INPUT_QUALITY")branchUnknownReason=reason;unavailableSources.add(field.sourceId); cached.set(id, unknown); return unknown;};
    if (!health || !health.authorized || health.quality !== "SUFFICIENT" || !instant(health.observedAt) || !instant(health.expiresAt) || micros(health.observedAt) > asOf() || micros(health.expiresAt) <= asOf()) return unavailable();
    if (!observation || observation.quality !== "SUFFICIENT" || observation.sourceId !== field.sourceId || observation.sourceRevision !== health.revision || !["OPERATOR","SYSTEM_OBSERVATION"].includes(observation.sourceKind) || !identifier(observation.observationId) || !instant(observation.observedAt) || !instant(observation.expiresAt) || micros(observation.observedAt) > asOf() || micros(observation.expiresAt) <= asOf() || !windowValid(observation.window)) return unavailable();
    if (observation.authorityScope.guildId !== context.guildId || observation.authorityScope.targetType !== context.target.targetType || observation.authorityScope.targetId !== context.target.targetId || (observation.authorityScope.liveVersion ?? null) !== context.target.liveVersion || requiredPermissions.some(permission => !observation.authorityScope.permissions.includes(permission))) throw new Stop("OBSERVATION_SCOPE_MISMATCH");
    if (field.periodRole && observation.periodRole !== field.periodRole) return unavailable();
    const value = observation.value;
    if (field.type === "cohortMetric" || field.projection) {
      const point = value as {numerator: number; denominator: number; coverage: number}, metric = observation.metricId ? profile.metricConfigs[observation.metricId] : undefined;
      if (!point || typeof point !== "object" || Object.keys(point).some(key=>!["numerator","denominator","coverage"].includes(key)) || observation.unit!=="ratio" || !metric || !Number.isSafeInteger(metric.minN) || metric.minN<=0 || !Number.isFinite(metric.minCoverage) || metric.minCoverage<0 || metric.minCoverage>1 || observation.metricId !== field.metricId || !observation.cohort || !validCohortWindow(observation) || !windowValid(observation.cohort.joinWindow) || !identifier(observation.cohort.cohortId) || !identifier(observation.cohort.cohortDefinitionVersion) || !identifier(observation.cohort.campaignClass) || !Number.isFinite(observation.cohort.maturityOffset) || !positive(observation.cohort.maturityWindowSeconds) || field.cohortClass && observation.cohort.cohortClass !== field.cohortClass || field.windowContractId && observation.cohort.windowContractId !== field.windowContractId || !Number.isSafeInteger(point.numerator) || !Number.isSafeInteger(point.denominator) || point.numerator < 0 || point.numerator > point.denominator || point.denominator < metric.minN || point.denominator <= 0 || !Number.isFinite(point.coverage) || point.coverage < metric.minCoverage || point.coverage > 1) return unavailable();
      const companion = field.comparisonGroup ? definition.fields.find(item => item.comparisonGroup === field.comparisonGroup && item.id !== field.id && item.periodRole !== field.periodRole) : undefined;
      if (companion) {
        const other = context.fields[companion.observationField ?? companion.id], a = observation.cohort, b = other?.cohort;
        if (!other || !b || !validCohortWindow(other) || observation.metricId !== other.metricId || a.cohortClass !== b.cohortClass || a.cohortDefinitionVersion !== b.cohortDefinitionVersion || a.campaignClass !== b.campaignClass || a.maturityOffset !== b.maturityOffset || a.maturityWindowSeconds !== b.maturityWindowSeconds || a.windowContractId !== b.windowContractId || a.windowKind!==b.windowKind || a.timeZone!==b.timeZone || (a.windowKind==="CALENDAR_DAY"?a.calendarDays!==b.calendarDays:a.metricWindowSeconds!==b.metricWindowSeconds)) return unavailable();
      }
      const result: Value = field.projection === "rate" || !field.projection ? {known: true, value: {numerator: BigInt(point.numerator), denominator: BigInt(point.denominator)}, unit: "ratio"} : {known: true, value: point[field.projection], unit: field.unit};
      cached.set(id, result); record(observation, field.sourceId, health); return result;
    }
    const valid = field.type === "enum" ? typeof value === "string" && field.enumValues?.includes(value) : field.type === "boolean" ? typeof value === "boolean" : field.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value) && value >= 0 : field.type === "decimal" ? typeof value === "number" && Number.isFinite(value) : field.type === "timestamp" ? instant(value) : field.type === "nullableTimestamp" ? value === null || instant(value) : field.type === "nullableIdentifier" ? value === null || identifier(value) : identifier(value);
    if (!valid || observation.unit !== field.unit || typeof value === "number" && (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) return unavailable();
    const result: Value = {known: true, value: value as Scalar, unit: field.unit}; cached.set(id, result); record(observation, field.sourceId, health); return result;
  };
  const record = (observation: Observation, sourceId: string, health: DecisionContext["sourceHealth"][number]) => {
    evaluatedSources.add(sourceId);
    evidence.set(observation.observationId, {evidenceId: observation.observationId, kind: "FACT", refId: observation.observationId, sourceRevision: observation.sourceRevision, observedAt: observation.observedAt, expiresAt: observation.expiresAt, windowStart: observation.window.start, windowEnd: observation.window.end});
    evidence.set(health.observationId, {evidenceId: health.observationId, kind: "SOURCE_HEALTH", refId: health.observationId, sourceRevision: health.revision, observedAt: health.observedAt, expiresAt: health.expiresAt, windowStart: observation.window.start, windowEnd: observation.window.end});
  };
  const operand = (value: Operand, depth: number): Value => {
    if (depth > profile.budget.maxDepth) throw new Stop("CASE_DEPTH_EXCEEDED");
    if ("field" in value) return read(value.field);
    if ("literal" in value) return {known: true, value: value.literal, unit: value.unit};
    if ("config" in value) {const item = profile.values[value.config]; return item && item.unit === value.unit ? {known: true, value: item.value, unit: item.unit} : unknown;}
    if ("evaluationAsOf" in value) return {known:true,value:context.evaluationAsOf,unit:"instant"};
    const numerator = operand(value.ratio.numerator, depth + 1), denominator = operand(value.ratio.denominator, depth + 1);
    if (!numerator.known || !denominator.known || typeof numerator.value !== "number" || typeof denominator.value !== "number" || !Number.isSafeInteger(numerator.value) || !Number.isSafeInteger(denominator.value) || denominator.value <= 0 || numerator.unit !== denominator.unit) return unknown;
    return {known: true, value: {numerator: BigInt(numerator.value), denominator: BigInt(denominator.value)}, unit: "ratio"};
  };
  const evaluate = (predicate: Predicate, depth = 0): Truth => {
    charge("operations"); if (depth > profile.budget.maxDepth) throw new Stop("CASE_DEPTH_EXCEEDED");
    const before=satisfiedConditions,leaf=(value:Truth):Truth=>{if(value==="TRUE")satisfiedConditions++;return value;};
    if (predicate.op === "AND" || predicate.op === "OR") {
      let hasUnknown = false;
      for (const arg of predicate.args) {const result = evaluate(arg, depth + 1); if(predicate.op==="AND"&&result==="FALSE"){satisfiedConditions=before;return "FALSE";}if(predicate.op==="OR"&&result==="TRUE")return "TRUE";if(result==="UNKNOWN")hasUnknown=true;}
      if(hasUnknown||predicate.op==="OR")satisfiedConditions=before;
      return hasUnknown ? "UNKNOWN" : predicate.op === "AND" ? "TRUE" : "FALSE";
    }
    if (predicate.op === "NOT") {const result = evaluate(predicate.arg, depth + 1);satisfiedConditions=before;return leaf(result === "UNKNOWN" ? result : result === "TRUE" ? "FALSE" : "TRUE");}
    if ("left" in predicate) return leaf(compareValues(operand(predicate.left, depth + 1), operand(predicate.right, depth + 1), predicate.op));
    const value = operand(predicate.value, depth + 1);
    if (predicate.op === "EXISTS") return leaf(value.known ? "TRUE" : "UNKNOWN");
    if (predicate.op === "IS_NULL") return leaf(value.known ? value.value === null ? "TRUE" : "FALSE" : "UNKNOWN");
    if (predicate.op === "IN") return leaf(value.known ? predicate.values.includes(value.value as Scalar) ? "TRUE" : "FALSE" : "UNKNOWN");
    if (predicate.op === "BETWEEN") {const a = compareValues(value, operand(predicate.min, depth + 1), ">="), b = compareValues(value, operand(predicate.max, depth + 1), "<="); return leaf(a === "FALSE" || b === "FALSE" ? "FALSE" : a === "TRUE" && b === "TRUE" ? "TRUE" : "UNKNOWN");}
    const seconds = operand(predicate.seconds, depth + 1); if (!value.known || !instant(value.value) || !seconds.known || typeof seconds.value !== "number" || !Number.isFinite(seconds.value) || seconds.value < 0 || seconds.unit!=="seconds") return "UNKNOWN";
    const duration=rational(seconds.value),age=asOf()-micros(value.value);
    return leaf(age>=0n && age*duration.denominator<=duration.numerator*1000000n ? "TRUE" : "FALSE");
  };
  try {
    if (validateCaseCatalog([definition]).length) return finish("DISABLED", "CATALOG_INVALID");
    if (!Object.values(profile.budget).every(positive) || aggregate && ![aggregate.maxSteps, aggregate.maxOperations, aggregate.maxInputs].every(positive)) return finish("DISABLED", "BUDGET_CONFIGURATION_INVALID");
    if (profile.kind === "OPERATIONAL" && (!profile.approved || !profile.retentionApproved)) return finish("DISABLED", "APPROVAL_REQUIRED");
    if (!instant(context.evaluationAsOf) || !windowValid(context.window) || !/^\d{5,30}$/.test(context.guildId) || !registry.targetTypes.includes(context.target.targetType) || new Set(context.sourceHealth.map(item=>item.sourceId)).size!==context.sourceHealth.length || new Set(registry.sources.map(item=>item.id)).size!==registry.sources.length) return finish("DISABLED", "CONTEXT_INVALID");
    if (!definition.rootTriggers.includes(context.rootTrigger.kind)) return finish("DISABLED", "ROOT_TRIGGER_UNREGISTERED");
    if (context.rootTrigger.kind === "BASE_RULE_RESULT" && (!definition.baseRuleIds?.includes(context.rootTrigger.ruleId ?? "") || context.rootTrigger.outcome !== "FIRE")) return finish("INELIGIBLE", "BASE_RULE_NOT_FIRED",!!definition.baseRuleIds?.includes(context.rootTrigger.ruleId??"")&&["NO_FIRE","INELIGIBLE","DISABLED"].includes(context.rootTrigger.outcome??""));
    if (context.rootTrigger.kind === "AUTHORIZED_OPERATIONAL_CONTEXT" && !definition.sourceMappings.some(source => source.id === context.rootTrigger.sourceId)) return finish("DISABLED", "ROOT_SOURCE_UNREGISTERED");
    if (definition.requiredAudience && context.audience !== definition.requiredAudience) return finish("INELIGIBLE", "AUDIENCE_RESTRICTED");
    if (!context.evaluationComplete) return finish("INELIGIBLE", "EVALUATION_INCOMPLETE");
    check();
    if (definition.targetIdentityField) {const identity = read(definition.targetIdentityField);if(!identity.known)return finish("INELIGIBLE",branchUnknownReason);if(identity.value!==context.target.targetId)return finish("INELIGIBLE","TARGET_IDENTITY_MISMATCH");}
    let next: Next = {branchId: definition.entryBranchId};
    while ("branchId" in next) {
      charge("steps"); const branchId: string = next.branchId; const branch = definition.branches.find(item => item.id === branchId)!; path.push(branch.id);
      branchUnknownReason="INPUT_UNKNOWN";satisfiedConditions=0;
      const result = evaluate(branch.predicate); next = result === "TRUE" ? branch.trueNext : result === "FALSE" ? branch.falseNext : branch.unknownNext;
      if(result==="UNKNOWN"&&"outcome" in next&&next.reasonCode==="INPUT_UNKNOWN")next={...next,reasonCode:branchUnknownReason};
    }
    if (next.outcome !== "ACTION") return finish(next.outcome, next.reasonCode, next.outcome === "NO_ACTION" || next.outcome === "DIAGNOSTIC");
    const selected = definition.actions.find(action => action.id === next.actionId)!;
    const cooldown=profile.values[definition.id+".cooldownSeconds"];
    if(profile.kind==="OPERATIONAL"&&(!cooldown||cooldown.unit!=="seconds"||typeof cooldown.value!=="number"||!positive(cooldown.value)))return finish("DISABLED","CASE_COOLDOWN_NOT_APPROVED");
    if (selected.requiredPermissions.some(permission => !context.permissions.includes(permission))) return finish("INELIGIBLE", "PERMISSION_REVOKED");
    if (selected.targetType !== context.target.targetType && selected.targetType !== "ANY") return finish("INELIGIBLE", "ACTION_TARGET_MISMATCH");
    check(); if(!evidence.size)return finish("INELIGIBLE","EVIDENCE_REQUIRED"); const actionableUntil = [...evidence.values()].map(item => normalizeCaseTimestamp(item.expiresAt)).sort()[0]!;
    const branch=definition.branches.find(b=>b.id===path.at(-1))!;
    return finish("ACTION", next.reasonCode, true, {actionId: selected.id, target: {...context.target}, mode: "REVIEW_ONLY", ownerRole: selected.ownerRole, requiredPermissions: [...selected.requiredPermissions], impact: selected.impact, typedFields: {}, reviewCriteria: [...selected.reviewCriteria], actionableUntil, branchPath: [...path], evidenceRefs: [...evidence.values()], audience: definition.requiredAudience ?? "GUILD_AUTHORIZED",priority:{band:selected.priorityBand,targetSpecificity:selected.targetSpecificity,satisfiedConditions,explicitPriority:branch.priority,branchId:branch.id}});
  } catch (error) {return finish(error instanceof Stop && error.code === "SOURCE_DISABLED" ? "DISABLED" : "INELIGIBLE", error instanceof Stop ? error.code : "CASE_INPUT_INVALID");}
}

/** IV0 precedence operates only within one canonical logical target/window.
 * None of these decisions changes an underlying RuleResult or performs I/O. */
export function arbitrateCaseActions(results:readonly CaseEvaluation[],windows:Readonly<Record<string,Window>>):{valid:boolean;reasonCode:string|null;results:CaseEvaluation[]}{
 const specificity:Record<string,number>={ENTITY:3,POLICY:2,GUILD:1},groups=new Map<string,CaseEvaluation[]>();
 const invalid=(reasonCode:string)=>({valid:false,reasonCode,results:results.map(result=>result.action?{...result,outcome:"INELIGIBLE" as const,reasonCode,complete:false,publishable:false,action:null,explanation:null}:result)});
 for(const result of results){
  if(result.outcome!=="ACTION"||!result.action)continue;
  const p=result.action.priority,window=windows[result.caseId];
  if(!p||!ACTION_PRIORITY_BANDS.includes(p.band)||!specificity[p.targetSpecificity]||!Number.isSafeInteger(p.satisfiedConditions)||p.satisfiedConditions<1||!Number.isSafeInteger(p.explicitPriority)||!identifier(p.branchId)||!windowValid(window!))return invalid("CASE_PRIORITY_UNCLASSIFIED");
  const group=canonicalCaseHash({targetType:result.action.target.targetType,targetId:result.action.target.targetId,window}),entries=groups.get(group)??[];entries.push(result);groups.set(group,entries);
 }
 const replacement=new Map<string,CaseEvaluation>();
 for(const entries of groups.values()){
  if(new Set(entries.map(entry=>entry.action!.target.liveVersion)).size!==1)return invalid("CASE_TARGET_VERSION_AMBIGUOUS");
  entries.sort((a,b)=>{const left=a.action!.priority,right=b.action!.priority;return ACTION_PRIORITY_BANDS.indexOf(left.band)-ACTION_PRIORITY_BANDS.indexOf(right.band)||specificity[right.targetSpecificity]!-specificity[left.targetSpecificity]!||right.satisfiedConditions-left.satisfiedConditions||left.explicitPriority-right.explicitPriority||(left.branchId<right.branchId?-1:left.branchId>right.branchId?1:a.caseId<b.caseId?-1:a.caseId>b.caseId?1:0);});
  const winner=entries[0]!;replacement.set(winner.caseId,{...winner,arbitration:{status:"SELECTED",winnerCaseId:winner.caseId}});
  for(const suppressed of entries.slice(1))replacement.set(suppressed.caseId,{...suppressed,outcome:"NO_ACTION",reasonCode:"CONFLICT_SUPPRESSED",publishable:false,action:null,explanation:null,arbitration:{status:"CONFLICT_SUPPRESSED",winnerCaseId:winner.caseId}});
 }
 return {valid:true,reasonCode:null,results:results.map(result=>replacement.get(result.caseId)??result)};
}
