/** CASE13–20 are deterministic review contracts, never operational authorization. */
import {bindOperationalCaseSources} from "./operational-context-contract";
import {
  all, any, cmp, config, eq, f, inside, isNull, literal, not, ratio, terminal,
  type ActionDefinition, type ActionPriorityBand, type TargetSpecificity, type BranchNode, type CaseDefinition, type CaseReference,
  type ExplanationTemplate, type FieldDefinition, type Predicate, type SourceRegistration,
} from "./case-types";

export interface Case13Values {
  queueType: "REPORT" | "MODERATION_ACTION" | "AUTOMATION_ALERT" | "GENERAL_SUPPORT";
  visibility: "PRIVATE_RESTRICTED" | "STAFF_SHARED" | "PUBLIC";
  actionableCount: number;
  noiseCount: number;
  actionableNoiseMixState: "MIX_CONFIRMED" | "NO_MIX_CONFIRMED" | "UNASSESSED";
  caseOwnershipState: "ASSIGNED" | "UNASSIGNED" | "MULTIPLE_OWNERS" | "CLOSED";
  teamOperatingScale: "SMALL" | "STANDARD" | "LARGE";
  allowedAudience: "ADMIN_ONLY" | "MOD_ONLY";
  observationState: "CONFIGURED_REVIEWED" | "NOT_CONFIGURED" | "UNREVIEWED";
}

export interface Case14Values {
  availabilityState: "AVAILABLE" | "REDUCED" | "PAUSED" | "UNASSESSED";
  coverageAdjustmentRequest: "NONE" | "REQUESTED" | "UNREVIEWED";
  queueLoadCount: number;
  oldestOpenQueueAgeMinutes: number;
  assignmentConcentrationState: "DEFINED" | "UNDEFINED";
  assignmentConcentrationNumerator: number;
  assignmentConcentrationDenominator: number;
  responsibilityClarity: "CLEAR" | "UNCLEAR" | "UNREVIEWED";
}

export interface Case15Values {
  ruleId: string;
  ruleVersion: number;
  reviewSetRef: string;
  staffFpCount: number;
  totalReviewed: number;
  triggeredRuleCount: number;
  configuredLanguage: string;
  featureSupportCheck: "CONFIRMED_SUPPORTED" | "CONFIRMED_UNSUPPORTED" | "NOT_REVIEWED";
  reviewState: "REVIEWED" | "UNREVIEWED";
}

export interface Case16Values {
  joinRate: number;
  plannedCampaign: "PLANNED" | "NOT_PLANNED" | "UNASSESSED";
  staffConfirmedIncident: "ACTIVE" | "RESOLVED" | "NONE_CONFIRMED" | "UNREVIEWED";
  confirmedDisruption: "CONFIRMED" | "NONE_CONFIRMED" | "UNASSESSED";
  platformAlertType: "NONE" | "RAID_ALERT" | "SAFETY_ALERT" | "UNASSESSED";
  temporaryRestrictionState: "NONE" | "ACTIVE" | "UNASSESSED";
  incidentResolvedAt: string | null;
}

export interface Case17Values {
  "reportChannel.expectedPermission": "RESTRICTED" | "PUBLIC" | "NOT_CONFIGURED" | "UNASSESSED";
  "reportChannel.actualPermission": "RESTRICTED" | "PUBLIC" | "UNASSESSED";
  staffConfirmedRedactionReview:
    | "PUBLIC_SUMMARY_PII_CONFIRMED" | "BROAD_LOG_SENSITIVE_DATA_CONFIRMED"
    | "NO_PRIVACY_FINDING_CONFIRMED" | "UNASSESSED";
  "retentionConfiguration.logScope": "CASE_RESTRICTED" | "BROAD_LOG" | "NOT_CONFIGURED" | "UNASSESSED";
  aggregateCaseStatus: "OPEN" | "RESOLVED" | "UNASSESSED";
}

export interface Case18Values {
  contentChecklist: "IMPORTANT_IMAGE" | "VOICE_EVENT" | "DECORATIVE_IMAGE" | "OTHER" | "UNASSESSED";
  descriptionPresence: "PRESENT" | "ABSENT" | "UNASSESSED";
  textCompanion: "PRESENT" | "ABSENT" | "EQUIVALENT_ADJACENT" | "UNASSESSED";
  essentialInfoTextEquivalentState: "PRESENT_CONFIRMED" | "MISSING_CONFIRMED" | "UNASSESSED";
  barrierReport: "REPORTED" | "NONE_REPORTED" | "UNASSESSED";
}

export interface Case19Values {
  adminPurpose: "RESOURCE" | "SOCIAL" | "MIXED" | "UNASSESSED";
  "authorizedAggregateViewing.provided": "PROVIDED" | "NOT_PROVIDED" | "UNASSESSED";
  "authorizedAggregateViewing.stabilityReview": "STABLE_CONFIRMED" | "NOT_STABLE_CONFIRMED" | "UNASSESSED";
  "authorizedAggregateViewing.sourceAvailable": boolean;
  postingAggregate: "OBSERVED" | "NOT_AVAILABLE" | "UNASSESSED";
  optionalFeedback: "RECEIVED" | "NONE_REPORTED" | "UNASSESSED";
  entryBarrierReview: "BARRIER_CONFIRMED" | "NO_BARRIER_CONFIRMED" | "UNASSESSED";
  urgentTaskClarity: "CLEAR_CONFIRMED" | "UNCLEAR_CONFIRMED" | "UNASSESSED";
}

export interface Case20Values {
  channelType: "FORUM" | "TEXT_CHAT" | "OTHER" | "UNASSESSED";
  "explicitTags.state": "DECLARED" | "NOT_SET" | "UNASSESSED";
  "explicitTags.containsCasualChat": boolean;
  explicitOutcome: "SOLVED_CONFIRMED" | "PURPOSE_ACHIEVED_CONFIRMED" | "UNSOLVED_CONFIRMED" | "NOT_SET" | "UNASSESSED";
  lastReplyAt: string | null;
  archiveState: "ACTIVE" | "OLDER_POST" | "ARCHIVED" | "UNASSESSED";
  locked: "LOCKED" | "UNLOCKED" | "UNASSESSED";
  staffConfirmedBuriedDiscussion:
    | "MULTIPLE_HELP_BURIED_CONFIRMED" | "OTHER_BURIED_CONFIRMED"
    | "NOT_BURIED_CONFIRMED" | "UNASSESSED";
  postingActivity: "LOW_CONFIRMED" | "REGULAR_CONFIRMED" | "UNASSESSED";
  "roleAccessibility.visibilityTagComplexity": "PROBLEM_CONFIRMED" | "NO_PROBLEM_CONFIRMED" | "UNASSESSED";
}

export interface DutyAssignmentBucket {
  bucketKind: "ROLE" | "DUTY";
  bucketRef: string;
  openAssignments: number;
}

export type DutyConcentration =
  | { state: "DEFINED"; numerator: number; denominator: number; ratio: number }
  | { state: "UNDEFINED"; numerator: 0; denominator: 0; ratio: null }
  | { state: "SOURCE_UNKNOWN"; numerator: null; denominator: null; ratio: null };

const MAX_COUNT = 0xffff_ffff;
const boundedRef = (value: string) => /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const validCount = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;

/** Source-side aggregate only. A bucket cannot represent an individual member. */
export function deriveDutyConcentration(
  buckets: readonly DutyAssignmentBucket[] | null,
): DutyConcentration {
  if (buckets === null)
    return { state: "SOURCE_UNKNOWN", numerator: null, denominator: null, ratio: null };
  if (buckets.length > 128) throw new Error("CASE14_BUCKET_LIMIT");
  const seen = new Set<string>();
  let numerator = 0;
  let denominator = 0;
  for (const bucket of buckets) {
    if (
      !["ROLE", "DUTY"].includes(bucket.bucketKind) ||
      !boundedRef(bucket.bucketRef) ||
      !validCount(bucket.openAssignments)
    )
      throw new Error("CASE14_BUCKET_INVALID");
    const key = `${bucket.bucketKind}:${bucket.bucketRef}`;
    if (seen.has(key)) throw new Error("CASE14_BUCKET_DUPLICATE");
    seen.add(key);
    denominator += bucket.openAssignments;
    if (!validCount(denominator)) throw new Error("CASE14_TOTAL_INVALID");
    numerator = Math.max(numerator, bucket.openAssignments);
  }
  if (denominator === 0)
    return { state: "UNDEFINED", numerator: 0, denominator: 0, ratio: null };
  return { state: "DEFINED", numerator, denominator, ratio: numerator / denominator };
}

export interface FilterReviewSet {
  reviewSetRef: string;
  staffFpCount: number;
  totalReviewed: number;
  triggeredRuleIds: readonly string[];
  declaredTriggeredRuleCount?: number;
}

