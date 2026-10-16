/** Synthetic complete vectors. No operational approval or production source. */
import {CASES_01_12} from "../../packages/rules/src/cases-01-12";
import type {CaseFixture, CaseValue, DecisionContext, EvaluationProfile, Observation} from "../../packages/rules/src/case-types";

export const CASE_FIXTURE_AS_OF = "2026-10-15T12:00:00.000000Z";
const current = {start: "2026-10-08T12:00:00.000000Z", end: CASE_FIXTURE_AS_OF};
const prior = {start: "2026-10-01T12:00:00.000000Z", end: current.start};
const point = (numerator: number) => ({numerator, denominator: 10, coverage: 1});
const baselines: Record<string, Record<string, CaseValue>> = {
  CASE01: {"onb.expectedAccess": "ALLOWED", "onb.actualAccess": "ALLOWED", "onb.adminFriction": "NONE", "onb.visibilityState": "VISIBLE_TO_EXISTING", "onb.previewState": "PASS"},
  CASE02: {"welcome.channelPurpose": "INTRO", "welcome.noContact": false, "welcome.introRequired": false, "welcome.staffCoverageState": "IN", "welcome.humanStaffReplyCount": 1, "welcome.botReplyCount": 0, "welcome.nextDestinationConfigured": true},
  CASE03: {"support.askerOutcome": "OPEN", "support.intakeState": "READY", "support.coverageState": "IN", "support.topicClass": "GENERAL", "support.specialistAssigned": "YES", "support.unansweredAgeSeconds": 30},
  CASE04: {"support.askerExplicitOutcome": "CLEAR", "support.missingReproduction": "NO", "support.missingErrorContext": "NO", "support.problemState": "CONFIRMED", "support.sameTopicReopenCount": 0, "support.guideMappingState": "FOUND"},
  CASE05: {"cohort.newCurrent": point(3), "cohort.newPrior": point(3), "cohort.establishedCurrent": point(8), "cohort.establishedPrior": point(8), "activity.optInInterest": "INSUFFICIENT", "activity.hostCapacity": "SUFFICIENT", "activity.communityPurpose": "COMMUNITY"},
  CASE06: {"event.scheduled": false, "event.coverageCapacity": "SUFFICIENT", "moderation.issueCategory": "NONE"},
  CASE07: {"format.comparableParticipationState": "STABLE_PURPOSE_ALIGNED", "format.preferredFormat": "CURRENT", "format.capacityState": "SUFFICIENT", "format.logisticsState": "NO_PROBLEM_CONFIRMED"},
  CASE08: {"activity.integrationErrorCount": 0, "activity.optInInterest": "INSUFFICIENT", "activity.hostCapacity": "SUFFICIENT", "activity.communityPurpose": "COMMUNITY"},
  CASE09: {"request.requestId": "R-CASE09", "request.status": "UNDER_REVIEW", "request.ownerAssigned": true, "request.ownerRoleId": "884222222222222222", "request.reviewDueAt": "2026-10-20T12:00:00Z", "request.duplicateOfRequestId": null, "request.canonicalRef": null},
  CASE10: {"channel.expectedAccess": "ALLOWED", "channel.actualAccess": "ALLOWED", "channel.nameIssue": "NONE", "channel.protectedUse": "NONE", "channel.seasonalState": "NONE", "channel.lifecycleState": "ESTABLISHED", "channel.purpose": "GENERAL", "channel.overlapStatus": "NONE", "channel.messageCount": 25},
  CASE11: {"event.accessBarrierState": "NOT_CONFIRMED", "event.optionalFeedback": "GOAL_MET", "event.purpose": "COMMUNITY_CONNECTION", "event.repeatPoint": point(8), "event.repeatSourceContract": "UNAVAILABLE", "event.ownedBy": "STAFF", "event.hostCapacity": "AVAILABLE"},
  CASE12: {"announcement.correctionFlag": false, "announcement.category": "ROUTINE_UPDATE", "announcement.mentionScope": "NONE", "announcement.mentionCount": 0, "announcement.canonicalRef": "REF-12", "announcement.missingInfoReport": "NONE", "announcement.publishState": "DRAFT", "announcement.audience": "INTERNAL"},
};
export const CASE_FIXTURE_PROFILE: EvaluationProfile = {
  id: "SYNTHETIC-CASES-01-12", revision: "fixture-v1", kind: "SYNTHETIC_FIXTURE", approved: false, retentionApproved: false,
  budget: {maxDepth: 16, maxSteps: 64, maxOperations: 256, maxInputs: 128},
  values: {"HELP-001.unansweredAgeSeconds": {value: 60, unit: "seconds"}, "CASE10.messageCountMax": {value: 10, unit: "count"}, "CASE11.repeatRateThreshold": {value: 0.5, unit: "ratio"}},
  metricConfigs: {"RETENTION.MATURED_PARTICIPATION": {revision: "fixture-ret-v1", minN: 10, minCoverage: 0.9}, "EVENT.DEDICATED_REPEAT_RATE": {revision: "fixture-repeat-v1", minN: 10, minCoverage: 0.9}},
};
export function caseFixture(caseId: string, suffix: string, values: Record<string, CaseValue>, names: string[], action: string | null, outcome: CaseFixture["expected"]["outcome"] = action ? "ACTION" : "NO_ACTION", reasonCode = names.at(-1) ?? "NO_MATCH"): CaseFixture {
  const definition = CASES_01_12.find(item => item.id === caseId)!;
  if (!definition) throw new Error("UNKNOWN_SYNTHETIC_CASE");
  const target = {targetType: definition.actions[0]?.targetType ?? "GUILD", targetId: caseId === "CASE09" ? "R-CASE09" : `${caseId}-TARGET`, liveVersion: "live-v1"};
  const fields: Record<string, Observation> = {};
  for (const field of definition.fields) {
    const name = field.observationField ?? field.id, value = Object.hasOwn(values, name) ? values[name]! : baselines[caseId]![name];
    if (value === undefined) throw new Error(`INCOMPLETE_SYNTHETIC_BASELINE:${caseId}:${name}`);
    const window = field.periodRole === "PRIOR" ? prior : current;
    fields[name] = {observationId: `${caseId}.${name}.${suffix}`, value: structuredClone(value), quality: "SUFFICIENT", unit: field.unit, sourceId: field.sourceId, sourceRevision: "source-v1", sourceKind:"SYSTEM_OBSERVATION", observedAt: "2026-10-15T11:59:00.000000Z", expiresAt: "2026-10-15T13:00:00.000000Z", authorityScope: {guildId: "884000000000000001", ...target, permissions: ["READ", "ANALYZE", "CONFIGURE", "OPERATE", "GOVERN"]}, periodRole: field.periodRole ?? "CONTEXT", window: {...window}, ...(field.metricId ? {metricId: field.metricId, cohort: {cohortId: `${caseId}-${field.cohortClass}-${field.periodRole}-${suffix}`, cohortClass: field.cohortClass!, cohortDefinitionVersion: "matured-cohort-v1", campaignClass: field.cohortClass === "NEW" ? "NEW_CAMPAIGN" : field.cohortClass === "EVENT" ? "EVENT_REPEAT" : "ESTABLISHED", maturityOffset: 7, maturityWindowSeconds: 604800, metricWindowSeconds: 604800,windowKind:"ELAPSED",timeZone:"UTC", joinWindow: {...window}, windowContractId: field.windowContractId}} : {})};
  }
  const context: DecisionContext = {contextId: `${caseId}.${suffix}`, guildId: "884000000000000001", evaluationAsOf: CASE_FIXTURE_AS_OF, target, rootTrigger: definition.rootTriggers[0] === "BASE_RULE_RESULT" ? {kind: "BASE_RULE_RESULT", ruleId: definition.baseRuleIds![0]!, outcome: "FIRE"} : {kind: "AUTHORIZED_OPERATIONAL_CONTEXT", sourceId: definition.sourceMappings[0]!.id}, fields, sourceHealth: definition.sourceMappings.map(source => ({observationId: `${caseId}.health.${source.id}`, sourceId: source.id, revision: "source-v1", quality: "SUFFICIENT", authorized: true, observedAt: "2026-10-15T11:59:00Z", expiresAt: "2026-10-15T13:00:00Z"})), permissions: ["READ", "ANALYZE", "CONFIGURE", "OPERATE", "GOVERN"], versions: {catalog: "cases-v1", rule: "rules-v1", engine: "case-engine-v1", config: "fixture-v1", schema: "observations-v1", branch: definition.revision, action: "review-actions-v1", explanation: "alpha16-cases-v1"}, window: {...current}, scopeActive: true, tombstoned: false, cancelled: false, evaluationComplete: true, deadlineAt: "2026-10-15T14:00:00Z", audience: "RESTRICTED_STAFF"};
  const actionId = action ? action.startsWith(caseId + "-") ? action : `${caseId}-${action}` : null;
  const profile = structuredClone(CASE_FIXTURE_PROFILE);
  // Explicit synthetic seconds, solely to exercise the case ACTION contract.
  // This value is neither an approved operating profile nor a product default.
  profile.values[`${caseId}.cooldownSeconds`] = {value: 60, unit: "seconds"};
  return {id: `${caseId}-${suffix}`, caseId, baselineId: `${caseId}-BASELINE-v1`, changes: Object.keys(values).sort(), context, profile, registry: {version: "synthetic-source-registry-v1", sources: definition.sourceMappings.map(source => ({...source, confirmed: true})), targetTypes: [target.targetType]}, expected: {branchPath: names.map(name => `${caseId}-${name}`), outcome, reasonCode, actionId, mode: actionId ? "REVIEW_ONLY" : null, explanationId: actionId ? `${actionId}-EXPLANATION` : null}};
}

