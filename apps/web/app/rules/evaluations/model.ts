import {z} from "zod";
import {nativeSourceRequest, type NativeSourceRequest} from "../../../../../packages/rules/src/native-source-request";
import type {OperationalCaseContexts} from "../../../../../packages/rules/src/operational-context";
import type {NativeCohortConfig} from "../sources/model";
import type {IssueTarget} from "../issues/model";
export const sourceKinds = nativeSourceRequest.options.map(option => option.shape.kind.value);
export type NativeKind = NativeSourceRequest["kind"];
export interface HealthRef {observationId: string; revision: string;}
export interface EvaluationChoices {cohorts: NativeCohortConfig[]; flows: {id: string; name: string; activeRevision: number | null; state: string}[]; schedules: {id: string; revision: number; template_id: string; state: string; timezone: string}[];
  issues: {id: string; issueCode: string; target: IssueTarget; baseTarget: IssueTarget; expiresAt: string}[];}
export interface NativeForm {kind: NativeKind; selected: string; windowStart: string; windowEnd: string; periodRole: "" | "CURRENT" | "PREVIOUS"; healthRefs: HealthRef[]; permissionVersion: string; periods: {windowStart: string; windowEnd: string}[];}
export const emptyNativeForm = (kind: NativeKind = "ONBOARDING_FIRST_ACTION"): NativeForm => ({kind, selected: "", windowStart: "", windowEnd: "", periodRole: "", healthRefs: [], permissionVersion: "", periods: Array.from({length: 3}, () => ({windowStart: "", windowEnd: ""}))});
export const fixedCurrent = (kind: NativeKind) => ["ONBOARDING_FIRST_ACTION", "HELP_BACKLOG_COHORT", "ENGAGEMENT_CONTINUATION_COHORT", "AUTO_EXECUTION_OBSERVATION", "PERMISSION_REQUIREMENTS"].includes(kind);
export const needsWindow = (kind: NativeKind) => !["REPORT_GENERATION_STATE", "EXPERIMENT_STATE", "PLAYBOOK_STATE", "STRUCTURED_ISSUE_PERIODS", "DATA_SOURCE_HEALTH"].includes(kind);
/** All accepted fields are native descriptors. The shared pure closed schema
 * remains the authority; no Fact, observation, role permission or approval can
 * be constructed by this browser model. */