export interface DerivedFilterReview {
  reviewSetRef: string;
  staffFpCount: number;
  totalReviewed: number;
  triggeredRuleIds: readonly string[];
  triggeredRuleCount: number;
  fpRateState: "DEFINED" | "UNDEFINED";
  fpRate: number | null;
}

/** Counts and triggers must originate from this one immutable review-set ref. */
export function deriveFilterReview(input: FilterReviewSet): DerivedFilterReview {
  if (
    !boundedRef(input.reviewSetRef) ||
    !validCount(input.staffFpCount) ||
    !validCount(input.totalReviewed) ||
    input.staffFpCount > input.totalReviewed ||
    input.triggeredRuleIds.length > 128 ||
    input.triggeredRuleIds.some((id) => !boundedRef(id))
  )
    throw new Error("CASE15_REVIEW_SET_INVALID");
  const triggeredRuleIds = [...new Set(input.triggeredRuleIds)].sort();
  if (
    input.declaredTriggeredRuleCount !== undefined &&
    input.declaredTriggeredRuleCount !== triggeredRuleIds.length
  )
    throw new Error("CASE15_TRIGGER_COUNT_MISMATCH");
  return {
    reviewSetRef: input.reviewSetRef,
    staffFpCount: input.staffFpCount,
    totalReviewed: input.totalReviewed,
    triggeredRuleIds,
    triggeredRuleCount: triggeredRuleIds.length,
    fpRateState: input.totalReviewed === 0 ? "UNDEFINED" : "DEFINED",
    fpRate: input.totalReviewed === 0 ? null : input.staffFpCount / input.totalReviewed,
  };
}

export type ExplicitDiscussionTag = "CASUAL_CHAT" | "HELP" | "RESOURCE" | "OTHER";
/** Preserve the explicit unassessed/not-set states while projecting tag membership. */
export function deriveDiscussionTags(tags: readonly ExplicitDiscussionTag[] | "NOT_SET" | "UNASSESSED") {
  if (tags === "NOT_SET") return {state: "NOT_SET" as const, containsCasualChat: false};
  if (tags === "UNASSESSED") return {state: "UNASSESSED" as const, containsCasualChat: null};
  if (!Array.isArray(tags) || tags.length > 4 || tags.some((tag) => !["CASUAL_CHAT", "HELP", "RESOURCE", "OTHER"].includes(tag)))
    throw new Error("CASE20_TAG_INVALID");
  return {state: "DECLARED" as const, containsCasualChat: tags.includes("CASUAL_CHAT")};
}

const REVISION = "alpha16-integrated-2026-10-16";
const permissionFor = (caseId: number) => caseId <= 17 ? "GOVERN" : "ANALYZE";
const source = (caseId: number, suffix: string, purpose: string): SourceRegistration => ({
  id: `alpha16.case${caseId}.${suffix}`,
  confirmed: false,
  codeRefs: [],
  requiredPermissions: [permissionFor(caseId)],
  purpose,
});
const sources = {
  13: source(13, "restricted-queue", "Restricted queue aggregate and authorized structured staff review; no report body."),
  14: source(14, "duty-coverage", "Explicit availability/rota and registered role/duty aggregate; no individual score."),
  15: source(15, "filter-review", "One immutable staff review set and its corresponding triggered-rule set; no message body."),
  16: source(16, "incident-context", "Staff incident/campaign state, platform alert and temporary restriction metadata."),
  17: source(17, "privacy-checklist", "Expected/observed permissions and authorized structured privacy review; no case narrative."),
  18: source(18, "accessibility-checklist", "Explicit content/text-equivalence checklist and optional structured barrier report."),
  19: source(19, "purpose-checklist", "Explicit task/purpose/entry review and authorized aggregate viewing availability; no reader identity."),
  20: source(20, "forum-checklist", "Channel metadata and explicit outcome/tag/navigation checklist; no message text."),
} as const;

const enumField = (caseId: keyof typeof sources, id: string, enumValues: string[]): FieldDefinition => ({
  id, type: "enum", unit: "state", enumValues, sourceId: sources[caseId].id,
  requiredPermissions: [permissionFor(caseId)], periodRole: "CONTEXT",
});
const countField = (caseId: keyof typeof sources, id: string): FieldDefinition => ({
  id, type: "integer", unit: "count", sourceId: sources[caseId].id,
  requiredPermissions: [permissionFor(caseId)], periodRole: "CONTEXT", min: 0, max: MAX_COUNT,
});
const scalarField = (
  caseId: keyof typeof sources, id: string,
  type: "identifier" | "nullableTimestamp" | "boolean" | "integer",
  unit: "identifier" | "instant" | "boolean" | "minutes",
): FieldDefinition => ({
  id, type, unit, sourceId: sources[caseId].id,
  requiredPermissions: [permissionFor(caseId)], periodRole: "CONTEXT",
});

const fields13 = [
  enumField(13, "queueType", ["REPORT", "MODERATION_ACTION", "AUTOMATION_ALERT", "GENERAL_SUPPORT"]),
  enumField(13, "visibility", ["PRIVATE_RESTRICTED", "STAFF_SHARED", "PUBLIC"]),
  countField(13, "actionableCount"), countField(13, "noiseCount"),
  enumField(13, "actionableNoiseMixState", ["MIX_CONFIRMED", "NO_MIX_CONFIRMED", "UNASSESSED"]),
  enumField(13, "caseOwnershipState", ["ASSIGNED", "UNASSIGNED", "MULTIPLE_OWNERS", "CLOSED"]),
  enumField(13, "teamOperatingScale", ["SMALL", "STANDARD", "LARGE"]),
  enumField(13, "allowedAudience", ["ADMIN_ONLY", "MOD_ONLY"]),
  enumField(13, "observationState", ["CONFIGURED_REVIEWED", "NOT_CONFIGURED", "UNREVIEWED"]),
];
const fields14 = [
  enumField(14, "availabilityState", ["AVAILABLE", "REDUCED", "PAUSED", "UNASSESSED"]),
  enumField(14, "coverageAdjustmentRequest", ["NONE", "REQUESTED", "UNREVIEWED"]),
  countField(14, "queueLoadCount"), scalarField(14, "oldestOpenQueueAgeMinutes", "integer", "minutes"),
  enumField(14, "assignmentConcentrationState", ["DEFINED", "UNDEFINED"]),
  countField(14, "assignmentConcentrationNumerator"), countField(14, "assignmentConcentrationDenominator"),
  enumField(14, "responsibilityClarity", ["CLEAR", "UNCLEAR", "UNREVIEWED"]),
];
const fields15 = [
  scalarField(15, "ruleId", "identifier", "identifier"), countField(15, "ruleVersion"),
  scalarField(15, "reviewSetRef", "identifier", "identifier"),
  countField(15, "staffFpCount"), countField(15, "totalReviewed"), countField(15, "triggeredRuleCount"),
  scalarField(15, "configuredLanguage", "identifier", "identifier"),
  enumField(15, "featureSupportCheck", ["CONFIRMED_SUPPORTED", "CONFIRMED_UNSUPPORTED", "NOT_REVIEWED"]),
  enumField(15, "reviewState", ["REVIEWED", "UNREVIEWED"]),
];
const fields16 = [
  enumField(16, "plannedCampaign", ["PLANNED", "NOT_PLANNED", "UNASSESSED"]),
  enumField(16, "staffConfirmedIncident", ["ACTIVE", "RESOLVED", "NONE_CONFIRMED", "UNREVIEWED"]),
  enumField(16, "confirmedDisruption", ["CONFIRMED", "NONE_CONFIRMED", "UNASSESSED"]),
  enumField(16, "platformAlertType", ["NONE", "RAID_ALERT", "SAFETY_ALERT", "UNASSESSED"]),
  enumField(16, "temporaryRestrictionState", ["NONE", "ACTIVE", "UNASSESSED"]),
  scalarField(16, "incidentResolvedAt", "nullableTimestamp", "instant"),
];
const fields17 = [
  enumField(17, "reportChannel.expectedPermission", ["RESTRICTED", "PUBLIC", "NOT_CONFIGURED", "UNASSESSED"]),
  enumField(17, "reportChannel.actualPermission", ["RESTRICTED", "PUBLIC", "UNASSESSED"]),
  enumField(17, "staffConfirmedRedactionReview", ["PUBLIC_SUMMARY_PII_CONFIRMED", "BROAD_LOG_SENSITIVE_DATA_CONFIRMED", "NO_PRIVACY_FINDING_CONFIRMED", "UNASSESSED"]),
  enumField(17, "retentionConfiguration.logScope", ["CASE_RESTRICTED", "BROAD_LOG", "NOT_CONFIGURED", "UNASSESSED"]),
  enumField(17, "aggregateCaseStatus", ["OPEN", "RESOLVED", "UNASSESSED"]),
];
const fields18 = [
  enumField(18, "contentChecklist", ["IMPORTANT_IMAGE", "VOICE_EVENT", "DECORATIVE_IMAGE", "OTHER", "UNASSESSED"]),
  enumField(18, "descriptionPresence", ["PRESENT", "ABSENT", "UNASSESSED"]),
  enumField(18, "textCompanion", ["PRESENT", "ABSENT", "EQUIVALENT_ADJACENT", "UNASSESSED"]),
  enumField(18, "essentialInfoTextEquivalentState", ["PRESENT_CONFIRMED", "MISSING_CONFIRMED", "UNASSESSED"]),
  enumField(18, "barrierReport", ["REPORTED", "NONE_REPORTED", "UNASSESSED"]),
];
const fields19 = [
  enumField(19, "adminPurpose", ["RESOURCE", "SOCIAL", "MIXED", "UNASSESSED"]),
  enumField(19, "authorizedAggregateViewing.provided", ["PROVIDED", "NOT_PROVIDED", "UNASSESSED"]),
  enumField(19, "authorizedAggregateViewing.stabilityReview", ["STABLE_CONFIRMED", "NOT_STABLE_CONFIRMED", "UNASSESSED"]),
  scalarField(19, "authorizedAggregateViewing.sourceAvailable", "boolean", "boolean"),
  enumField(19, "postingAggregate", ["OBSERVED", "NOT_AVAILABLE", "UNASSESSED"]),
  enumField(19, "optionalFeedback", ["RECEIVED", "NONE_REPORTED", "UNASSESSED"]),
  enumField(19, "entryBarrierReview", ["BARRIER_CONFIRMED", "NO_BARRIER_CONFIRMED", "UNASSESSED"]),
  enumField(19, "urgentTaskClarity", ["CLEAR_CONFIRMED", "UNCLEAR_CONFIRMED", "UNASSESSED"]),
];
const fields20 = [
  enumField(20, "channelType", ["FORUM", "TEXT_CHAT", "OTHER", "UNASSESSED"]),
  enumField(20, "explicitTags.state", ["DECLARED", "NOT_SET", "UNASSESSED"]),
  scalarField(20, "explicitTags.containsCasualChat", "boolean", "boolean"),
  enumField(20, "explicitOutcome", ["SOLVED_CONFIRMED", "PURPOSE_ACHIEVED_CONFIRMED", "UNSOLVED_CONFIRMED", "NOT_SET", "UNASSESSED"]),
  scalarField(20, "lastReplyAt", "nullableTimestamp", "instant"),
  enumField(20, "archiveState", ["ACTIVE", "OLDER_POST", "ARCHIVED", "UNASSESSED"]),
  enumField(20, "locked", ["LOCKED", "UNLOCKED", "UNASSESSED"]),
  enumField(20, "staffConfirmedBuriedDiscussion", ["MULTIPLE_HELP_BURIED_CONFIRMED", "OTHER_BURIED_CONFIRMED", "NOT_BURIED_CONFIRMED", "UNASSESSED"]),
  enumField(20, "postingActivity", ["LOW_CONFIRMED", "REGULAR_CONFIRMED", "UNASSESSED"]),
  enumField(20, "roleAccessibility.visibilityTagComplexity", ["PROBLEM_CONFIRMED", "NO_PROBLEM_CONFIRMED", "UNASSESSED"]),
];