export const CASE_FIXTURES_01_12: CaseFixture[] = [
  caseFixture("CASE01", "ACCESS", {"onb.actualAccess": "NO_ACCESS"}, ["ACCESS"], "ACCESS-REVIEW"),
  caseFixture("CASE01", "FRICTION", {"onb.adminFriction": "CONFIRMED"}, ["ACCESS", "FRICTION"], "OPTIONALIZE-REVIEW"),
  caseFixture("CASE01", "DISCOVERABILITY", {"onb.visibilityState": "ONBOARDING_ONLY"}, ["ACCESS", "FRICTION", "DISCOVERABILITY"], "DISCOVERABILITY-REVIEW"),
  caseFixture("CASE01", "PREVIEW", {"onb.previewState": "FAIL"}, ["ACCESS", "FRICTION", "DISCOVERABILITY", "PREVIEW"], "PREVIEW-FIX"),
  caseFixture("CASE01", "PRIVATE-PRESERVED", {"onb.expectedAccess": "NO_ACCESS", "onb.actualAccess": "NO_ACCESS"}, ["ACCESS", "FRICTION", "DISCOVERABILITY", "PREVIEW", "UNASSESSED"], null, "NO_ACTION", "NO_MATCH"),
  caseFixture("CASE02", "QUIET", {"welcome.channelPurpose": "QUIET_SOCIAL", "welcome.botReplyCount": 2, "welcome.humanStaffReplyCount": 0}, ["PRESSURE"], "SUPPRESS-PRESSURE"),
  caseFixture("CASE02", "NO-CONTACT", {"welcome.noContact": true}, ["PRESSURE"], "SUPPRESS-PRESSURE"),
  caseFixture("CASE02", "OUTSIDE", {"welcome.staffCoverageState": "OUT", "welcome.humanStaffReplyCount": 0}, ["PRESSURE", "OUTSIDE-COVERAGE"], "NO-REVIVAL-PING"),
  caseFixture("CASE02", "BOT-ONLY", {"welcome.humanStaffReplyCount": 0, "welcome.botReplyCount": 2}, ["PRESSURE", "OUTSIDE-COVERAGE", "BOT_ONLY"], "HUMAN-WELCOME-REVIEW"),
  caseFixture("CASE02", "BOTH-ZERO", {"welcome.humanStaffReplyCount": 0, "welcome.botReplyCount": 0}, ["PRESSURE", "OUTSIDE-COVERAGE", "BOT_ONLY", "GENERAL_HUMAN_GAP"], "WELCOME-ROTATION"),
  caseFixture("CASE02", "NEXT", {"welcome.nextDestinationConfigured": false}, ["PRESSURE", "OUTSIDE-COVERAGE", "BOT_ONLY", "GENERAL_HUMAN_GAP", "NEXT_DESTINATION"], "NEXT-DESTINATION-REVIEW"),
  caseFixture("CASE02", "OPTIONAL-INTRO", {"welcome.introRequired": false}, ["PRESSURE", "OUTSIDE-COVERAGE", "BOT_ONLY", "GENERAL_HUMAN_GAP", "NEXT_DESTINATION", "UNASSESSED"], null, "NO_ACTION", "NO_MATCH"),
  caseFixture("CASE03", "SOLVED", {"support.askerOutcome": "SOLVED_CONFIRMED", "support.intakeState": "NEEDS_DETAILS"}, ["SOLVED"], "QUEUE-REMOVE-REVIEW"),
  caseFixture("CASE03", "DETAILS-BEFORE-COVERAGE", {"support.intakeState": "NEEDS_DETAILS", "support.coverageState": "OUT"}, ["SOLVED", "NEEDS_DETAILS"], "INTAKE-CHECKLIST"),
  caseFixture("CASE03", "OUTSIDE", {"support.coverageState": "OUT"}, ["SOLVED", "NEEDS_DETAILS", "OUTSIDE_COVERAGE"], "NEXT-COVERAGE"),
  caseFixture("CASE03", "SPECIALIST", {"support.topicClass": "SPECIALIST", "support.specialistAssigned": "NO"}, ["SOLVED", "NEEDS_DETAILS", "OUTSIDE_COVERAGE", "SPECIALIST"], "SPECIALIST-HANDOFF"),
  caseFixture("CASE03", "GENERAL-BOUNDARY", {"support.unansweredAgeSeconds": 60}, ["SOLVED", "NEEDS_DETAILS", "OUTSIDE_COVERAGE", "SPECIALIST", "GENERAL"], "UNANSWERED-QUEUE"),
  caseFixture("CASE03", "OBSERVED-UNCONFIRMED", {"support.askerOutcome": "UNASSESSED"}, ["SOLVED", "NEEDS_DETAILS", "OUTSIDE_COVERAGE", "SPECIALIST", "GENERAL", "OUTCOME_UNASSESSED"], null, "DIAGNOSTIC", "OUTCOME_UNASSESSED"),
  caseFixture("CASE04", "UNCLEAR", {"support.askerExplicitOutcome": "UNCLEAR", "support.missingReproduction": "YES"}, ["EXPLICIT_UNCLEAR"], "CLARIFY-REVIEW"),
  caseFixture("CASE04", "DETAIL", {"support.missingReproduction": "YES"}, ["EXPLICIT_UNCLEAR", "KNOWN_MISSING_DETAIL"], "INTAKE-CHECKLIST"),
  caseFixture("CASE04", "GUIDE", {"support.sameTopicReopenCount": 1, "support.guideMappingState": "MISSING"}, ["EXPLICIT_UNCLEAR", "KNOWN_MISSING_DETAIL", "GUIDE_GAP"], "GUIDE-REVIEW"),
  caseFixture("CASE04", "OBSERVED-UNCONFIRMED", {"support.askerExplicitOutcome": "UNASSESSED"}, ["EXPLICIT_UNCLEAR", "KNOWN_MISSING_DETAIL", "GUIDE_GAP", "OBSERVED_OUTCOME_UNCONFIRMED"], "OUTCOME-CONFIRM"),
  caseFixture("CASE05", "NEW-ONLY", {"cohort.newCurrent": point(2), "cohort.newPrior": point(3), "cohort.establishedCurrent": point(9), "cohort.establishedPrior": point(8)}, ["NEW_ONLY_DECLINE"], "ONBOARDING_ACCESS_REVIEW"),
  caseFixture("CASE05", "BOTH", {"cohort.newCurrent": point(2), "cohort.establishedCurrent": point(7)}, ["NEW_ONLY_DECLINE", "BOTH_DECLINE"], "COMMUNITY_ACTIVITY_REVIEW"),
  caseFixture("CASE05", "ESTABLISHED-ONLY", {"cohort.establishedCurrent": point(7)}, ["NEW_ONLY_DECLINE", "BOTH_DECLINE", "ESTABLISHED_ONLY_DECLINE"], "ESTABLISHED_ACTIVITY_REVIEW"),
  caseFixture("CASE05", "PILOT", {"activity.optInInterest": "SUFFICIENT"}, ["NEW_ONLY_DECLINE", "BOTH_DECLINE", "ESTABLISHED_ONLY_DECLINE", "SMALL_PILOT"], "SMALL_PILOT_REVIEW"),
  caseFixture("CASE05", "CAPACITY", {"activity.hostCapacity": "INSUFFICIENT"}, ["NEW_ONLY_DECLINE", "BOTH_DECLINE", "ESTABLISHED_ONLY_DECLINE", "SMALL_PILOT", "CAPACITY"], "ACTIVITY_LOAD_REVIEW"),
  caseFixture("CASE06", "CAPACITY", {"event.scheduled": true, "event.coverageCapacity": "INSUFFICIENT", "moderation.issueCategory": "REPEATED_SPAM"}, ["EVENT_CAPACITY"], "EVENT_LOAD_REVIEW"),
  caseFixture("CASE06", "SPAM", {"moderation.issueCategory": "REPEATED_SPAM"}, ["EVENT_CAPACITY", "REPEATED_SPAM"], "LIMITED_RULE_REVIEW"),
  caseFixture("CASE06", "HUMAN", {"moderation.issueCategory": "CONTEXT_DEPENDENT"}, ["EVENT_CAPACITY", "REPEATED_SPAM", "HUMAN_TRIAGE"], "HUMAN_TRIAGE_REVIEW"),
  caseFixture("CASE06", "NO-EXPANSION", {}, ["EVENT_CAPACITY", "REPEATED_SPAM", "HUMAN_TRIAGE", "NO_EXPANSION"], "NO_EXPANSION_RECOMMENDATION"),
  caseFixture("CASE07", "LOGISTICS", {"format.logisticsState": "PROBLEM_CONFIRMED"}, ["LOGISTICS"], "EVENT_LOGISTICS_REVIEW"),
  caseFixture("CASE07", "ALTERNATIVE", {"format.comparableParticipationState": "LOW_COMPARABLE", "format.preferredFormat": "ALTERNATIVE"}, ["LOGISTICS", "ALT_FORMAT_PILOT"], "ALT_FORMAT_PILOT"),
  caseFixture("CASE07", "KEEP", {}, ["LOGISTICS", "ALT_FORMAT_PILOT", "KEEP_CURRENT"], "KEEP_CURRENT"),
  caseFixture("CASE07", "NOT-COMPARABLE", {"format.comparableParticipationState": "NOT_COMPARABLE", "format.preferredFormat": "NO_PREFERENCE"}, ["LOGISTICS", "ALT_FORMAT_PILOT", "KEEP_CURRENT", "NOT_COMPARABLE"], "EVENT_COMPARISON_REVIEW"),
  caseFixture("CASE08", "STABILITY", {"activity.integrationErrorCount": 1, "activity.optInInterest": "SUFFICIENT"}, ["STABILITY"], "INTEGRATION_STABILITY_REVIEW"),
  caseFixture("CASE08", "CHALLENGE", {"activity.optInInterest": "SUFFICIENT"}, ["STABILITY", "SMALL_CHALLENGE"], "SMALL_COLLABORATIVE_CHALLENGE"),
  caseFixture("CASE08", "LOW-LOAD", {"activity.optInInterest": "SUFFICIENT", "activity.hostCapacity": "INSUFFICIENT"}, ["STABILITY", "SMALL_CHALLENGE", "LOW_LOAD"], "ASYNC_LOW_LOAD_ACTIVITY"),
  caseFixture("CASE08", "QUIET", {}, ["STABILITY", "SMALL_CHALLENGE", "LOW_LOAD", "QUIET_ACCEPTANCE"], "QUIET_PERIOD_ACCEPTANCE"),
  caseFixture("CASE09", "OWNER-WITHOUT-CANONICAL", {"request.status": "SUBMITTED", "request.ownerAssigned": false, "request.ownerRoleId": null}, ["INVALID_OWNER", "OWNER"], "SUGGESTION_OWNER_REVIEW"),
  caseFixture("CASE09", "OVERDUE", {"request.reviewDueAt": "2026-10-14T12:00:00Z"}, ["INVALID_OWNER", "OWNER", "REVIEW_DUE"], "SUGGESTION_REVIEW_DUE"),
  caseFixture("CASE09", "DEPENDENCY", {"request.status": "BLOCKED"}, ["INVALID_OWNER", "OWNER", "REVIEW_DUE", "DEPENDENCY"], "SUGGESTION_DEPENDENCY_REVIEW"),
  caseFixture("CASE09", "DECLINED", {"request.status": "DECLINED"}, ["INVALID_OWNER", "OWNER", "REVIEW_DUE", "DEPENDENCY", "REASON_REFERENCE"], "SUGGESTION_REASON_REFERENCE_REVIEW"),
  caseFixture("CASE09", "INVALID-OWNER", {"request.ownerRoleId": null}, ["INVALID_OWNER"], null, "INELIGIBLE", "REQUEST_OWNER_INVALID"),
  caseFixture("CASE10", "NAVIGATION", {"channel.nameIssue": "DUPLICATE"}, ["NAVIGATION"], "CHANNEL_NAVIGATION_REVIEW"),
  caseFixture("CASE10", "PROTECTED-RESTRICTED", {"channel.expectedAccess": "RESTRICTED", "channel.actualAccess": "RESTRICTED", "channel.protectedUse": "RESOURCE"}, ["NAVIGATION", "PRESERVE"], "CHANNEL_PRESERVE_REVIEW"),
  caseFixture("CASE10", "UNCLASSIFIED", {"channel.purpose": "UNCLASSIFIED"}, ["NAVIGATION", "PRESERVE", "PURPOSE_UNCLASSIFIED"], "CHANNEL_PURPOSE_CONFIRM"),
  caseFixture("CASE10", "CONSOLIDATION", {"channel.overlapStatus": "CONFIRMED", "channel.messageCount": 9}, ["NAVIGATION", "PRESERVE", "PURPOSE_UNCLASSIFIED", "CONSOLIDATION"], "CHANNEL_CONSOLIDATION_REVIEW"),
  caseFixture("CASE11", "ACCESS-FIRST", {"event.accessBarrierState": "CONFIRMED"}, ["ACCESS_FIRST"], "EVENT_LOGISTICS_REVIEW"),
  caseFixture("CASE11", "GOAL", {}, ["ACCESS_FIRST", "GOAL_MET"], "EVENT_GOAL_MAINTAIN_REVIEW"),
  caseFixture("CASE11", "DEDICATED", {"event.optionalFeedback": "UNASSESSED", "event.repeatSourceContract": "DEDICATED_CONFIRMED", "event.repeatPoint": point(2)}, ["ACCESS_FIRST", "GOAL_MET", "DEDICATED_REPEAT"], "EVENT_FORMAT_QUESTION_REVIEW"),
  caseFixture("CASE11", "HOST", {"event.optionalFeedback": "UNASSESSED", "event.ownedBy": "COMMUNITY", "event.hostCapacity": "LIMITED"}, ["ACCESS_FIRST", "GOAL_MET", "DEDICATED_REPEAT", "HOST_SUPPORT"], "COMMUNITY_HOST_SUPPORT_REVIEW"),
  caseFixture("CASE11", "FEEDBACK-ONLY", {"event.optionalFeedback": "UNASSESSED"}, ["ACCESS_FIRST", "GOAL_MET", "DEDICATED_REPEAT", "HOST_SUPPORT", "OPTIONAL_FEEDBACK"], "OPTIONAL_FEEDBACK_REVIEW"),
  caseFixture("CASE12", "CORRECTION", {"announcement.correctionFlag": true, "announcement.mentionScope": "MASS", "announcement.mentionCount": 30}, ["CORRECTION"], "ANNOUNCEMENT_CORRECTION_REVIEW"),
  caseFixture("CASE12", "DIGEST", {"announcement.mentionScope": "MASS", "announcement.mentionCount": 30}, ["CORRECTION", "DIGEST"], "ANNOUNCEMENT_DIGEST_REVIEW"),
  caseFixture("CASE12", "REFERENCE", {"announcement.missingInfoReport": "REPEATED_INFO_REQUEST"}, ["CORRECTION", "DIGEST", "REFERENCE"], "ANNOUNCEMENT_REFERENCE_VISIBILITY_REVIEW"),
  caseFixture("CASE12", "PUBLIC", {"announcement.audience": "EXTERNAL_FOLLOWERS", "announcement.publishState": "READY"}, ["CORRECTION", "DIGEST", "REFERENCE", "PUBLIC_SCOPE"], "ANNOUNCEMENT_PUBLIC_SCOPE_REVIEW"),
];
// Complete source-quality variants use explicit branch expectations; no result
// or expected path is obtained from the production evaluator.
for(const [baseline,field,branch] of [
 ["CASE01-ACCESS","onb.actualAccess","ACCESS"],
 ["CASE02-QUIET","welcome.channelPurpose","PRESSURE"],
 ["CASE03-SOLVED","support.askerOutcome","SOLVED"],
 ["CASE04-UNCLEAR","support.askerExplicitOutcome","EXPLICIT_UNCLEAR"],
 ["CASE05-NEW-ONLY","cohort.newCurrent","NEW_ONLY_DECLINE"],
 ["CASE06-CAPACITY","event.scheduled","EVENT_CAPACITY"],
 ["CASE07-LOGISTICS","format.logisticsState","LOGISTICS"],
 ["CASE08-STABILITY","activity.integrationErrorCount","STABILITY"],
 ["CASE09-OVERDUE","request.requestId",null],
 ["CASE10-NAVIGATION","channel.nameIssue","NAVIGATION"],
 ["CASE11-ACCESS-FIRST","event.accessBarrierState","ACCESS_FIRST"],
 ["CASE12-CORRECTION","announcement.correctionFlag","CORRECTION"],
] as const){
 for(const quality of ["STALE","UNKNOWN"] as const){
  const original=CASE_FIXTURES_01_12.find(f=>f.id===baseline)!,changed=structuredClone(original);changed.id=`${original.caseId}-${quality}-SOURCE`;changed.context.contextId=changed.id;changed.context.fields[field]!.quality=quality;
  changed.baselineId=original.id;changed.changes=[...original.changes,`${field}.quality`];changed.expected={branchPath:branch?[`${original.caseId}-${branch}`]:[],outcome:"INELIGIBLE",reasonCode:"INPUT_QUALITY",actionId:null,mode:null,explanationId:null};CASE_FIXTURES_01_12.push(changed);
 }
}

