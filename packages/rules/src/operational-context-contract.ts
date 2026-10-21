import {z} from "zod";
import {assert} from "../../shared/src/index";
import type {CaseDefinition, FieldDefinition, Operand, Predicate, Scalar, Unit} from "./case-types";
import {operationalSourceIds} from "./operational-context-sources";

/** Closed staff checklist vocabulary. A field missing here cannot be entered by
 * an operator. Measured cohorts, actual permission, people and message bodies
 * cannot be substituted with a checklist answer. */
export const OPERATOR_CASE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  CASE01: ["onb.expectedAccess", "onb.adminFriction", "onb.visibilityState", "onb.previewState"],
  CASE02: ["welcome.channelPurpose", "welcome.introRequired", "welcome.staffCoverageState"],
  CASE03: ["support.intakeState", "support.coverageState", "support.topicClass", "support.specialistAssigned"],
  CASE04: ["support.missingReproduction", "support.missingErrorContext", "support.problemState", "support.guideMappingState"],
  CASE05: ["activity.hostCapacity", "activity.communityPurpose"],
  CASE06: ["event.coverageCapacity", "moderation.issueCategory"],
  CASE07: ["format.capacityState", "format.logisticsState"],
  CASE08: ["activity.hostCapacity", "activity.communityPurpose"],
  CASE09: ["request.status", "request.ownerAssigned", "request.ownerRoleId", "request.reviewDueAt", "request.duplicateOfRequestId", "request.canonicalRef"],
  CASE10: ["channel.expectedAccess", "channel.nameIssue", "channel.protectedUse", "channel.seasonalState", "channel.lifecycleState", "channel.purpose", "channel.overlapStatus"],
  CASE11: ["event.accessBarrierState", "event.optionalFeedback", "event.purpose", "event.ownedBy", "event.hostCapacity"],
  CASE12: ["announcement.correctionFlag", "announcement.category", "announcement.mentionScope", "announcement.canonicalRef", "announcement.missingInfoReport", "announcement.publishState", "announcement.audience"],
  CASE13: ["queueType", "visibility", "actionableNoiseMixState", "caseOwnershipState", "teamOperatingScale", "allowedAudience", "observationState"],
  CASE14: ["availabilityState", "coverageAdjustmentRequest", "responsibilityClarity"],
  CASE15: ["featureSupportCheck", "reviewState"],
  CASE16: ["plannedCampaign", "staffConfirmedIncident", "confirmedDisruption", "temporaryRestrictionState", "incidentResolvedAt"],
  CASE17: ["reportChannel.expectedPermission", "staffConfirmedRedactionReview", "retentionConfiguration.logScope", "aggregateCaseStatus"],
  CASE18: ["contentChecklist", "descriptionPresence", "textCompanion", "essentialInfoTextEquivalentState", "barrierReport"],
  CASE19: ["adminPurpose", "authorizedAggregateViewing.provided", "optionalFeedback", "entryBarrierReview", "urgentTaskClarity"],
  CASE20: ["explicitTags.state", "explicitTags.containsCasualChat", "explicitOutcome", "staffConfirmedBuriedDiscussion", "roleAccessibility.visibilityTagComplexity", "postingActivity"],
});
export const NATIVE_CASE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  CASE01:["onb.actualAccess"],
  CASE02:["welcome.humanStaffReplyCount","welcome.botReplyCount","welcome.nextDestinationConfigured"],
  // Current HELP roots are intake-policy UUIDs. Native Attention issue IDs have
  // no exact request/response relation to that root; prepared issue readers do
  // not make these fields an available source for the current case contract.
  CASE05:["cohort.newCurrent","cohort.newPrior","cohort.establishedCurrent","cohort.establishedPrior"],
  CASE06:["event.scheduled"],CASE07:["format.comparableParticipationState"],CASE08:["activity.integrationErrorCount"],
  CASE10:["channel.actualAccess","channel.messageCount"],CASE11:["event.repeatPoint","event.repeatSourceContract"],CASE12:["announcement.mentionCount"],
  CASE17:["reportChannel.actualPermission"],
  CASE13:["actionableCount","noiseCount"],
  CASE14:["queueLoadCount","oldestOpenQueueAgeMinutes","assignmentConcentrationState","assignmentConcentrationNumerator","assignmentConcentrationDenominator"],
  CASE15:["ruleId","ruleVersion","reviewSetRef","staffFpCount","totalReviewed","triggeredRuleCount","configuredLanguage"],
  CASE19:["postingAggregate"],CASE20:["channelType","archiveState","locked","lastReplyAt"],
});
export function caseFieldSourceKind(caseId: string, fieldId: string): "OPERATOR" | "NATIVE" | "UNAVAILABLE" {return caseId === "CASE09" && fieldId === "request.requestId" || OPERATOR_CASE_FIELDS[caseId]?.includes(fieldId) ? "OPERATOR" : NATIVE_CASE_FIELDS[caseId]?.includes(fieldId) ? "NATIVE" : "UNAVAILABLE";}
/** A policy UUID is not a native issue. Staff-only branches must not turn the
 * absent relation into an actionable ISSUE_TARGET recommendation either. */
