/** Synthetic acceptance inputs only; these are neither production defaults nor results. */
import type { CaseFixture, CaseValue, DecisionContext, EvaluationProfile, FieldDefinition } from "../../packages/rules/src/case-types";
import { CASES_13_20, deriveDutyConcentration, deriveFilterReview } from "../../packages/rules/src/cases-13-20";

export const CASE_AS_OF_13_20 = "2026-10-15T12:00:00Z";
const window = {start: "2026-10-14T12:00:00Z", end: CASE_AS_OF_13_20};
const concentration = deriveDutyConcentration([
  {bucketKind: "ROLE", bucketRef: "moderation", openAssignments: 5},
  {bucketKind: "DUTY", bucketRef: "support", openAssignments: 5},
]);
const review = deriveFilterReview({reviewSetRef: "review-R17-v3", staffFpCount: 5, totalReviewed: 30, triggeredRuleIds: ["R17"]});

export const CASE_BASELINES_13_20: Record<string, Record<string, CaseValue>> = {
  CASE13: {queueType: "MODERATION_ACTION", visibility: "PRIVATE_RESTRICTED", actionableCount: 4, noiseCount: 6, actionableNoiseMixState: "NO_MIX_CONFIRMED", caseOwnershipState: "ASSIGNED", teamOperatingScale: "STANDARD", allowedAudience: "MOD_ONLY", observationState: "CONFIGURED_REVIEWED"},
  CASE14: {availabilityState: "AVAILABLE", coverageAdjustmentRequest: "NONE", queueLoadCount: 12, oldestOpenQueueAgeMinutes: 45, assignmentConcentrationState: concentration.state, assignmentConcentrationNumerator: concentration.numerator, assignmentConcentrationDenominator: concentration.denominator, responsibilityClarity: "CLEAR"},
  CASE15: {ruleId: "R17", ruleVersion: 3, reviewSetRef: review.reviewSetRef, staffFpCount: review.staffFpCount, totalReviewed: review.totalReviewed, triggeredRuleCount: review.triggeredRuleCount, configuredLanguage: "en", featureSupportCheck: "CONFIRMED_SUPPORTED", reviewState: "REVIEWED"},
  CASE16: {plannedCampaign: "PLANNED", staffConfirmedIncident: "NONE_CONFIRMED", confirmedDisruption: "NONE_CONFIRMED", platformAlertType: "NONE", temporaryRestrictionState: "NONE", incidentResolvedAt: null},
  CASE17: {"reportChannel.expectedPermission": "RESTRICTED", "reportChannel.actualPermission": "RESTRICTED", staffConfirmedRedactionReview: "NO_PRIVACY_FINDING_CONFIRMED", "retentionConfiguration.logScope": "CASE_RESTRICTED", aggregateCaseStatus: "OPEN"},
  CASE18: {contentChecklist: "OTHER", descriptionPresence: "PRESENT", textCompanion: "PRESENT", essentialInfoTextEquivalentState: "PRESENT_CONFIRMED", barrierReport: "NONE_REPORTED"},
  CASE19: {adminPurpose: "SOCIAL", "authorizedAggregateViewing.provided": "PROVIDED", "authorizedAggregateViewing.stabilityReview": "NOT_STABLE_CONFIRMED", "authorizedAggregateViewing.sourceAvailable": true, postingAggregate: "OBSERVED", optionalFeedback: "NONE_REPORTED", entryBarrierReview: "NO_BARRIER_CONFIRMED", urgentTaskClarity: "CLEAR_CONFIRMED"},
  CASE20: {channelType: "FORUM", "explicitTags.state": "NOT_SET", "explicitTags.containsCasualChat": false, explicitOutcome: "NOT_SET", lastReplyAt: CASE_AS_OF_13_20, archiveState: "ACTIVE", locked: "UNLOCKED", staffConfirmedBuriedDiscussion: "NOT_BURIED_CONFIRMED", postingActivity: "REGULAR_CONFIRMED", "roleAccessibility.visibilityTagComplexity": "NO_PROBLEM_CONFIRMED"},
};