export function buildNativeRequest(form: NativeForm, choices: EvaluationChoices, guildId: string, now: number): NativeSourceRequest | null {
  const period = {windowStart: form.windowStart, windowEnd: form.windowEnd, periodRole: fixedCurrent(form.kind) ? "CURRENT" : form.periodRole};
  if (needsWindow(form.kind) && (!(Date.parse(period.windowStart) < Date.parse(period.windowEnd)) || Date.parse(period.windowEnd) > now)) return null;
  let value: unknown;
  if (["ONBOARDING_FIRST_ACTION", "HELP_BACKLOG_COHORT", "ENGAGEMENT_CONTINUATION_COHORT", "CHANNEL_PARTICIPATION_COHORT", "EVENT_RSVP_ATTENDANCE_COHORT"].includes(form.kind)) {
    const source = choices.cohorts.find(c => c.sourceId === form.selected && c.enabled && c.definition.kind === form.kind && Date.parse(c.expiresAt) > now); if (!source) return null;
    const target = form.kind === "CHANNEL_PARTICIPATION_COHORT" ? {channelId: source.target.targetId, liveVersion: source.target.liveVersion} : {targetId: source.target.targetId, liveVersion: source.target.liveVersion};
    value = {kind: form.kind, ...target, ...period, sourceConfig: {sourceId: source.sourceId, revisionId: source.revisionId}};
  } else if (form.kind === "AUTO_RUN_OUTCOMES" || form.kind === "AUTO_EXECUTION_OBSERVATION") {
    const flow = choices.flows.find(f => f.id === form.selected && f.state === "ACTIVE" && f.activeRevision !== null); if (!flow) return null;
    value = {kind: form.kind, flowId: flow.id, liveRevision: flow.activeRevision, ...period, ...(form.healthRefs.length ? {healthRefs: form.healthRefs} : {})};
  } else if (form.kind === "REPORT_DELIVERY" || form.kind === "REPORT_GENERATION_STATE") {
    const schedule = choices.schedules.find(s => s.id === form.selected && s.state === "ENABLED"); if (!schedule) return null;
    value = {kind: form.kind, scheduleId: schedule.id, liveRevision: schedule.revision, ...(form.kind === "REPORT_DELIVERY" ? period : {}), ...(form.healthRefs.length ? {healthRefs: form.healthRefs} : {})};
  } else if (form.kind === "DATA_SOURCE_HEALTH") {if (form.healthRefs.length !== 1) return null; value = {kind: form.kind, healthRef: form.healthRefs[0]};}
  else if (form.kind === "PERMISSION_REQUIREMENTS") value = {kind: form.kind, targetId: guildId, liveVersion: form.permissionVersion, ...period, ...(form.healthRefs.length ? {healthRefs: form.healthRefs} : {})};
  else {
    const issue = choices.issues.find(i => i.id === form.selected && Date.parse(i.expiresAt) > now); if (!issue) return null;
    if (form.kind === "STRUCTURED_ISSUE_PERIODS") {
      if (form.periods.length !== 3 || form.periods.some((p, i) => !(Date.parse(p.windowStart) < Date.parse(p.windowEnd)) || Date.parse(p.windowEnd) > now || i > 0 && p.windowStart !== form.periods[i - 1]!.windowEnd)) return null;
      value = {kind: form.kind, issueCode: issue.issueCode, targetId: issue.target.targetId, liveVersion: issue.target.liveVersion, baseTargetType: issue.baseTarget.targetType, baseTargetId: issue.baseTarget.targetId, baseLiveVersion: issue.baseTarget.liveVersion, periods: form.periods, ...(form.healthRefs.length ? {healthRefs: form.healthRefs} : {})};
    } else value = {kind: form.kind, issueCode: issue.issueCode, targetId: issue.target.targetId, liveVersion: issue.target.liveVersion, ...(form.healthRefs.length ? {healthRefs: form.healthRefs} : {})};
  }
  const parsed = nativeSourceRequest.safeParse(value); return parsed.success ? parsed.data : null;
}
export const caseIds = Array.from({length: 20}, (_, index) => `CASE${String(index + 1).padStart(2, "0")}`);
export interface ExistingInput {kind: "FACT" | "SOURCE_HEALTH"; id: string; revision: string;}
export type CaseContextChoice = Awaited<ReturnType<OperationalCaseContexts["catalog"]>>["items"][number];
const contextChoice: z.ZodType<CaseContextChoice> = z.object({id: z.uuid(), caseId: z.string().regex(/^CASE(?:0[1-9]|1[0-9]|20)$/), version: z.number().int().positive(), target: z.object({targetType: z.string(), targetId: z.string(), liveVersion: z.string().nullable()}).strict(), observedAt: z.iso.datetime(), expiresAt: z.iso.datetime()}).strict();
export const caseContextCatalog = z.object({items: z.array(contextChoice).max(100)});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Context selection carries only catalog resource IDs. Native authorization,
 * source sealing and current expiry are still checked on the server. */
export function contextSelectionError(ids: string[], choices: CaseContextChoice[], requestedCaseIds: string[], now: number): string | null {
  if (ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id))) return "CASE_CONTEXT_SELECTOR_INVALID";
  const selectedCases = new Set<string>();
  for (const id of ids) {
    const context = choices.find(choice => choice.id === id);
    if (!context || !caseIds.includes(context.caseId) || !(Date.parse(context.expiresAt) > now)) return "CASE_CONTEXT_NOT_AVAILABLE";
    if (selectedCases.has(context.caseId)) return "CASE_CONTEXT_AMBIGUOUS";
    if (requestedCaseIds.length && !requestedCaseIds.includes(context.caseId)) return "CASE_CONTEXT_SELECTOR_MISMATCH";
    selectedCases.add(context.caseId);
  }
  return null;
}
export function buildEvaluationRequest(configVersion: number, nativeInputs: NativeSourceRequest[], inputs: ExistingInput[], requestedCaseIds: string[], caseOnly: boolean, requestedContextIds: string[] = []) {
  if (!Number.isSafeInteger(configVersion) || configVersion < 1 || requestedCaseIds.length > 20 || new Set(requestedCaseIds).size !== requestedCaseIds.length || requestedCaseIds.some(id => !caseIds.includes(id)) || requestedContextIds.length > 20 || new Set(requestedContextIds).size !== requestedContextIds.length || requestedContextIds.some(id => !uuid.test(id)) || !caseOnly && (nativeInputs.length > 20 || inputs.length > 20 || inputs.some(ref => !uuid.test(ref.id) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(ref.revision)))) return null;
  const selected = [...requestedCaseIds].sort(), contexts = [...requestedContextIds].sort(); if (caseOnly && !selected.length && !contexts.length || !caseOnly && !nativeInputs.length && !inputs.length && !selected.length && !contexts.length) return null;
  return {configVersion, inputs: caseOnly ? [] : inputs, ...(!caseOnly && nativeInputs.length ? {nativeInputs} : {}), ...(selected.length ? {requestedCaseIds: selected} : {}), ...(contexts.length ? {requestedContextIds: contexts} : {}), reason: "MANUAL" as const};
}
