import type {NativeCohortConfig, NativeCohortDefinition} from "../../../../../packages/rules/src/native-cohort-config";
export type {NativeCohortConfig, NativeCohortDefinition};
export interface NativeSourceOptions {settingsRevision: number; timeZone: string; flowVersions: {id: string; version: number; targetVersion: string}[]; activationRevisions: {id: string; version: number}[];
  intakePanels: {id: string; version: number}[]; channels: {id: string; eligible: boolean; targetVersion: string | null}[]; events: {id: string; startAt?: string | null}[]; reasonCodes: string[]; canConfigure: boolean; operationalApproval: false;}
export const sourceKinds = ["ONBOARDING_FIRST_ACTION", "HELP_BACKLOG_COHORT", "ENGAGEMENT_CONTINUATION_COHORT", "CHANNEL_PARTICIPATION_COHORT", "EVENT_RSVP_ATTENDANCE_COHORT"] as const;
export type SourceKind = typeof sourceKinds[number];
type Activity = Extract<NativeCohortDefinition, {kind: "ENGAGEMENT_CONTINUATION_COHORT"}>["signals"][number];
export const activitySignals = ["message.sent", "reaction.added", "reply.received", "thread.member_added", "voice.duration", "scheduled_event.attended", "scheduled_event.subscribed", "interaction.used", "activation.completed", "nexus_onboarding.answered"] as const satisfies readonly Activity[];
export const channelSignals = ["message.sent", "reaction.added", "reply.received", "thread.member_added", "voice.duration", "scheduled_event.attended"] as const;
export type SourceForm = {sourceId: string; revisionId: string; baseVersion: number; enabled: boolean; kind: SourceKind; settingsRevision: number; campaignClass: string; timeZone: string;
  flowVersionId: string; activationRevisionId: string; panelIds: string[]; channelIds: string[]; signals: Activity[]; channelId: string; populationChannelIds: string[]; eventIds: string[];
  observationSeconds: string; slaSeconds: string; stalledAfterSeconds: string; stalledMode: "" | "NONE" | "SECONDS";};
export function emptySourceForm(options: NativeSourceOptions): SourceForm {return {sourceId: "", revisionId: "", baseVersion: 0, enabled: false, kind: "ONBOARDING_FIRST_ACTION", settingsRevision: options.settingsRevision, campaignClass: "", timeZone: options.timeZone,
  flowVersionId: "", activationRevisionId: "", panelIds: [], channelIds: [], signals: [], channelId: "", populationChannelIds: [], eventIds: [], observationSeconds: "", slaSeconds: "", stalledAfterSeconds: "", stalledMode: ""};}
export function editSourceForm(value: NativeCohortConfig, options: NativeSourceOptions, revisionId: string): SourceForm {
  const d = value.definition, form = {...emptySourceForm(options), sourceId: value.sourceId, revisionId, baseVersion: value.version, enabled: value.enabled, kind: d.kind, settingsRevision: d.settingsRevision, campaignClass: d.campaignClass, timeZone: d.timeZone};
  if (d.kind === "ONBOARDING_FIRST_ACTION") return {...form, flowVersionId: d.flowVersionId, activationRevisionId: d.activationRevisionId, observationSeconds: String(d.observationSeconds)};
  if (d.kind === "HELP_BACKLOG_COHORT") return {...form, panelIds: d.panels.map(p => p.panelId), slaSeconds: String(d.slaSeconds), stalledMode: d.stalledAfterSeconds === null ? "NONE" : "SECONDS", stalledAfterSeconds: d.stalledAfterSeconds === null ? "" : String(d.stalledAfterSeconds)};
  if (d.kind === "ENGAGEMENT_CONTINUATION_COHORT") return {...form, channelIds: [...d.channelIds], signals: [...d.signals]};
  if (d.kind === "CHANNEL_PARTICIPATION_COHORT") return {...form, channelId: d.channelId, populationChannelIds: [...d.populationChannelIds], signals: [...d.signals]};
  return {...form, eventIds: [...d.eventIds], channelIds: [...d.channelIds]};
}
const seconds = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 2592000 ? Number(value) : null;
export function sourceDefinition(form: SourceForm, options: NativeSourceOptions): NativeCohortDefinition | null {
  if (form.settingsRevision !== options.settingsRevision || !/^[A-Za-z0-9_.:-]{1,128}$/.test(form.campaignClass)) return null;
  try {new Intl.DateTimeFormat("en", {timeZone: form.timeZone});} catch {return null;}
  const common = {settingsRevision: form.settingsRevision, campaignClass: form.campaignClass, timeZone: form.timeZone};
  const eligibleChannels = new Set(options.channels.filter(c => c.eligible).map(c => c.id)), selected = (ids: string[], allowed: Set<string>) => ids.length > 0 && ids.every(id => allowed.has(id));
  if (form.kind === "ONBOARDING_FIRST_ACTION") {const flow = options.flowVersions.find(v => v.id === form.flowVersionId), activation = options.activationRevisions.find(v => v.id === form.activationRevisionId), observationSeconds = seconds(form.observationSeconds);
    return flow && activation && observationSeconds !== null ? {...common, kind: form.kind, flowVersionId: flow.id, flowTargetVersion: flow.targetVersion, activationRevisionId: activation.id, observationSeconds, windowDays: 7} : null;}
  if (form.kind === "HELP_BACKLOG_COHORT") {const panels = form.panelIds.map(id => options.intakePanels.find(p => p.id === id)), slaSeconds = seconds(form.slaSeconds), stalled = form.stalledMode === "NONE" ? null : seconds(form.stalledAfterSeconds);
    return panels.length > 0 && panels.length <= 100 && panels.every(p => !!p) && slaSeconds !== null && form.stalledMode !== "" && (form.stalledMode === "NONE" || stalled !== null)
      ? {...common, kind: form.kind, panels: panels.map(p => ({panelId: p!.id, version: p!.version})), slaSeconds, stalledAfterSeconds: stalled, windowDays: 7} : null;}
  if (form.kind === "ENGAGEMENT_CONTINUATION_COHORT") return selected(form.channelIds, eligibleChannels) && form.signals.length > 0 ? {...common, kind: form.kind, channelIds: form.channelIds, signals: form.signals, windowDays: 7} : null;
  if (form.kind === "CHANNEL_PARTICIPATION_COHORT") {const signals = form.signals.filter((s): s is typeof channelSignals[number] => (channelSignals as readonly string[]).includes(s)), targetVersion = options.channels.find(c => c.id === form.channelId)?.targetVersion;
    return eligibleChannels.has(form.channelId) && typeof targetVersion === "string" && /^[a-f0-9]{64}$/.test(targetVersion) && selected(form.populationChannelIds, eligibleChannels) && form.populationChannelIds.includes(form.channelId) && signals.length > 0 && signals.length === form.signals.length
      ? {...common, kind: form.kind, channelId: form.channelId, channelTargetVersion: targetVersion, populationChannelIds: form.populationChannelIds, signals, windowDays: 7} : null;}
  return selected(form.eventIds, new Set(options.events.map(e => e.id))) && selected(form.channelIds, eligibleChannels) ? {...common, kind: form.kind, eventIds: form.eventIds, channelIds: form.channelIds, confirmation: "DISCORD_SUBSCRIPTION_AT_EVENT_START", attendance: "OBSERVED_VOICE_STAGE", windowDays: 28} : null;
}