export const CASE_FIXTURE_PROFILE_13_20: EvaluationProfile = {
  id: "SYNTHETIC-CASE13-20", revision: "fixture-v1", kind: "SYNTHETIC_FIXTURE",
  approved: false, retentionApproved: false,
  budget: {maxDepth: 16, maxSteps: 16, maxOperations: 256, maxInputs: 128},
  values: {
    queueAgeThresholdMinutes: {value: 120, unit: "minutes"},
    assignmentConcentrationThreshold: {value: 0.8, unit: "ratio"},
    minReviewedN: {value: 20, unit: "count"}, fpRateThreshold: {value: 0.2, unit: "ratio"},
  },
  metricConfigs: {},
};

interface Vector {
  id: string; caseId: string; delta: Record<string, CaseValue>; path: string[];
  actionId: string | null; targetType: string;
  outcome?: CaseFixture["expected"]["outcome"]; reasonCode?: string;
  mutate?: (fixture: CaseFixture) => void;
}

const fixtureTargetTypes: Record<string, Record<string, string>> = {
  CASE13: {REPORT_QUEUE: "MODERATION_QUEUE", MODERATION_QUEUE: "MODERATION_QUEUE", QUEUE_OWNERSHIP: "MODERATION_QUEUE"},
  CASE14: {DUTY_ROTA: "DUTY_BUCKET", MODERATION_QUEUE: "DUTY_BUCKET", DUTY_ASSIGNMENT_MAP: "DUTY_BUCKET", STAFF_RESPONSIBILITY: "DUTY_BUCKET"},
  CASE15: {MODERATION_FILTER: "FILTER", MODERATION_FILTER_SET: "FILTER", MODERATION_FILTER_REVIEW: "FILTER"},
  CASE16: {GUILD_SECURITY: "GUILD", RESTRICTED_SAFETY_REVIEW: "GUILD", CAMPAIGN_CONTEXT: "GUILD"},
  CASE17: {REPORT_CHANNEL: "PERMISSION", PUBLIC_SUMMARY: "ANNOUNCEMENT", RETENTION_LOG: "SOURCE", PUBLIC_FEEDBACK_ROUTE: "CHANNEL"},
  CASE18: {CONTENT_ITEM: "ACCESSIBILITY", VOICE_EVENT: "ACCESSIBILITY", ACCESSIBILITY_BARRIER: "ACCESSIBILITY"},
  CASE19: {RESOURCE_CHANNEL_GUIDANCE: "CHANNEL", ENTRY_FORMAT: "CHANNEL", ANALYSIS_SCOPE: "CHANNEL", TASK_GUIDANCE: "CHANNEL"},
  CASE20: {FORUM_PILOT: "CHANNEL", FORUM_POST_STATE: "FORUM", FORUM_NAVIGATION: "FORUM", TEXT_CHAT: "CHANNEL"},
};