/** Calendar examples declare already resolved instants; expected results remain
 * hand-written. A source adapter must confirm these boundaries on first seal. */
function calendarFixture(suffix:string,timeZone:string,currentWindow:{start:string;end:string;startDate:string;endDate:string},priorWindow:{start:string;end:string;startDate:string;endDate:string}):CaseFixture{
 const base=CASE_FIXTURES_01_12.find(f=>f.id==="CASE05-NEW-ONLY")!,row=structuredClone(base);row.id=`CASE05-${suffix}`;row.baselineId=base.id;row.context.contextId=row.id;
 row.context.evaluationAsOf=currentWindow.end;row.context.window={start:currentWindow.start,end:currentWindow.end};row.context.deadlineAt=new Date(Date.parse(currentWindow.end)+7200000).toISOString();
 for(const observation of Object.values(row.context.fields)){
  observation.observedAt=currentWindow.end;observation.expiresAt=new Date(Date.parse(currentWindow.end)+3600000).toISOString();
  const selected=observation.periodRole==="PRIOR"?priorWindow:currentWindow;observation.window={start:selected.start,end:selected.end};
  if(observation.cohort)Object.assign(observation.cohort,{windowKind:"CALENDAR_DAY",timeZone,calendarDays:7,calendarStartDate:selected.startDate,calendarEndDateExclusive:selected.endDate,metricWindowSeconds:(Date.parse(selected.end)-Date.parse(selected.start))/1000,cohortDefinitionVersion:"fixture-calendar-maturity-v1",joinWindow:{...observation.window},resolvedCalendar:{start:selected.start,end:selected.end,boundaryRule:"firstValidEarlier",rulesVersion:"fixture-confirmed-iana-v1",confirmed:true}});
 }
 for(const health of row.context.sourceHealth){health.observedAt=currentWindow.end;health.expiresAt=new Date(Date.parse(currentWindow.end)+3600000).toISOString();}
 row.changes=[...base.changes,"windowKind","timeZone","calendarDays","fixedCalendarBoundaries","asOf/sourceHealth times"];
 return row;
}
export const CASE_CALENDAR_FIXTURES_01_12:CaseFixture[]=[
 calendarFixture("DST-SPRING","America/New_York",{start:"2026-03-08T05:00:00.000000Z",end:"2026-03-15T04:00:00.000000Z",startDate:"2026-03-08",endDate:"2026-03-15"},{start:"2026-03-01T05:00:00.000000Z",end:"2026-03-08T05:00:00.000000Z",startDate:"2026-03-01",endDate:"2026-03-08"}),
 calendarFixture("DST-FALL","America/New_York",{start:"2026-11-01T04:00:00.000000Z",end:"2026-11-08T05:00:00.000000Z",startDate:"2026-11-01",endDate:"2026-11-08"},{start:"2026-10-25T04:00:00.000000Z",end:"2026-11-01T04:00:00.000000Z",startDate:"2026-10-25",endDate:"2026-11-01"}),
 calendarFixture("TOKYO-CROSS-DAY","Asia/Tokyo",{start:"2026-10-07T15:00:00.000000Z",end:"2026-10-14T15:00:00.000000Z",startDate:"2026-10-08",endDate:"2026-10-15"},{start:"2026-09-30T15:00:00.000000Z",end:"2026-10-07T15:00:00.000000Z",startDate:"2026-10-01",endDate:"2026-10-08"}),
];
CASE_FIXTURES_01_12.push(...CASE_CALENDAR_FIXTURES_01_12);