export function caseOperationalSourceReadiness(caseId:string){return ["CASE03","CASE04"].includes(caseId)?{available:false as const,reasonCode:"CASE_ISSUE_TARGET_SOURCE_UNAVAILABLE"}:{available:true as const,reasonCode:null};}
/** The original incomplete mapping stays unconfirmed. Confirmation here only
 * identifies an implemented reader, never a source observation or activation. */
export function bindOperationalCaseSources(definition: CaseDefinition): CaseDefinition {
  const original = definition.sourceMappings[0]!, operator = {...original, id: `${original.id}.operator`, confirmed: true, codeRefs: ["packages/rules/src/operational-context.ts:readStoredOperationalCase"], purpose: "Explicit authorized finite staff checklist; OPERATOR provenance, maximum 48 hours; no measured-value substitution."}, native = {...original, id: `${original.id}.native`, confirmed: true, codeRefs: ["packages/rules/src/operational-context.ts:readStoredOperationalCase"], purpose: "Registered exact native metadata and aggregate readers; role access and cohorts require typed source contracts, never staff counters or fixture values."};
  return {...definition, fields: definition.fields.map((field) => ({...field, sourceId: caseFieldSourceKind(definition.id, field.id) === "OPERATOR" ? operator.id : caseFieldSourceKind(definition.id, field.id) === "NATIVE" ? native.id : original.id})), sourceMappings: [original, ...(OPERATOR_CASE_FIELDS[definition.id]?.length ? [operator] : []), ...(NATIVE_CASE_FIELDS[definition.id]?.length ? [native] : [])]};
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), uuid = z.uuid(), caseId = z.string().regex(/^CASE(?:0[1-9]|1[0-9]|20)$/), instant = z.string().datetime({offset: false});
const target = z.object({targetType: id, targetId: id, liveVersion: id.nullable()}).strict();
export const operationalContextSave = z.object({operation: z.literal("CONTEXT_SAVE"), id: uuid, expectedVersion: z.number().int().nonnegative(), caseId, target, fields: z.record(id, z.union([z.string().max(128), z.number().finite(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 128), baseResultId: uuid.nullable(), window: z.object({start: instant, end: instant}).strict().refine((value) => new Date(value.start) < new Date(value.end)).optional(), sources: z.array(z.object({sourceId: z.enum(operationalSourceIds), config: z.unknown()}).strict()).max(3).refine((values) => new Set(values.map((value) => value.sourceId)).size === values.length).optional()}).strict();
export const operationalContextDelete = z.object({operation: z.literal("CONTEXT_DELETE"), id: uuid, expectedVersion: z.number().int().positive()}).strict();
const budget = z.object({maxDepth: z.number().int().min(1).max(64), maxSteps: z.number().int().min(1).max(4096), maxOperations: z.number().int().min(1).max(32768), maxInputs: z.number().int().min(1).max(4096)}).strict();
const aggregate = z.object({maxSteps: z.number().int().min(1).max(65536), maxOperations: z.number().int().min(1).max(524288), maxInputs: z.number().int().min(1).max(65536)}).strict();
export const operationalProfileSave = z.object({operation: z.literal("PROFILE_SAVE"), caseId, expectedVersion: z.number().int().nonnegative(), enabled: z.boolean(), budget, aggregateBudget: aggregate, values: z.record(id, z.object({value: z.number().finite().nonnegative(), unit: z.enum(["count", "ratio", "seconds", "minutes"])}).strict()), metricConfigs: z.record(id, z.object({revision: id, minN: z.number().int().min(1).max(2147483647), minCoverage: z.number().min(0).max(1)}).strict())}).strict();
export const operationalMutation = z.union([operationalContextSave, operationalContextDelete, operationalProfileSave]);
export type OperationalMutation = z.infer<typeof operationalMutation>;
export function profileConfigFields(definition: CaseDefinition): {id: string; unit: Unit; minimum?: number}[] {
  const found = new Map<string, Unit>();
  const operand = (value: Operand) => {if ("config" in value) {assert(!found.has(value.config) || found.get(value.config) === value.unit, "CASE_CONFIG_UNIT_CONFLICT", 500); found.set(value.config, value.unit);} else if ("ratio" in value) {operand(value.ratio.numerator); operand(value.ratio.denominator);}};
  const predicate = (value: Predicate): void => {if (value.op === "AND" || value.op === "OR") value.args.forEach(predicate); else if (value.op === "NOT") predicate(value.arg); else if ("left" in value) {operand(value.left); operand(value.right);} else if (value.op === "BETWEEN") {operand(value.value); operand(value.min); operand(value.max);} else if (value.op === "AGE_WITHIN") {operand(value.value); operand(value.seconds);} else operand(value.value);};
  definition.branches.forEach((branch) => predicate(branch.predicate));
  // ACTION publication already requires this case-specific elapsed-seconds
  // value in the engine. It is a mandatory explicit operating setting, never
  // an inherited Rule calendar cooldown or a supplied production default.
  const cooldown = `${definition.id}.cooldownSeconds`;
  if (definition.actions.length) {assert(!found.has(cooldown) || found.get(cooldown) === "seconds", "CASE_CONFIG_UNIT_CONFLICT", 500); found.set(cooldown, "seconds");}
  return [...found].map(([key, unit]) => ({id: key, unit, ...(key === cooldown ? {minimum: 1} : {})}));
}
export function parseOperatorFields(definition: CaseDefinition, raw: Record<string, Scalar>, resourceId: string): Record<string, Scalar> {
  const allowed = OPERATOR_CASE_FIELDS[definition.id] ?? [], values: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(raw)) {
    assert(allowed.includes(key), "OPERATOR_FIELD_NOT_ALLOWED"); const field = definition.fields.find((entry) => entry.id === key)!;
    let parsed: Scalar;
    if (field.type === "enum") {assert(typeof value === "string" && field.enumValues?.includes(value), "OPERATOR_ENUM_INVALID"); parsed = value;}
    else if (field.type === "boolean") parsed = z.boolean().parse(value);
    else if (field.type === "nullableTimestamp") parsed = instant.nullable().parse(value);
    else if (field.type === "nullableIdentifier") {parsed = key === "request.ownerRoleId" ? z.string().regex(/^\d{17,20}$/).nullable().parse(value) : uuid.nullable().parse(value);}
    else throw new Error("OPERATOR_FIELD_TYPE_NOT_ALLOWED");
    values[key] = parsed;
  }
  if (definition.id === "CASE09") {
    assert(values["request.ownerAssigned"] !== true || typeof values["request.ownerRoleId"] === "string", "REQUEST_OWNER_INVALID");
    assert(values["request.status"] !== "DUPLICATE" || typeof values["request.duplicateOfRequestId"] === "string" && values["request.duplicateOfRequestId"] !== resourceId, "REQUEST_DUPLICATE_INVALID");
    assert(values["request.status"] === "DUPLICATE" || values["request.duplicateOfRequestId"] === undefined || values["request.duplicateOfRequestId"] === null, "REQUEST_DUPLICATE_INVALID");
  }
  if (definition.id === "CASE20" && values["explicitTags.containsCasualChat"] === true) assert(values["explicitTags.state"] === "DECLARED", "CASE_TAG_DECLARATION_REQUIRED");
  return values;
}
export function validateOperationalProfile(definition: CaseDefinition, input: z.infer<typeof operationalProfileSave>) {
  const fields = profileConfigFields(definition), metrics = [...new Set(definition.fields.flatMap((field) => field.metricId ? [field.metricId] : []))];
  for (const [key, value] of Object.entries(input.values)) {const field = fields.find((entry) => entry.id === key); assert(field && field.unit === value.unit, "CASE_PROFILE_CONFIG_INVALID"); if (value.unit === "ratio") assert(value.value <= 1, "CASE_PROFILE_CONFIG_RANGE"); else assert(Number.isSafeInteger(value.value), "CASE_PROFILE_CONFIG_RANGE"); if (field.minimum !== undefined) assert(value.value >= field.minimum, "CASE_PROFILE_CONFIG_RANGE");}
  assert(Object.keys(input.metricConfigs).every((key) => metrics.includes(key)), "CASE_PROFILE_METRIC_INVALID");
  if (input.enabled) {assert(fields.every((field) => input.values[field.id]?.unit === field.unit) && metrics.every((key) => input.metricConfigs[key]), "CASE_PROFILE_INCOMPLETE");}
}
export function operatorFieldDescriptor(field: FieldDefinition) {return {id: field.id, type: field.type, unit: field.unit, enumValues: field.enumValues ?? null};}