const makeFixture = (vector: Vector): CaseFixture => {
  const definition = CASES_13_20.find((entry) => entry.id === vector.caseId)!;
  const values = {...CASE_BASELINES_13_20[vector.caseId], ...vector.delta};
  const target = {targetType: fixtureTargetTypes[vector.caseId]![vector.targetType]!, targetId: `${vector.caseId}.target`, liveVersion: "live-v3"};
  const permissions = ["READ", "ANALYZE", "OPERATE", "CONFIGURE", "GOVERN"];
  const fields = Object.fromEntries(definition.fields.map((field: FieldDefinition) => [field.id, {
    observationId: `${vector.caseId}.${field.id}.v1`, value: values[field.id]!, quality: "SUFFICIENT" as const,
    unit: field.unit, sourceId: field.sourceId, sourceKind: "SYSTEM_OBSERVATION" as const, sourceRevision: "source-v1",
    observedAt: "2026-10-15T11:59:00Z", expiresAt: "2026-10-15T18:00:00Z",
    authorityScope: {guildId: "321111111111111111", targetType: target.targetType, targetId: target.targetId, liveVersion: target.liveVersion, permissions: [...permissions]},
    periodRole: "CONTEXT" as const, window: {...window},
  }]));
  const context: DecisionContext = {
    contextId: `${vector.id}.context`, guildId: "321111111111111111", evaluationAsOf: CASE_AS_OF_13_20,
    target, rootTrigger: {kind: "AUTHORIZED_OPERATIONAL_CONTEXT", sourceId: definition.sourceMappings[0]!.id},
    fields, sourceHealth: definition.sourceMappings.map((source) => ({
      observationId: `${vector.caseId}.health.${source.id}`, sourceId: source.id, revision: "source-v1", quality: "SUFFICIENT",
      authorized: true, observedAt: "2026-10-15T11:59:00Z", expiresAt: "2026-10-15T18:00:00Z",
    })), permissions,
    versions: {catalog: definition.revision, rule: "operational-context-v1", engine: "case-engine-v1", config: "fixture-v1", schema: "case-schema-v1", branch: definition.revision, action: definition.revision, explanation: definition.revision},
    window: {...window}, scopeActive: true, tombstoned: false, cancelled: false, evaluationComplete: true,
    deadlineAt: "2026-10-15T12:05:00Z", audience: definition.requiredAudience ?? "GUILD_AUTHORIZED",
  };
  const fixture: CaseFixture = {
    id: vector.id, caseId: vector.caseId, baselineId: `B${vector.caseId.slice(4)}-integrated-v1`, changes: Object.keys(vector.delta),
    context, profile: structuredClone(CASE_FIXTURE_PROFILE_13_20),
    registry: {version: "synthetic-registered-context-v1", sources: definition.sourceMappings.map((source) => ({...source, confirmed: true})), targetTypes: [...new Set(definition.actions.map((action) => action.targetType))]},
    expected: {
      branchPath: vector.path, outcome: vector.outcome ?? (vector.actionId ? "ACTION" : "NO_ACTION"),
      reasonCode: vector.reasonCode ?? (vector.actionId ? `${vector.path.at(-1)}_MATCHED` : "NO_MATCH"),
      actionId: vector.actionId, mode: vector.actionId ? "REVIEW_ONLY" : null,
      explanationId: vector.actionId ? `${vector.caseId}.${vector.actionId}.explanation` : null,
    },
  };
  // Explicit synthetic elapsed seconds only; never a production threshold or
  // an automatic conversion of a base Rule's calendar cooldown.
  fixture.profile.values[`${vector.caseId}.cooldownSeconds`] = {value: 60, unit: "seconds"};
  vector.mutate?.(fixture);
  return fixture;
};