export const CASE_FIELDS_13_20: Record<string, FieldDefinition[]> = {
  CASE13: fields13, CASE14: fields14, CASE15: fields15, CASE16: fields16,
  CASE17: fields17, CASE18: fields18, CASE19: fields19, CASE20: fields20,
};

/** Finite catalog arbitration metadata. These bands do not confer execution rights. */
export const ACTION_PRIORITY_13_20: Record<string, {priorityBand: ActionPriorityBand; targetSpecificity: TargetSpecificity}> = {
  REVIEW_ONLY_REPORT_PRIVACY_SCOPE: {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_RESTRICTED_TRIAGE: {priorityBand: "PENDING_TASK", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_OWNERSHIP_HANDOFF: {priorityBand: "PENDING_TASK", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_SINGLE_QUEUE: {priorityBand: "PURPOSE_STRUCTURE", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_COVERAGE_HANDOFF: {priorityBand: "CAPACITY", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_LOAD_REBALANCE: {priorityBand: "CAPACITY", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_BACKUP_COVERAGE: {priorityBand: "CAPACITY", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_RESPONSIBILITY_CLARIFY: {priorityBand: "PURPOSE_STRUCTURE", targetSpecificity: "ENTITY"},
  REVIEW_ONLY_FEATURE_COMPATIBILITY: {priorityBand: "DATA_QUALITY", targetSpecificity: "POLICY"},
  REVIEW_ONLY_NARROW_MATCHING: {priorityBand: "REVERSIBLE", targetSpecificity: "POLICY"},
  REVIEW_ONLY_TRIGGER_BREAKDOWN: {priorityBand: "DATA_QUALITY", targetSpecificity: "POLICY"},
  REVIEW_ONLY_REVIEW_DATA_GAP: {priorityBand: "DATA_QUALITY", targetSpecificity: "POLICY"},
  REVIEW_ONLY_RESTRICTED_INCIDENT: {priorityBand: "SAFETY_INCIDENT", targetSpecificity: "GUILD"},
  REVIEW_ONLY_INCIDENT_CONFIRMATION: {priorityBand: "SAFETY_INCIDENT", targetSpecificity: "GUILD"},
  REVIEW_ONLY_RESTRICTION_RECOVERY: {priorityBand: "SAFETY_INCIDENT", targetSpecificity: "GUILD"},
  REVIEW_ONLY_CAMPAIGN_CAPACITY: {priorityBand: "CAPACITY", targetSpecificity: "GUILD"},
  "CASE17-B1": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "POLICY"},
  "CASE17-B2": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  "CASE17-B3": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "POLICY"},
  "CASE17-B4": {priorityBand: "PURPOSE_STRUCTURE", targetSpecificity: "ENTITY"},
  "CASE18-B1": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  "CASE18-B2": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  "CASE18-B3": {priorityBand: "REVERSIBLE", targetSpecificity: "ENTITY"},
  "CASE18-B4": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  "CASE19-B1": {priorityBand: "PURPOSE_STRUCTURE", targetSpecificity: "ENTITY"},
  "CASE19-B2": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  "CASE19-B3": {priorityBand: "DATA_QUALITY", targetSpecificity: "ENTITY"},
  "CASE19-B4": {priorityBand: "PENDING_TASK", targetSpecificity: "ENTITY"},
  "CASE20-B1": {priorityBand: "REVERSIBLE", targetSpecificity: "ENTITY"},
  "CASE20-B2": {priorityBand: "PURPOSE_STRUCTURE", targetSpecificity: "ENTITY"},
  "CASE20-B3": {priorityBand: "ACCESS_PERMISSION", targetSpecificity: "ENTITY"},
  "CASE20-B4": {priorityBand: "REVERSIBLE", targetSpecificity: "ENTITY"},
};
interface Leaf {
  number: number;
  predicate: Predicate;
  actionId: string;
  targetType: string;
  ownerRole: string;
  observation: string;
  reason: string;
  action: string;
  caution: string;
  review: string;
  ja: { observation: string; reason: string; action: string; caution: string; review: string };
  hypothesis?: string;
  alternative?: string;
}

const gtZero = (field: string) => cmp(">", f(field), literal(0, "count"));
const leaves13: Leaf[] = [
  {
    number: 1, predicate: all(eq("visibility", "PUBLIC"), eq("queueType", "REPORT")),
    actionId: "REVIEW_ONLY_REPORT_PRIVACY_SCOPE", targetType: "REPORT_QUEUE", ownerRole: "PRIVACY_SAFETY_OWNER",
    observation: "The report queue is observed as public.", reason: "A report route can require a narrower audience than general activity information.",
    action: "Have the privacy/safety owner review the intended reporting audience.", caution: "Keep report content and identities out of ordinary dashboards; no permission change is automatic.", review: "Review after an authorized permission snapshot confirms the intended audience.",
    ja: {observation: "報告キューの公開範囲がPUBLICと観測されています。", reason: "報告経路には一般の活動情報より限定された閲覧範囲が必要な場合があります。", action: "プライバシー・安全担当者が想定する報告先の公開範囲を確認する案です。", caution: "報告本文と個人情報は一般画面へ出さず、権限は自動変更しません。", review: "認可された権限観測で想定する範囲を確認した後に見直します。"},
  },
  {
    number: 2, predicate: all(eq("visibility", "PRIVATE_RESTRICTED"), eq("queueType", "MODERATION_ACTION"), gtZero("actionableCount"), eq("actionableNoiseMixState", "MIX_CONFIRMED"), eq("caseOwnershipState", "ASSIGNED")),
    actionId: "REVIEW_ONLY_RESTRICTED_TRIAGE", targetType: "MODERATION_QUEUE", ownerRole: "MODERATION_LEAD",
    observation: "Staff confirmed that actionable work and noisy logging share the restricted queue.", reason: "Confirmed mixed work, rather than rule ambiguity or report text, selects restricted triage.",
    action: "Have the moderation lead review one restricted triage path for actionable work.", caution: "Do not add broad logs or expose report bodies; these items are actionable, not inferred critical incidents.", review: "Review whether assigned actionable work is distinguishable in the same declared queue window.",
    ja: {observation: "限定キューに対応対象とノイズが混在していることが担当者に確認されています。", reason: "ルールの曖昧さや報告本文ではなく、確認済みの混在を根拠に振り分けを選びます。", action: "モデレーション責任者が対応対象を追える限定トリアージ経路を一つ確認する案です。", caution: "広範なログを増やさず、報告本文を公開せず、重要インシデントとは推定しません。", review: "同じキューの期間条件で担当済み項目を区別できるか見直します。"},
  },
  {
    number: 3, predicate: all(gtZero("actionableCount"), inside("caseOwnershipState", ["UNASSIGNED", "MULTIPLE_OWNERS"])),
    actionId: "REVIEW_ONLY_OWNERSHIP_HANDOFF", targetType: "QUEUE_OWNERSHIP", ownerRole: "MODERATION_LEAD",
    observation: "Actionable items have no owner or multiple owners.", reason: "An explicit ownership conflict precedes a change to rules or channel structure.",
    action: "Have the moderation lead identify one owner and a handoff state.", caution: "This is a workflow review, not an assessment of a volunteer's performance.", review: "Review when the queue records an explicit owner and handoff status.",
    ja: {observation: "対応対象に未担当または担当者重複が確認されています。", reason: "ルールやチャンネル構造を変える前に明示的な担当の競合を確認します。", action: "モデレーション責任者が担当一名と引き継ぎ状態を確認する案です。", caution: "これは手順の確認であり、担当者の能力評価ではありません。", review: "キューに担当と引き継ぎ状態が記録された段階で見直します。"},
  },
  {
    number: 4, predicate: all(eq("visibility", "PRIVATE_RESTRICTED"), eq("queueType", "MODERATION_ACTION"), eq("teamOperatingScale", "SMALL"), eq("caseOwnershipState", "ASSIGNED"), eq("actionableNoiseMixState", "NO_MIX_CONFIRMED")),
    actionId: "REVIEW_ONLY_SINGLE_QUEUE", targetType: "MODERATION_QUEUE", ownerRole: "MODERATION_LEAD",
    observation: "The small team's restricted queue has assigned work and no confirmed actionable/noise mixture.", reason: "The observed workflow does not establish a need for another hierarchy.", action: "Have the moderation lead review retaining one structured queue.", caution: "Do not create every channel mentioned by general guidance.", review: "Review if queue ownership or confirmed mixture changes.",
    ja: {observation: "小規模チームの限定キューは担当が決まり、対応対象との混在なしと確認されています。", reason: "現在の手順から新しい階層の必要性は確認できません。", action: "モデレーション責任者が一つの構造化キューを維持する案です。", caution: "一般的な助言に挙がる全チャンネルを作成しません。", review: "担当状態や混在の確認結果が変わった際に見直します。"},
  },
];

const leaves14: Leaf[] = [
  {
    number: 1, predicate: any(eq("availabilityState", "PAUSED"), eq("coverageAdjustmentRequest", "REQUESTED")),
    actionId: "REVIEW_ONLY_COVERAGE_HANDOFF", targetType: "DUTY_ROTA", ownerRole: "MODERATION_LEAD",
    observation: "A pause or coverage adjustment was explicitly requested.", reason: "A declared availability request precedes queue growth proposals.", action: "Have the lead review removing this duty from expected coverage and arranging a handoff.", caution: "Do not infer health, intent, or availability from online activity.", review: "Review after an explicit rota update or a new voluntary availability declaration.",
    ja: {observation: "休止または担当範囲の調整が明示的に申請されています。", reason: "作業追加より先に申告された対応可能範囲を確認します。", action: "責任者が対象業務を期待する対応範囲から外し、引き継ぎを確認する案です。", caution: "オンライン状況から健康・意図・対応可能時間を推測しません。", review: "明示的な当番表更新または本人の新しい申告後に見直します。"},
  },
  {
    number: 2, predicate: all(eq("availabilityState", "REDUCED"), gtZero("queueLoadCount"), cmp(">=", f("oldestOpenQueueAgeMinutes"), config("queueAgeThresholdMinutes", "minutes"))),
    actionId: "REVIEW_ONLY_LOAD_REBALANCE", targetType: "MODERATION_QUEUE", ownerRole: "MODERATION_LEAD",
    observation: "Declared coverage is reduced and the oldest open work reaches the configured review boundary.", reason: "Available coverage and the queue observation select redistribution before expansion.", action: "Have the lead review redistributing duties or reducing the current scope.", caution: "The configured boundary is an operator setting, not a wellbeing diagnosis or universal benchmark.", review: "Review the same queue window after a voluntary coverage/scope update.",
    ja: {observation: "対応範囲の縮小が申告され、最古の未処理項目が設定された確認境界に達しています。", reason: "対応範囲とキューの観測から、拡大より先に再配分を選びます。", action: "責任者が業務の再配分または範囲縮小を確認する案です。", caution: "境界は運営設定であり、健康状態の診断や普遍的な基準ではありません。", review: "合意した担当範囲を更新した後、同じキュー期間で見直します。"},
  },
  {
    number: 3, predicate: all(gtZero("queueLoadCount"), eq("assignmentConcentrationState", "DEFINED"), cmp("<=", f("assignmentConcentrationNumerator"), f("assignmentConcentrationDenominator")), cmp(">=", ratio(f("assignmentConcentrationNumerator"), f("assignmentConcentrationDenominator")), config("assignmentConcentrationThreshold", "ratio"))),
    actionId: "REVIEW_ONLY_BACKUP_COVERAGE", targetType: "DUTY_ASSIGNMENT_MAP", ownerRole: "MODERATION_LEAD",
    observation: "The largest registered role/duty bucket reaches the configured share of all open bucket assignments.", reason: "This aggregate identifies a coverage concentration, not the busiest individual.", action: "Have the lead review backup coverage for the affected duty bucket.", caution: "No personal ranking, individual assignment maximum, or ability score is calculated.", review: "Review the same registered buckets after coverage changes; zero total remains undefined.",
    ja: {observation: "登録されたロール・業務区分の最大割当率が設定された境界に達しています。", reason: "個人別ではなく業務区分の集計から対応範囲の偏りを確認します。", action: "責任者が対象業務の補助担当を確認する案です。", caution: "個人ランキング・個人別の最大割当率・能力スコアは計算しません。", review: "担当範囲変更後に同じ区分で見直し、全割当ゼロは未定義のまま扱います。"},
  },
  {
    number: 4, predicate: eq("responsibilityClarity", "UNCLEAR"),
    actionId: "REVIEW_ONLY_RESPONSIBILITY_CLARIFY", targetType: "STAFF_RESPONSIBILITY", ownerRole: "GUILD_ADMIN",
    observation: "Responsibilities are explicitly marked unclear.", reason: "An acknowledged duty-definition gap can be reviewed without inferring a staffing deficit.", action: "Have an administrator review a concise duty and handoff description.", caution: "Do not recruit or increase events by default.", review: "Review after staff confirm the intended duties and escalation route.",
    ja: {observation: "責務が不明確であることが明示されています。", reason: "人員不足を推測せず、確認済みの業務定義の不足を扱います。", action: "管理者が短い業務・引き継ぎの説明を確認する案です。", caution: "既定で増員やイベント追加を提案しません。", review: "担当者が責務と相談先を確認した後に見直します。"},
  },
];

const supportedReviewed = () => all(eq("featureSupportCheck", "CONFIRMED_SUPPORTED"), eq("reviewState", "REVIEWED"), cmp(">=", f("totalReviewed"), config("minReviewedN", "count")));
const leaves15: Leaf[] = [
  {
    number: 1, predicate: eq("featureSupportCheck", "CONFIRMED_UNSUPPORTED"),
    actionId: "REVIEW_ONLY_FEATURE_COMPATIBILITY", targetType: "MODERATION_FILTER", ownerRole: "MODERATION_ADMIN",
    observation: "Staff confirmed the configured feature is unsupported for this use.", reason: "Known feature compatibility precedes a false-positive judgment.", action: "Have the moderation administrator review supported feature/language settings.", caution: "NEXUS does not infer guilt or automatically disable filtering; external AutoMod may use machine learning.", review: "Review after an authorized compatibility check confirms the intended feature.",
    ja: {observation: "設定された機能がこの用途に対応しないと担当者が確認しています。", reason: "誤検出の判断より先に既知の機能適合性を確認します。", action: "管理担当者が機能と言語の対応条件を確認する案です。", caution: "有罪の推定やフィルターの自動無効化はせず、外部AutoModを非学習とは断定しません。", review: "認可された確認で機能の適合性が確かめられた後に見直します。"},
  },
  {
    number: 2, predicate: all(supportedReviewed(), eq("triggeredRuleCount", 1, "count"), gtZero("totalReviewed"), cmp("<=", f("staffFpCount"), f("totalReviewed")), cmp(">=", ratio(f("staffFpCount"), f("totalReviewed")), config("fpRateThreshold", "ratio"))),
    actionId: "REVIEW_ONLY_NARROW_MATCHING", targetType: "MODERATION_FILTER", ownerRole: "MODERATION_ADMIN",
    observation: "The same reviewed set has one triggered rule and a staff-confirmed false-positive ratio at the configured boundary.", reason: "A supported, sufficiently reviewed single-rule set permits a narrow matching review.", action: "Have the administrator review that rule's matching and exemption conditions.", caution: "The ratio is an observation, not confidence or a universal benchmark; do not broadly disable filtering.", review: "Review a new authorized sample after a separately approved narrow change.",
    ja: {observation: "同じ確認済み集合で発火ルールが一つ、担当者確認の誤検出比率が設定境界に達しています。", reason: "機能対応と必要件数を満たす単一ルールの集合なので、限定的な一致条件の確認を選びます。", action: "管理担当者が対象ルールの一致条件と例外条件を確認する案です。", caution: "比率は観測値であり信頼度や普遍的な基準ではなく、全体の無効化は行いません。", review: "別途承認された限定変更後、新しい認可済みサンプルで見直します。"},
  },
  {
    number: 3, predicate: all(supportedReviewed(), cmp(">=", f("triggeredRuleCount"), literal(2, "count")), cmp("<=", f("staffFpCount"), f("totalReviewed"))),
    actionId: "REVIEW_ONLY_TRIGGER_BREAKDOWN", targetType: "MODERATION_FILTER_SET", ownerRole: "MODERATION_LEAD",
    observation: "At least two corresponding rules triggered in the same sufficiently reviewed set.", reason: "Mixed triggers require a breakdown before changing one or all filters.", action: "Have the moderation lead review aggregate outcomes by the actual triggered rule.", caution: "Do not attribute a mixed-set false-positive count to one rule or ingest message bodies.", review: "Review when separate authorized rule-level aggregates are available.",
    ja: {observation: "必要件数を満たす同一の確認済み集合で二つ以上のルールが発火しています。", reason: "一つまたは全体のフィルターを変える前に発火内訳を確認します。", action: "責任者が実際に発火したルールごとの集計を確認する案です。", caution: "混合集合の誤検出を一つのルールへ帰属させず、本文は取り込みません。", review: "認可されたルール別集計が得られた段階で見直します。"},
  },
  {
    number: 4, predicate: any(eq("featureSupportCheck", "NOT_REVIEWED"), eq("reviewState", "UNREVIEWED"), cmp("<", f("totalReviewed"), config("minReviewedN", "count"))),
    actionId: "REVIEW_ONLY_REVIEW_DATA_GAP", targetType: "MODERATION_FILTER_REVIEW", ownerRole: "MODERATION_LEAD",
    observation: "Feature support, review status, or the configured reviewed sample is incomplete.", reason: "A known review gap does not establish filter correctness or incorrectness.", action: "Have the lead review the missing structured compatibility/sample information.", caution: "Do not turn unreviewed items into false positives or compare a zero denominator.", review: "Review after the same-set review contract and approved sample requirements are met.",
    ja: {observation: "機能対応・審査状態・設定された確認件数のいずれかが不足しています。", reason: "既知の確認不足からフィルターの正誤を断定しません。", action: "責任者が不足する対応条件や集計確認を行う案です。", caution: "未審査を誤検出に変換せず、分母ゼロの比率を比較しません。", review: "同一集合の確認契約と承認済み件数条件が満たされた後に見直します。"},
  },
];

const leaves16: Leaf[] = [
  {
    number: 1, predicate: eq("staffConfirmedIncident", "ACTIVE"),
    actionId: "REVIEW_ONLY_RESTRICTED_INCIDENT", targetType: "GUILD_SECURITY", ownerRole: "SECURITY_ADMIN",
    observation: "Staff explicitly confirmed an active incident.", reason: "A confirmed incident precedes growth and campaign monitoring.", action: "Have the authorized security owner review the restricted incident response path.", caution: "No automatic ban or security change; join volume alone does not confirm a raid.", review: "Review after staff explicitly change incident status and assess current restrictions.",
    ja: {observation: "担当者が進行中のインシデントを明示確認しています。", reason: "確認済みのインシデントを成長施策やキャンペーン監視より優先します。", action: "認可された安全担当者が限定された対応経路を確認する案です。", caution: "自動BANや安全設定変更はせず、参加数だけでraidを確定しません。", review: "担当者が状態を明示更新し、制限を確認した後に見直します。"},
  },
  {
    number: 4, predicate: any(eq("staffConfirmedIncident", "UNREVIEWED"), all(inside("platformAlertType", ["RAID_ALERT", "SAFETY_ALERT"]), eq("staffConfirmedIncident", "NONE_CONFIRMED"))),
    actionId: "REVIEW_ONLY_INCIDENT_CONFIRMATION", targetType: "RESTRICTED_SAFETY_REVIEW", ownerRole: "SECURITY_ADMIN",
    observation: "Staff incident review is explicitly unreviewed, or a raid/safety alert exists without a confirmed incident.", reason: "Unreviewed safety context requires restricted confirmation before a campaign-capacity explanation.", action: "Have the security administrator confirm the recorded safety context in the restricted view.", caution: "Unreviewed status or an alert is not proof of an incident; no enforcement action or identity inference is generated.", review: "Review when authorized staff explicitly confirm or dismiss the incident state.",
    ja: {observation: "安全状態が明示的に未審査、またはインシデント未確認のプラットフォーム警告があります。", reason: "キャンペーンの容量説明へ進む前に限定された確認が必要です。", action: "安全管理者が限定画面で記録された安全状態を確認する案です。", caution: "未審査や警告だけではインシデントの証明にならず、処罰や人物推定は行いません。", review: "認可された担当者が状態を明示確認した後に見直します。"},
  },
  {
    number: 2, predicate: all(eq("staffConfirmedIncident", "RESOLVED"), eq("temporaryRestrictionState", "ACTIVE"), not(isNull("incidentResolvedAt"))),
    actionId: "REVIEW_ONLY_RESTRICTION_RECOVERY", targetType: "GUILD_SECURITY", ownerRole: "SECURITY_ADMIN",
    observation: "The incident is explicitly resolved with a resolution timestamp, while temporary restrictions remain active.", reason: "Known recovery work precedes ordinary campaign monitoring.", action: "Have the security administrator review current restrictions and a restoration checklist.", caution: "Do not automatically reopen the server or rewrite the past incident outcome.", review: "Review after a separately authorized restoration decision and fresh restriction observation.",
    ja: {observation: "解決日時と解決済み状態が確認されていますが、一時制限が残っています。", reason: "通常のキャンペーン監視より先に既知の復旧作業を確認します。", action: "安全管理者が現在の制限と復旧条件を確認する案です。", caution: "サーバーを自動開放せず、過去のインシデント結果も書き換えません。", review: "別途承認された復旧判断と新しい制限観測の後に見直します。"},
  },
  {
    number: 3, predicate: all(eq("plannedCampaign", "PLANNED"), eq("staffConfirmedIncident", "NONE_CONFIRMED"), eq("confirmedDisruption", "NONE_CONFIRMED"), eq("platformAlertType", "NONE")),
    actionId: "REVIEW_ONLY_CAMPAIGN_CAPACITY", targetType: "CAMPAIGN_CONTEXT", ownerRole: "COMMUNITY_OPERATOR",
    observation: "A campaign is planned, no disruption or incident is confirmed, and the platform alert state is explicitly NONE.", reason: "Known campaign context supports capacity observation without classifying a raid.", action: "Have the community operator review campaign capacity only.", caution: "No universal join-rate threshold, automatic restriction, or member attribute inference is used.", review: "Review if staff incident, disruption, alert, or campaign state changes.",
    ja: {observation: "予定されたキャンペーンで、障害やインシデントは確認されず、警告状態は明示的にNONEです。", reason: "既知のキャンペーン状況から、raidと分類せず容量確認を選びます。", action: "運営担当者がキャンペーンの対応容量だけを確認する案です。", caution: "普遍的な参加数閾値・自動制限・メンバー属性の推測は使いません。", review: "インシデント・障害・警告・キャンペーンの確認状態が変わった際に見直します。"},
  },
];

const leaves17: Leaf[] = [
  {
    number: 1, predicate: all(eq("reportChannel.expectedPermission", "RESTRICTED"), eq("reportChannel.actualPermission", "PUBLIC")),
    actionId: "CASE17-B1", targetType: "REPORT_CHANNEL", ownerRole: "GUILD_ADMIN",
    observation: "The intended report channel is restricted, but the current permission observation is public.", reason: "The expected/actual access difference requires review; public visibility alone would not establish this mismatch.", action: "Have the guild administrator review an authorized restricted reporting path.", caution: "No report narratives or reporter identities appear in general activity views.", review: "Review after a fresh authorized permission observation matches the declared audience.",
    ja: {observation: "報告先は限定公開を想定していますが、現在の権限観測は公開です。", reason: "公開であることだけではなく、期待する範囲と実測の差から確認を選びます。", action: "管理者が認可された限定報告経路を確認する案です。", caution: "報告本文や報告者情報は一般の活動画面へ表示しません。", review: "新しい認可済み観測が想定する閲覧範囲と一致した後に見直します。"},
  },
  {
    number: 2, predicate: eq("staffConfirmedRedactionReview", "PUBLIC_SUMMARY_PII_CONFIRMED"),
    actionId: "CASE17-B2", targetType: "PUBLIC_SUMMARY", ownerRole: "PRIVACY_OWNER",
    observation: "An authorized reviewer confirmed personal information in a public summary.", reason: "The explicit privacy finding selects a redaction review without reading the summary body here.", action: "Have the privacy owner review redaction before further publication.", caution: "This recommendation does not publish, withdraw, or copy identifying material.", review: "Review after the authorized owner confirms the revised summary's public fields.",
    ja: {observation: "権限者が公開サマリーの個人情報を確認しています。", reason: "本文を取り込まず、明示的なプライバシー確認から伏字の検討を選びます。", action: "プライバシー担当者が次の公開前に伏字対象を確認する案です。", caution: "この提案から公開・撤回・識別情報の複製は行いません。", review: "権限者が修正版の公開項目を確認した後に見直します。"},
  },
  {
    number: 3, predicate: all(eq("retentionConfiguration.logScope", "BROAD_LOG"), eq("staffConfirmedRedactionReview", "BROAD_LOG_SENSITIVE_DATA_CONFIRMED")),
    actionId: "CASE17-B3", targetType: "RETENTION_LOG", ownerRole: "PRIVACY_OWNER",
    observation: "The log scope is broad and an authorized reviewer confirmed sensitive data in it.", reason: "A confirmed finding and broad scope select a privacy retention/deletion review.", action: "Have the privacy owner review the permitted retention and deletion path.", caution: "No deletion is automatically authorized; new retention periods remain unapproved.", review: "Review after an authorized purpose/scope/retention decision and corresponding status observation.",
    ja: {observation: "ログ範囲が広く、権限者が機微情報の存在を確認しています。", reason: "広い範囲と確認済みの情報から保持・削除の検討を選びます。", action: "プライバシー担当者が認可された保持と削除の経路を確認する案です。", caution: "削除は自動承認せず、新たな保持期間も未承認のままです。", review: "目的・範囲・保持の承認と対応状態を確認した後に見直します。"},
  },
  {
    number: 4, predicate: all(eq("reportChannel.expectedPermission", "PUBLIC"), eq("reportChannel.actualPermission", "PUBLIC"), eq("staffConfirmedRedactionReview", "NO_PRIVACY_FINDING_CONFIRMED"), eq("retentionConfiguration.logScope", "CASE_RESTRICTED")),
    actionId: "CASE17-B4", targetType: "PUBLIC_FEEDBACK_ROUTE", ownerRole: "COMMUNITY_MANAGER",
    observation: "Public access matches the declared feedback route, with no confirmed privacy finding and case-restricted logs.", reason: "Public-by-design feedback should not be treated as a private-report permission violation.", action: "Have the community manager review retaining the ordinary public feedback route.", caution: "Do not require private disclosure for ordinary feedback or claim all privacy risks are absent.", review: "Review if the route purpose, access, retention scope, or confirmed findings change.",
    ja: {observation: "公開範囲は意図したフィードバック経路と一致し、確認済みの問題はなく、ログは案件単位で限定されています。", reason: "意図した公開フィードバックを、非公開報告の権限違反とは扱いません。", action: "運営担当者が通常の公開フィードバック経路を維持する案です。", caution: "通常の意見に私的な開示を要求せず、全リスクなしとも断定しません。", review: "用途・権限・保持範囲・確認結果が変わった際に見直します。"},
  },
];

const leaves18: Leaf[] = [
  {
    number: 4, predicate: eq("barrierReport", "REPORTED"),
    actionId: "CASE18-B4", targetType: "ACCESSIBILITY_BARRIER", ownerRole: "COMMUNITY_MANAGER",
    observation: "A specific access barrier was voluntarily reported through a structured route.", reason: "The concrete barrier takes priority over generic content guidance or decorative-image duplication suppression.", action: "Have the community manager review the reported barrier within its declared scope.", caution: "Do not disclose the reporter or infer disability, identity, or a diagnosis.", review: "Review after an authorized follow-up confirms the specific access route.",
    ja: {observation: "具体的な利用上の障壁が任意の構造化経路で報告されています。", reason: "一般的な形式案や装飾画像への冗長追記の抑止より、この報告を優先します。", action: "運営担当者が報告対象に限って障壁を確認する案です。", caution: "報告者を公開せず、障害・属性・診断を推測しません。", review: "認可された追加確認で対象の利用経路を確認した後に見直します。"},
  },
  {
    number: 1, predicate: all(eq("contentChecklist", "IMPORTANT_IMAGE"), eq("essentialInfoTextEquivalentState", "MISSING_CONFIRMED")),
    actionId: "CASE18-B1", targetType: "CONTENT_ITEM", ownerRole: "COMMUNITY_MANAGER",
    observation: "The checklist marks important image content and confirms that equivalent essential information is missing in text.", reason: "Description presence alone does not establish information equivalence.", action: "Have the content owner review one equivalent plain-text account of the essential information.", caution: "No OCR or text collection occurs; alt-text presence does not certify accessibility.", review: "Review after the owner explicitly confirms equivalent essential information in text.",
    ja: {observation: "重要な画像で、必要情報と同等のテキストがないと確認されています。", reason: "説明文が存在することだけでは情報の同等性を証明しません。", action: "担当者が必要情報と同等のテキストを一つ用意する案です。", caution: "OCRや本文収集はせず、代替文の存在だけで適合認証とはしません。", review: "担当者が必要情報のテキスト同等性を明示確認した後に見直します。"},
  },
  {
    number: 2, predicate: all(eq("contentChecklist", "VOICE_EVENT"), eq("textCompanion", "ABSENT")),
    actionId: "CASE18-B2", targetType: "VOICE_EVENT", ownerRole: "EVENT_OWNER",
    observation: "The voice-event checklist confirms no text companion route.", reason: "A missing text participation route selects a bounded event-access review.", action: "Have the event owner review a text companion route and facilitator.", caution: "No voice recording or transcription is introduced, and no medical disclosure is required.", review: "Review when the event owner confirms a usable text route.",
    ja: {observation: "音声イベントにテキストの補助経路がないと確認されています。", reason: "不足する参加経路を根拠にイベントの利用方法を確認します。", action: "イベント担当者がテキストの経路と補助担当を確認する案です。", caution: "録音・文字起こしを導入せず、医療情報の開示も要求しません。", review: "担当者が利用できるテキスト経路を確認した後に見直します。"},
  },
  {
    number: 3, predicate: all(eq("contentChecklist", "DECORATIVE_IMAGE"), eq("textCompanion", "EQUIVALENT_ADJACENT"), eq("essentialInfoTextEquivalentState", "PRESENT_CONFIRMED")),
    actionId: "CASE18-B3", targetType: "CONTENT_ITEM", ownerRole: "COMMUNITY_MANAGER",
    observation: "The image is decorative and equivalent essential text is explicitly confirmed adjacent to it.", reason: "No concrete reported barrier selected an earlier branch, so redundant additions need not be demanded.", action: "Have the owner review retaining the useful adjacent text without duplicate verbosity.", caution: "This does not dismiss future barrier reports or certify universal access.", review: "Review if essential content, text equivalence, or a reported barrier changes.",
    ja: {observation: "装飾画像のそばに必要情報と同等のテキストが確認されています。", reason: "先行する具体的な障壁報告がないため、冗長な追記は要求しません。", action: "担当者が重複を増やさず有用な隣接テキストを維持する案です。", caution: "今後の障壁報告を否定せず、全利用者への適合も認証しません。", review: "必要情報・同等性・障壁報告が変わった際に見直します。"},
  },
];

const leaves19: Leaf[] = [
  {
    number: 4, predicate: eq("urgentTaskClarity", "UNCLEAR_CONFIRMED"),
    actionId: "CASE19-B4", targetType: "TASK_GUIDANCE", ownerRole: "COMMUNITY_MANAGER",
    observation: "An urgent task's guidance is explicitly confirmed unclear.", reason: "Task clarity precedes maintaining a resource format and does not require unrelated viewing data.", action: "Have the community manager clarify one task, destination, and responsible role.", caution: "Do not demand casual conversation or contact individual non-posters.", review: "Review after the task route is explicitly confirmed clear.",
    ja: {observation: "急ぎの作業の案内が不明確であると確認されています。", reason: "資料用途の維持より作業の分かりやすさを優先し、無関係な閲覧値は要求しません。", action: "運営担当者が作業一つと行き先・担当を明確にする案です。", caution: "雑談を要求せず、投稿しない個人へ連絡しません。", review: "作業経路が明確になったと確認された後に見直します。"},
  },
  {
    number: 1, predicate: all(eq("adminPurpose", "RESOURCE"), eq("authorizedAggregateViewing.sourceAvailable", true, "boolean"), eq("authorizedAggregateViewing.provided", "PROVIDED"), eq("authorizedAggregateViewing.stabilityReview", "STABLE_CONFIRMED")),
    actionId: "CASE19-B1", targetType: "RESOURCE_CHANNEL_GUIDANCE", ownerRole: "COMMUNITY_MANAGER",
    observation: "Resource purpose and stable viewing are explicitly confirmed through an available authorized aggregate source.", reason: "Reading serves the declared purpose and low posting alone does not establish a problem.", action: "Have the community manager review retaining a reading-friendly resource route.", caution: "Do not label lurkers, infer disengagement, or use historical Partner requirements as thresholds.", review: "Review when purpose, authorized aggregate availability, or confirmed stability changes.",
    ja: {observation: "資料用途と安定した閲覧が、利用可能な認可済み集計から明示確認されています。", reason: "読む利用は用途に沿っており、投稿が少ないだけでは問題としません。", action: "運営担当者が読むことを中心に使える資料導線を維持する案です。", caution: "個人の潜在利用ラベルや離脱推定を作らず、過去のPartner要件も閾値にしません。", review: "用途・認可集計の提供状態・安定性が変わった際に見直します。"},
  },
  {
    number: 2, predicate: all(eq("adminPurpose", "SOCIAL"), eq("entryBarrierReview", "BARRIER_CONFIRMED")),
    actionId: "CASE19-B2", targetType: "ENTRY_FORMAT", ownerRole: "COMMUNITY_MANAGER",
    observation: "The declared social purpose has an explicitly confirmed entry barrier.", reason: "This review depends on the purpose and barrier checklist, not unrelated missing viewing observations.", action: "Have the manager review one optional low-pressure entry format.", caution: "Keep participation optional; no personal score, pressure message, or automatic DM.", review: "Review voluntary feedback and the declared barrier checklist after a bounded trial.",
    ja: {observation: "交流用途で、参加の入口に障壁があると明示確認されています。", reason: "用途と障壁の確認を根拠にし、無関係な閲覧欠測には依存しません。", action: "運営担当者が負担の少ない任意参加の形式を一つ確認する案です。", caution: "参加は任意とし、個人スコア・圧力のある案内・自動DMは作りません。", review: "小さな試行後、任意の反応と同じ障壁チェック項目で見直します。"},
  },
  {
    number: 3, predicate: all(eq("authorizedAggregateViewing.sourceAvailable", false, "boolean"), eq("authorizedAggregateViewing.provided", "NOT_PROVIDED")),
    actionId: "CASE19-B3", targetType: "ANALYSIS_SCOPE", ownerRole: "COMMUNITY_MANAGER",
    observation: "The authorized aggregate viewing source is unavailable and viewing data is not provided.", reason: "The known source boundary limits what can be said about participation.", action: "Have the manager review an analysis scope limited to the observations actually available.", caution: "Source absence never means zero readers or no participation; no native Bot readership API is assumed.", review: "Review only when a genuinely authorized aggregate source is supplied.",
    ja: {observation: "認可された閲覧集計の情報源がなく、閲覧値は提供されていません。", reason: "既知の取得範囲に合わせて参加状況の説明を限定します。", action: "運営担当者が実際に観測できる集計に分析範囲を限る案です。", caution: "情報源なしを閲覧者ゼロや不参加とせず、Botの閲覧APIも仮定しません。", review: "認可された集計情報源が実際に提供された場合にだけ見直します。"},
  },
];

const leaves20: Leaf[] = [
  {
    number: 1, predicate: all(eq("channelType", "TEXT_CHAT"), eq("staffConfirmedBuriedDiscussion", "MULTIPLE_HELP_BURIED_CONFIRMED")),
    actionId: "CASE20-B1", targetType: "FORUM_PILOT", ownerRole: "COMMUNITY_MANAGER",
    observation: "Staff confirmed that multiple help discussions are buried in a text-chat channel.", reason: "A text-chat help bottleneck, rather than an already existing forum, is the forum-pilot entry condition.", action: "Have the manager review one limited forum pilot with a preserved fallback route.", caution: "Do not convert every channel, delete history, or assume current permission/capability exists.", review: "Review explicit navigation feedback and helper availability before expanding the pilot.",
    ja: {observation: "テキストチャットで複数の相談が埋もれることを担当者が確認しています。", reason: "既存フォーラムではなく、チャットの相談の詰まりを試行の入口にします。", action: "運営担当者が元の経路を残した小さなフォーラム試行を確認する案です。", caution: "全チャンネル変換や履歴削除はせず、現在の権限・機能も仮定しません。", review: "拡大前に明示的な導線の反応と対応者の状況を見直します。"},
  },
  {
    number: 2, predicate: all(eq("channelType", "FORUM"), any(inside("archiveState", ["OLDER_POST", "ARCHIVED"]), eq("locked", "LOCKED")), inside("explicitOutcome", ["NOT_SET", "UNSOLVED_CONFIRMED"])),
    actionId: "CASE20-B2", targetType: "FORUM_POST_STATE", ownerRole: "COMMUNITY_MANAGER",
    observation: "A forum post is old, archived, or locked without an explicitly confirmed solved outcome.", reason: "Inactivity and lock state describe storage/access, not resolution.", action: "Have the manager review keeping the recorded unresolved or unconfirmed outcome.", caution: "Do not transform age, archive, lock, or last-reply time into SOLVED.", review: "Review only after an explicit outcome update by an authorized actor.",
    ja: {observation: "フォーラム投稿が古い・アーカイブ済み・ロック中ですが、解決の明示はありません。", reason: "非活動やロックは保存・利用状態であり、解決を示しません。", action: "運営担当者が未解決または未確認の状態を維持する案です。", caution: "経過時間・アーカイブ・ロック・最終返信時刻を解決済みに変換しません。", review: "認可された担当者が結果を明示更新した場合にだけ見直します。"},
  },
  {
    number: 3, predicate: all(eq("channelType", "FORUM"), any(eq("staffConfirmedBuriedDiscussion", "MULTIPLE_HELP_BURIED_CONFIRMED"), all(eq("postingActivity", "LOW_CONFIRMED"), eq("roleAccessibility.visibilityTagComplexity", "PROBLEM_CONFIRMED")))),
    actionId: "CASE20-B3", targetType: "FORUM_NAVIGATION", ownerRole: "COMMUNITY_MANAGER",
    observation: "An existing forum has confirmed buried help or a confirmed visibility/tag navigation problem with low posting.", reason: "An existing forum needs a navigation/thread review rather than a new forum pilot.", action: "Have the manager review one visibility, tag, or thread-navigation improvement.", caution: "Low posting alone is insufficient and a forum does not replace available helpers.", review: "Review explicit navigation feedback under the same declared forum scope.",
    ja: {observation: "既存フォーラムで相談の埋没、または低投稿と導線・タグの問題が確認されています。", reason: "新たなフォーラム試行ではなく、既存の導線と投稿整理を確認します。", action: "運営担当者が閲覧範囲・タグ・投稿導線の改善を一つ確認する案です。", caution: "投稿数だけでは判断せず、フォーラムを対応者の代わりにしません。", review: "同じフォーラム範囲で明示的な導線の反応を見直します。"},
  },
  {
    number: 4, predicate: all(eq("channelType", "TEXT_CHAT"), eq("explicitTags.state", "DECLARED"), eq("explicitTags.containsCasualChat", true, "boolean"), eq("explicitOutcome", "PURPOSE_ACHIEVED_CONFIRMED")),
    actionId: "CASE20-B4", targetType: "TEXT_CHAT", ownerRole: "COMMUNITY_MANAGER",
    observation: "Explicit casual-chat tags and a confirmed achieved purpose describe the text-chat channel.", reason: "A channel serving its stated casual purpose does not require forum conversion.", action: "Have the manager review retaining the existing text-chat route.", caution: "Do not generalize that explicit outcome to other help requests or archived posts.", review: "Review if declared purpose, explicit outcome, or a confirmed buried-help problem changes.",
    ja: {observation: "テキストチャットに明示的な雑談タグがあり、目的達成が確認されています。", reason: "意図した雑談用途を果たす経路にフォーラム変換を要求しません。", action: "運営担当者が現在のテキストチャット経路を維持する案です。", caution: "この明示結果を他の相談や古い投稿へ一般化しません。", review: "用途・明示結果・相談埋没の確認が変わった際に見直します。"},
  },
];

const referenceUrls: Record<number, string[]> = {
  13: ["https://discord.com/safety/creating-moderation-team-channels"],
  14: ["https://discord.com/safety/understanding-and-avoiding-moderator-burnout"],
  15: ["https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ"],
  16: ["https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101"],
  17: ["https://discord.com/safety/confidentiality-in-moderation"],
  18: ["https://support.discord.com/hc/en-us/articles/211866427-How-do-I-upload-images-and-GIFs", "https://discord.com/blog/improving-app-accessibility-a11y-updates"],
  19: ["https://discord.com/blog/fostering-a-thriving-partner-worthy-community-on-discord"],
  20: ["https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ"],
};
const reportedPractices: Record<number, string> = {
  13: "Official guidance describes private staff spaces, separation of noisy logging from actionable coordination, and avoiding unnecessary channel hierarchies.",
  14: "Official guidance recommends voluntary availability, breaks, shared duties, rotation and clear expectations; it does not diagnose wellbeing from activity.",
  15: "Official documentation describes configurable rules, exemptions, alerts and language support; some external filters use machine learning.",
  16: "Official guidance describes preparation, authorized incident response, and reviewing temporary restrictions after an incident; no universal join-rate boundary is given.",
  17: "Official guidance describes confidentiality, limiting unnecessary access and balancing transparency with privacy.",
  18: "Official product/accessibility guidance describes image descriptions, meaningful text alternatives and text routes in voice contexts.",
  19: "Historical official guidance treats reading as participation and describes optional entry routes; old program requirements are not generic health thresholds.",
  20: "Official forum documentation describes tags, guidelines, gradual rollout and inactivity-based older posts; inactivity does not establish resolution.",
};

export const CASE_PROVENANCE_13_20: Record<string, CaseReference[]> = Object.fromEntries(
  Object.entries(referenceUrls).map(([number, urls]) => [`CASE${number}`, urls.flatMap((url, index): CaseReference[] => [
    {
      id: `CASE${number}.guidance.${index + 1}`, url, checkedOn: "2026-10-16",
      provenance: "OFFICIAL_GUIDANCE", claimType: "GUIDANCE",
      reportedPractice: reportedPractices[Number(number)]!, effectMeasurement: "NOT_REPORTED",
    },
    {
      id: `CASE${number}.design.${index + 1}`, url, checkedOn: "2026-10-16",
      provenance: "DESIGN_INFERENCE", claimType: "DESIGN_MAPPING",
      reportedPractice: "NEXUS typed conditions, branch ordering and bounded review actions are design inferences; source guidance does not prove causal effects or operational thresholds.",
      effectMeasurement: "NOT_REPORTED",
    },
  ])]),
);

/** Map semantic leaf targets to the existing bounded platform target registry.
 * Target IDs, live revisions and source scope remain those of the input context. */
export const CANONICAL_TARGETS_13_20: Record<number, Record<number, string>> = {
  13: {1: "MODERATION_QUEUE", 2: "MODERATION_QUEUE", 3: "MODERATION_QUEUE", 4: "MODERATION_QUEUE"},
  14: {1: "DUTY_BUCKET", 2: "DUTY_BUCKET", 3: "DUTY_BUCKET", 4: "DUTY_BUCKET"},
  15: {1: "FILTER", 2: "FILTER", 3: "FILTER", 4: "FILTER"},
  16: {1: "GUILD", 2: "GUILD", 3: "GUILD", 4: "GUILD"},
  17: {1: "PERMISSION", 2: "ANNOUNCEMENT", 3: "SOURCE", 4: "CHANNEL"},
  18: {1: "ACCESSIBILITY", 2: "ACCESSIBILITY", 3: "ACCESSIBILITY", 4: "ACCESSIBILITY"},
  19: {1: "CHANNEL", 2: "CHANNEL", 3: "CHANNEL", 4: "CHANNEL"},
  20: {1: "CHANNEL", 2: "FORUM", 3: "FORUM", 4: "CHANNEL"},
};

const makeCase = (caseNumber: keyof typeof sources, leaves: Leaf[]): CaseDefinition => {
  const caseId = `CASE${caseNumber}`;
  const branchId = (number: number) => `C${caseNumber}-B${number}`;
  const explanationId = (leaf: Leaf) => `${caseId}.${leaf.actionId}.explanation`;
  const actions: ActionDefinition[] = leaves.map((leaf) => ({
    id: leaf.actionId, targetType: CANONICAL_TARGETS_13_20[caseNumber]![leaf.number]!, mode: "REVIEW_ONLY",
    ownerRole: leaf.ownerRole, requiredPermissions: [permissionFor(caseNumber)],
    impact: "LOW", typedFields: {}, reviewCriteria: [leaf.review], explanationId: explanationId(leaf),
    ...ACTION_PRIORITY_13_20[leaf.actionId]!,
  }));
  const explanations: ExplanationTemplate[] = leaves.map((leaf) => {
    const en = {
      observation: leaf.observation, branchReason: leaf.reason,
      hypothesis: leaf.hypothesis ?? null, action: leaf.action, caution: leaf.caution,
      alternative: leaf.alternative ?? null, reviewCondition: leaf.review,
    };
    return {
      id: explanationId(leaf), version: REVISION, ...en,
      translations: {
        en,
        ja: {
          observation: leaf.ja.observation, branchReason: leaf.ja.reason,
          hypothesis: null, action: leaf.ja.action, caution: leaf.ja.caution,
          alternative: null, reviewCondition: leaf.ja.review,
        },
      },
    };
  });
  const branches: BranchNode[] = leaves.map((leaf, index) => ({
    id: branchId(leaf.number), predicate: leaf.predicate,
    trueNext: terminal("ACTION", `${branchId(leaf.number)}_MATCHED`, leaf.actionId),
    falseNext: leaves[index + 1] ? {branchId: branchId(leaves[index + 1]!.number)} : terminal("NO_ACTION", "NO_MATCH"),
    unknownNext: terminal("INELIGIBLE", "INPUT_UNKNOWN"), priority: index + 1,
  }));
  return {
    id: caseId, revision: REVISION, rootTriggers: ["AUTHORIZED_OPERATIONAL_CONTEXT"],
    entryBranchId: branches[0]!.id, fields: CASE_FIELDS_13_20[caseId]!,
    branches, actions, explanations, provenance: CASE_PROVENANCE_13_20[caseId]!,
    sourceMappings: [sources[caseNumber]],
    ...(caseNumber <= 17 ? {requiredAudience: "RESTRICTED_STAFF" as const} : {}),
  };
};

export const CASES_13_20: CaseDefinition[] = [
  makeCase(13, leaves13), makeCase(14, leaves14), makeCase(15, leaves15), makeCase(16, leaves16),
  makeCase(17, leaves17), makeCase(18, leaves18), makeCase(19, leaves19), makeCase(20, leaves20),
].map(bindOperationalCaseSources);
for (const definition of CASES_13_20) CASE_FIELDS_13_20[definition.id] = definition.fields;
export const ACTIONS_13_20 = CASES_13_20.flatMap((definition) => definition.actions);
export const EXPLANATIONS_13_20 = CASES_13_20.flatMap((definition) => definition.explanations);