const vectors: Vector[] = [
  {id: "IV-D13-F01", caseId: "CASE13", delta: {queueType: "REPORT", visibility: "PUBLIC"}, path: ["C13-B1"], actionId: "REVIEW_ONLY_REPORT_PRIVACY_SCOPE", targetType: "REPORT_QUEUE"},
  {id: "IV-D13-F02", caseId: "CASE13", delta: {actionableNoiseMixState: "MIX_CONFIRMED"}, path: ["C13-B1", "C13-B2"], actionId: "REVIEW_ONLY_RESTRICTED_TRIAGE", targetType: "MODERATION_QUEUE"},
  {id: "IV-D13-F03", caseId: "CASE13", delta: {caseOwnershipState: "UNASSIGNED"}, path: ["C13-B1", "C13-B2", "C13-B3"], actionId: "REVIEW_ONLY_OWNERSHIP_HANDOFF", targetType: "QUEUE_OWNERSHIP"},
  {id: "IV-D13-F04", caseId: "CASE13", delta: {teamOperatingScale: "SMALL"}, path: ["C13-B1", "C13-B2", "C13-B3", "C13-B4"], actionId: "REVIEW_ONLY_SINGLE_QUEUE", targetType: "MODERATION_QUEUE"},
  {id: "IV-D14-F01", caseId: "CASE14", delta: {availabilityState: "PAUSED"}, path: ["C14-B1"], actionId: "REVIEW_ONLY_COVERAGE_HANDOFF", targetType: "DUTY_ROTA"},
  {id: "IV-D14-F02", caseId: "CASE14", delta: {availabilityState: "REDUCED", oldestOpenQueueAgeMinutes: 120}, path: ["C14-B1", "C14-B2"], actionId: "REVIEW_ONLY_LOAD_REBALANCE", targetType: "MODERATION_QUEUE"},
  {id: "IV-D14-F03", caseId: "CASE14", delta: {assignmentConcentrationNumerator: 8, assignmentConcentrationDenominator: 10}, path: ["C14-B1", "C14-B2", "C14-B3"], actionId: "REVIEW_ONLY_BACKUP_COVERAGE", targetType: "DUTY_ASSIGNMENT_MAP"},
  {id: "IV-D14-F04", caseId: "CASE14", delta: {responsibilityClarity: "UNCLEAR"}, path: ["C14-B1", "C14-B2", "C14-B3", "C14-B4"], actionId: "REVIEW_ONLY_RESPONSIBILITY_CLARIFY", targetType: "STAFF_RESPONSIBILITY"},
  {id: "IV-D15-F01", caseId: "CASE15", delta: {featureSupportCheck: "CONFIRMED_UNSUPPORTED"}, path: ["C15-B1"], actionId: "REVIEW_ONLY_FEATURE_COMPATIBILITY", targetType: "MODERATION_FILTER"},
  {id: "IV-D15-F02", caseId: "CASE15", delta: {staffFpCount: 6}, path: ["C15-B1", "C15-B2"], actionId: "REVIEW_ONLY_NARROW_MATCHING", targetType: "MODERATION_FILTER"},
  {id: "IV-D15-F03", caseId: "CASE15", delta: {triggeredRuleCount: 2}, path: ["C15-B1", "C15-B2", "C15-B3"], actionId: "REVIEW_ONLY_TRIGGER_BREAKDOWN", targetType: "MODERATION_FILTER_SET"},
  {id: "IV-D15-F04", caseId: "CASE15", delta: {totalReviewed: 10}, path: ["C15-B1", "C15-B2", "C15-B3", "C15-B4"], actionId: "REVIEW_ONLY_REVIEW_DATA_GAP", targetType: "MODERATION_FILTER_REVIEW"},
  {id: "IV-D16-F01", caseId: "CASE16", delta: {staffConfirmedIncident: "ACTIVE"}, path: ["C16-B1"], actionId: "REVIEW_ONLY_RESTRICTED_INCIDENT", targetType: "GUILD_SECURITY"},
  {id: "IV-D16-F02", caseId: "CASE16", delta: {staffConfirmedIncident: "RESOLVED", temporaryRestrictionState: "ACTIVE", incidentResolvedAt: "2026-10-15T10:00:00Z"}, path: ["C16-B1", "C16-B4", "C16-B2"], actionId: "REVIEW_ONLY_RESTRICTION_RECOVERY", targetType: "GUILD_SECURITY"},
  {id: "IV-D16-F03", caseId: "CASE16", delta: {}, path: ["C16-B1", "C16-B4", "C16-B2", "C16-B3"], actionId: "REVIEW_ONLY_CAMPAIGN_CAPACITY", targetType: "CAMPAIGN_CONTEXT"},
  {id: "IV-D16-F04", caseId: "CASE16", delta: {platformAlertType: "RAID_ALERT"}, path: ["C16-B1", "C16-B4"], actionId: "REVIEW_ONLY_INCIDENT_CONFIRMATION", targetType: "RESTRICTED_SAFETY_REVIEW"},
  {id: "IV-E17-F01", caseId: "CASE17", delta: {"reportChannel.actualPermission": "PUBLIC"}, path: ["C17-B1"], actionId: "CASE17-B1", targetType: "REPORT_CHANNEL"},
  {id: "IV-E17-F02", caseId: "CASE17", delta: {staffConfirmedRedactionReview: "PUBLIC_SUMMARY_PII_CONFIRMED"}, path: ["C17-B1", "C17-B2"], actionId: "CASE17-B2", targetType: "PUBLIC_SUMMARY"},
  {id: "IV-E17-F03", caseId: "CASE17", delta: {"retentionConfiguration.logScope": "BROAD_LOG", staffConfirmedRedactionReview: "BROAD_LOG_SENSITIVE_DATA_CONFIRMED"}, path: ["C17-B1", "C17-B2", "C17-B3"], actionId: "CASE17-B3", targetType: "RETENTION_LOG"},
  {id: "IV-E17-F04", caseId: "CASE17", delta: {"reportChannel.expectedPermission": "PUBLIC", "reportChannel.actualPermission": "PUBLIC"}, path: ["C17-B1", "C17-B2", "C17-B3", "C17-B4"], actionId: "CASE17-B4", targetType: "PUBLIC_FEEDBACK_ROUTE"},
  {id: "IV-E18-F01", caseId: "CASE18", delta: {contentChecklist: "IMPORTANT_IMAGE", descriptionPresence: "ABSENT", textCompanion: "ABSENT", essentialInfoTextEquivalentState: "MISSING_CONFIRMED"}, path: ["C18-B4", "C18-B1"], actionId: "CASE18-B1", targetType: "CONTENT_ITEM"},
  {id: "IV-E18-F02", caseId: "CASE18", delta: {contentChecklist: "VOICE_EVENT", textCompanion: "ABSENT"}, path: ["C18-B4", "C18-B1", "C18-B2"], actionId: "CASE18-B2", targetType: "VOICE_EVENT"},
  {id: "IV-E18-F03", caseId: "CASE18", delta: {contentChecklist: "DECORATIVE_IMAGE", textCompanion: "EQUIVALENT_ADJACENT"}, path: ["C18-B4", "C18-B1", "C18-B2", "C18-B3"], actionId: "CASE18-B3", targetType: "CONTENT_ITEM"},
  {id: "IV-E18-F04", caseId: "CASE18", delta: {barrierReport: "REPORTED"}, path: ["C18-B4"], actionId: "CASE18-B4", targetType: "ACCESSIBILITY_BARRIER"},
  {id: "IV-E19-F01", caseId: "CASE19", delta: {adminPurpose: "RESOURCE", "authorizedAggregateViewing.stabilityReview": "STABLE_CONFIRMED"}, path: ["C19-B4", "C19-B1"], actionId: "CASE19-B1", targetType: "RESOURCE_CHANNEL_GUIDANCE"},
  {id: "IV-E19-F02", caseId: "CASE19", delta: {entryBarrierReview: "BARRIER_CONFIRMED"}, path: ["C19-B4", "C19-B1", "C19-B2"], actionId: "CASE19-B2", targetType: "ENTRY_FORMAT"},
  {id: "IV-E19-F03", caseId: "CASE19", delta: {"authorizedAggregateViewing.sourceAvailable": false, "authorizedAggregateViewing.provided": "NOT_PROVIDED"}, path: ["C19-B4", "C19-B1", "C19-B2", "C19-B3"], actionId: "CASE19-B3", targetType: "ANALYSIS_SCOPE"},
  {id: "IV-E19-F04", caseId: "CASE19", delta: {urgentTaskClarity: "UNCLEAR_CONFIRMED"}, path: ["C19-B4"], actionId: "CASE19-B4", targetType: "TASK_GUIDANCE"},
  {id: "IV-E20-F01", caseId: "CASE20", delta: {channelType: "TEXT_CHAT", staffConfirmedBuriedDiscussion: "MULTIPLE_HELP_BURIED_CONFIRMED"}, path: ["C20-B1"], actionId: "CASE20-B1", targetType: "FORUM_PILOT"},
  {id: "IV-E20-F02", caseId: "CASE20", delta: {archiveState: "ARCHIVED"}, path: ["C20-B1", "C20-B2"], actionId: "CASE20-B2", targetType: "FORUM_POST_STATE"},
  {id: "IV-E20-F03", caseId: "CASE20", delta: {postingActivity: "LOW_CONFIRMED", "roleAccessibility.visibilityTagComplexity": "PROBLEM_CONFIRMED"}, path: ["C20-B1", "C20-B2", "C20-B3"], actionId: "CASE20-B3", targetType: "FORUM_NAVIGATION"},
  {id: "IV-E20-F04", caseId: "CASE20", delta: {channelType: "TEXT_CHAT", "explicitTags.state": "DECLARED", "explicitTags.containsCasualChat": true, explicitOutcome: "PURPOSE_ACHIEVED_CONFIRMED"}, path: ["C20-B1", "C20-B2", "C20-B3", "C20-B4"], actionId: "CASE20-B4", targetType: "TEXT_CHAT"},
];

export const CASE_BRANCH_FIXTURES_13_20 = vectors.map(makeFixture);

const primaryIds = ["IV-D13-F01", "IV-D14-F01", "IV-D15-F01", "IV-D16-F01", "IV-E17-F01", "IV-E18-F04", "IV-E19-F04", "IV-E20-F01"];
const firstFields = ["visibility", "availabilityState", "featureSupportCheck", "staffConfirmedIncident", "reportChannel.expectedPermission", "barrierReport", "urgentTaskClarity", "channelType"];
export const CASE_SAFETY_FIXTURES_13_20: CaseFixture[] = primaryIds.flatMap((id, index) => {
  const vector = vectors.find((item) => item.id === id)!;
  const variants: {suffix: string; reason: string; path: string[]; outcome?: CaseFixture["expected"]["outcome"]; mutate: (fixture: CaseFixture) => void}[] = [
    {suffix: "UNKNOWN", reason: "INPUT_UNKNOWN", path: vector.path, mutate: (fixture) => { delete fixture.context.fields[firstFields[index]!]; }},
    {suffix: "STALE", reason: "INPUT_QUALITY", path: vector.path, mutate: (fixture) => { fixture.context.fields[firstFields[index]!]!.quality = "STALE"; }},
    {suffix: "EXPIRED", reason: "INPUT_UNKNOWN", path: vector.path, mutate: (fixture) => {fixture.context.fields[firstFields[index]!]!.expiresAt = fixture.context.evaluationAsOf; }},
    {suffix: "LIVE-VERSION", reason: "OBSERVATION_SCOPE_MISMATCH", path: [vector.path[0]!], mutate: (fixture) => {fixture.context.target.liveVersion = "changed-live-v4"; }},
    {suffix: "PERMISSION", reason: "PERMISSION_REVOKED", path: [vector.path[0]!], mutate: (fixture) => {fixture.context.permissions = []; }},
    {suffix: "TOMBSTONE", reason: "TOMBSTONED", path: [], mutate: (fixture) => {fixture.context.tombstoned = true; }},
    {suffix: "CANCELLED", reason: "CANCELLED", path: [], mutate: (fixture) => {fixture.context.cancelled = true; }},
    {suffix: "INCOMPLETE", reason: "EVALUATION_INCOMPLETE", path: [], mutate: (fixture) => {fixture.context.evaluationComplete = false; }},
    {suffix: "BUDGET", reason: "CASE_BUDGET_EXCEEDED", path: [vector.path[0]!], mutate: (fixture) => {fixture.profile.budget.maxSteps = 1; }},
    {suffix: "RETENTION", reason: "APPROVAL_REQUIRED", path: [], outcome: "DISABLED", mutate: (fixture) => {fixture.profile.kind = "OPERATIONAL"; fixture.profile.approved = true; fixture.profile.retentionApproved = false; }},
    {suffix: "SOURCE", reason: "SOURCE_DISABLED", path: [vector.path[0]!], outcome: "DISABLED", mutate: (fixture) => {fixture.registry.sources.forEach((entry) => {entry.confirmed = false; }); }},
  ];
  return variants.map((variant) => makeFixture({
    ...(variant.suffix === "BUDGET" ? vectors.find((entry) => entry.caseId === vector.caseId && entry.id.endsWith("F02"))! : vector),
    id: `${vector.caseId}-${variant.suffix}`, path: variant.path,
    actionId: null, outcome: variant.outcome ?? "INELIGIBLE", reasonCode: variant.reason,
    mutate: variant.mutate,
  }));
});

export const CASE_EDGE_FIXTURES_13_20: CaseFixture[] = [
  makeFixture({id: "C13-NO-MIX", caseId: "CASE13", delta: {}, path: ["C13-B1", "C13-B2", "C13-B3", "C13-B4"], actionId: null, targetType: "MODERATION_QUEUE"}),
  makeFixture({id: "C14-AGE-BELOW", caseId: "CASE14", delta: {availabilityState: "REDUCED", oldestOpenQueueAgeMinutes: 119}, path: ["C14-B1", "C14-B2", "C14-B3", "C14-B4"], actionId: null, targetType: "MODERATION_QUEUE"}),
  makeFixture({id: "C14-ZERO-ASSIGNMENTS", caseId: "CASE14", delta: {assignmentConcentrationState: "UNDEFINED", assignmentConcentrationNumerator: 0, assignmentConcentrationDenominator: 0}, path: ["C14-B1", "C14-B2", "C14-B3", "C14-B4"], actionId: null, targetType: "DUTY_ASSIGNMENT_MAP"}),
  makeFixture({id: "C15-RATE-BELOW", caseId: "CASE15", delta: {}, path: ["C15-B1", "C15-B2", "C15-B3", "C15-B4"], actionId: null, targetType: "MODERATION_FILTER"}),
  makeFixture({id: "C15-ZERO-REVIEW", caseId: "CASE15", delta: {staffFpCount: 0, totalReviewed: 0, triggeredRuleCount: 0}, path: ["C15-B1", "C15-B2", "C15-B3", "C15-B4"], actionId: "REVIEW_ONLY_REVIEW_DATA_GAP", targetType: "MODERATION_FILTER_REVIEW"}),
  makeFixture({id: "C16-SAFETY-ALERT", caseId: "CASE16", delta: {platformAlertType: "SAFETY_ALERT", staffConfirmedIncident: "UNREVIEWED"}, path: ["C16-B1", "C16-B4"], actionId: "REVIEW_ONLY_INCIDENT_CONFIRMATION", targetType: "RESTRICTED_SAFETY_REVIEW"}),
  makeFixture({id: "C16-UNREVIEWED-NO-ALERT", caseId: "CASE16", delta: {platformAlertType: "NONE", staffConfirmedIncident: "UNREVIEWED"}, path: ["C16-B1", "C16-B4"], actionId: "REVIEW_ONLY_INCIDENT_CONFIRMATION", targetType: "RESTRICTED_SAFETY_REVIEW"}),
  makeFixture({id: "C18-DESCRIPTION-NOT-EQUIVALENCE", caseId: "CASE18", delta: {contentChecklist: "IMPORTANT_IMAGE", descriptionPresence: "PRESENT", essentialInfoTextEquivalentState: "MISSING_CONFIRMED"}, path: ["C18-B4", "C18-B1"], actionId: "CASE18-B1", targetType: "CONTENT_ITEM"}),
  makeFixture({id: "C18-BARRIER-BEFORE-DECORATION", caseId: "CASE18", delta: {contentChecklist: "DECORATIVE_IMAGE", textCompanion: "EQUIVALENT_ADJACENT", barrierReport: "REPORTED"}, path: ["C18-B4"], actionId: "CASE18-B4", targetType: "ACCESSIBILITY_BARRIER"}),
  makeFixture({id: "C19-URGENT-BEFORE-RESOURCE", caseId: "CASE19", delta: {adminPurpose: "RESOURCE", "authorizedAggregateViewing.stabilityReview": "STABLE_CONFIRMED", urgentTaskClarity: "UNCLEAR_CONFIRMED"}, path: ["C19-B4"], actionId: "CASE19-B4", targetType: "TASK_GUIDANCE"}),
  makeFixture({id: "C19-ENTRY-INDEPENDENT-VIEWING", caseId: "CASE19", delta: {entryBarrierReview: "BARRIER_CONFIRMED"}, path: ["C19-B4", "C19-B1", "C19-B2"], actionId: "CASE19-B2", targetType: "ENTRY_FORMAT", mutate: (fixture) => {for (const [key, observation] of Object.entries(fixture.context.fields)) if (key.startsWith("authorizedAggregateViewing.")) {observation.value = null; observation.quality = "MISSING"; }}}),
  makeFixture({id: "C20-EXISTING-FORUM-NAVIGATION", caseId: "CASE20", delta: {staffConfirmedBuriedDiscussion: "MULTIPLE_HELP_BURIED_CONFIRMED"}, path: ["C20-B1", "C20-B2", "C20-B3"], actionId: "CASE20-B3", targetType: "FORUM_NAVIGATION"}),
  makeFixture({id: "C20-LOCK-IS-NOT-SOLVED", caseId: "CASE20", delta: {locked: "LOCKED"}, path: ["C20-B1", "C20-B2"], actionId: "CASE20-B2", targetType: "FORUM_POST_STATE"}),
];

export const CASE_FIXTURES_13_20: CaseFixture[] = [
  ...CASE_BRANCH_FIXTURES_13_20, ...CASE_SAFETY_FIXTURES_13_20, ...CASE_EDGE_FIXTURES_13_20,
];
