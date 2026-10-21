import {z} from "zod";
import {sql, tenant, type Tx} from "../../db/src/index";
import {assert, type Scope} from "../../shared/src/index";
import {SettingsService, type Actor} from "../../settings/src/index";
import {configHash, type Revision} from "../../settings/src/revisions";
import {actorPermissions} from "../../operations/src/policy";
import {analysisChannelScope} from "../../lifecycle/src/discovery";
import {activationSchema, evaluateCondition, type Condition, type Evidence} from "../../lifecycle/src/activation";
import {interventionSchema} from "../../lifecycle/src/interventions";
import {assignVariant, analyzeBinary, analyzeTimeBlocks, experimentSchema, type BinaryGroup} from "../../lifecycle/src/experiments";
import {canonicalSignal, signalRegistry, type NexusSignal} from "../../events/src/registry";

/** These bound a read, not a new collection or retention policy. No arbitrary
 * JSON, sample events, executable expressions or episode IDs are accepted. */
export const LIFECYCLE_PREVIEW_BOUNDS = {episodes: 25, factsPerEpisode: 200, gaps: 100, definitionNodes: 2000, definitionDepth: 16} as const;
export const lifecyclePreviewReplaySchema = z.object({asOf: z.iso.datetime({offset: true}), sourceHash: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type LifecyclePreviewReplay = z.infer<typeof lifecyclePreviewReplaySchema>;
export function boundedPreviewDefinition(value: unknown) {
  const work = [{value, depth: 0}]; let nodes = 0;
  while (work.length) {const item = work.pop()!; if (++nodes > LIFECYCLE_PREVIEW_BOUNDS.definitionNodes || item.depth > LIFECYCLE_PREVIEW_BOUNDS.definitionDepth) return false;
    if (item.value !== null && typeof item.value === "object") for (const child of Object.values(item.value)) work.push({value: child, depth: item.depth + 1});}
  return true;
}
type Truth = true | false | "unknown";
type Tally = {matched: number; notMatched: number; unknown: number};
const tally = (): Tally => ({matched: 0, notMatched: 0, unknown: 0});
const record = (out: Tally, value: Truth) => {if (value === "unknown") out.unknown++; else if (value) out.matched++; else out.notMatched++;};
const conjunction = (values: Truth[]): Truth => values.includes(false) ? false : values.includes("unknown") ? "unknown" : true;
type Episode = {id: string; joined_at: Date; engagement_started_at: Date | null};
type EventRow = {id: string; kind: string; occurred_at: Date; data: Record<string, unknown>};
type Assignment = {variant: string; unit_key: string; assigned_at: Date; window_end: Date};
type Sample = {id: string; joinedAt: number; engagementAt: number; evidence: Evidence; truncated: boolean; assignment: Assignment | null; assignments: (Assignment & {revision_id: string})[]};
type SimulationSide = {domain: string; outcomes: Tally; proposedStates?: Record<string, number>; variants?: {control: number; treatment: number; unknown: number; savedAssignments: number};
  liveControlState?: string; statistics?: ReturnType<typeof analyzeBinary> | ReturnType<typeof analyzeTimeBlocks> | null; reasonCodes: string[]};
export interface LifecycleExecutionPreview {
  available: boolean; kind: "BOUNDED_SAVED_SOURCE_SIMULATION"; reasonCodes: string[];
  input: {asOf: string; sourceHash: string; settingsRevision: number} | null;
  sample: {episodes: number; truncated: boolean; factsTruncated: boolean; maxEpisodes: number; maxFactsPerEpisode: number};
  before: SimulationSide | null; after: SimulationSide | null;
  liveEnabled: boolean; externalEffects: false; liveStateChanged: false; persisted: false; usageConsumed: false;
  limitations: readonly string[];
}
const limitations = ["BOUNDED_SAMPLE_NOT_POPULATION_FORECAST", "NO_EXTERNAL_DELIVERY_OR_TARGET_SAFETY_SIMULATION", "NO_HISTORICAL_ROLE_STATE_RECONSTRUCTION", "NO_CAUSAL_EFFECT_FORECAST", "TRIGGER_ORIGIN_NOT_RECONSTRUCTED", "READ_COMMITTED_SOURCE_VECTOR_NOT_GLOBAL_SNAPSHOT", "INPUT_NOT_PERSISTED_REPLAY_REQUIRES_UNCHANGED_SAVED_SOURCE"] as const;
const unavailable = (reasonCode: string, enabled: boolean): LifecycleExecutionPreview => ({available: false, kind: "BOUNDED_SAVED_SOURCE_SIMULATION", reasonCodes: [reasonCode], input: null,
  sample: {episodes: 0, truncated: false, factsTruncated: false, maxEpisodes: 25, maxFactsPerEpisode: 200}, before: null, after: null,
  liveEnabled: enabled, externalEffects: false, liveStateChanged: false, persisted: false, usageConsumed: false, limitations});
const channelBound = new Set<NexusSignal>(["message.sent", "reply.received", "reply.established", "thread.response_received", "thread.member_added", "poll.participated", "scheduled_event.attended", "reaction.received", "reaction.added", "stage.participated", "voice.started", "voice.ended", "voice.duration", "voice.connected"]);
const signals = Object.keys(signalRegistry) as NexusSignal[];

/** Existing condition engine, evaluated at the same bounded event/role clocks
 * as activation projection. No activation pin or projected event is written. */
function activationTruth(rule: Condition, windowSeconds: number, sample: Sample): Truth {
  const e = {...sample.evidence, joinedAt: sample.engagementAt}, end = Math.min(e.asOf, e.joinedAt + windowSeconds * 1000);
  const times = [...new Set([...e.facts.map(f => f.at), ...(e.rolesObservedAt === undefined ? [] : [e.rolesObservedAt]), end])].filter(at => at >= e.joinedAt && at <= end).sort((a, b) => a - b);
  if (times.some(asOf => evaluateCondition(rule, {...e, asOf}) === true)) return true;
  return evaluateCondition(rule, {...e, asOf: end});
}
function simulateSide(revision: Revision, samples: Sample[], controlState = "running"): SimulationSide {
  const outcomes = tally(), reasonCodes: string[] = [];
  if (revision.domain === "activation") {
    const d = activationSchema.parse(revision.definition);
    for (const sample of samples) record(outcomes, activationTruth(d.rule, d.windowSeconds, sample));
    return {domain: revision.domain, outcomes, reasonCodes};
  }
  if (revision.domain === "intervention") {
    const d = interventionSchema.parse(revision.definition), proposedStates: Record<string, number> = {};
    const state = (key: string) => {proposedStates[key] = (proposedStates[key] ?? 0) + 1;};
    for (const sample of samples) {
      const e = sample.evidence, conditions = conjunction(d.conditions.map(c => evaluateCondition(c, e)));
      const trigger = e.facts.some(f => canonicalSignal(f.kind) === d.trigger && f.at + d.delaySeconds * 1000 <= e.asOf);
      const pendingTrigger = !trigger && e.facts.some(f => canonicalSignal(f.kind) === d.trigger);
      // lifecycle_events has no authenticated origin in this projection. Never
      // call interventionEligible without one: its default 'member' would turn
      // missing provenance into a positive proposal/approval/queue decision.
      if (conditions === false) {record(outcomes, false); state("NOT_ELIGIBLE");}
      else if (conditions === "unknown") {record(outcomes, "unknown"); state("UNKNOWN_CONDITION_EVIDENCE");}
      else if (trigger) {record(outcomes, "unknown"); state("UNKNOWN_TRIGGER_ORIGIN");}
      else if (pendingTrigger) {record(outcomes, "unknown"); state("UNKNOWN_TRIGGER_DELAY");}
      else if (e.unavailable?.includes(d.trigger)) {record(outcomes, "unknown"); state("UNKNOWN_TRIGGER_EVIDENCE");}
      else {record(outcomes, "unknown"); state("UNKNOWN_TRIGGER_NOT_OBSERVED");}
    }
    return {domain: revision.domain, outcomes, proposedStates, reasonCodes: ["TRIGGER_ORIGIN_NOT_RECONSTRUCTED"]};
  }
  const d = experimentSchema.parse(revision.definition), variants = {control: 0, treatment: 0, unknown: 0, savedAssignments: 0};
  const groups = {control: {n: 0, success: 0}, treatment: {n: 0, success: 0}}, blocks = {control: new Map<string, BinaryGroup>(), treatment: new Map<string, BinaryGroup>()};
  let unknownOutcomes = false;
  for (const sample of samples) {
    const eligible = conjunction(d.eligibility.map(c => evaluateCondition(c, sample.evidence))); record(outcomes, eligible);
    const saved = sample.assignment;
    // Existing assignments precede a new eligibility check in the live engine.
    // Preserve ITT membership even if today's condition would no longer match.
    if (!saved && eligible !== true) {if (eligible === "unknown") variants.unknown++; continue;}
    const unit = d.randomization === "member" ? sample.id : `block:${Math.floor(sample.evidence.asOf / (d.blockSeconds * 1000))}`;
    const variant = saved?.variant ?? assignVariant(revision.id, unit, d.variants);
    if (variant !== "control" && variant !== "treatment") {variants.unknown++; continue;}
    variants[variant]++; if (!saved) continue; variants.savedAssignments++;
    if (saved.window_end.getTime() > sample.evidence.asOf) continue;
    const required = d.primaryMetric === "activation" ? ["activation.completed"] : d.primaryMetric === "connection" ? ["reply.received"] : signals.filter(s => signalRegistry[s].active);
    if (sample.truncated || required.some(s => sample.evidence.unavailable?.includes(s as NexusSignal)) || saved.assigned_at.getTime() < sample.evidence.joinedAt) {unknownOutcomes = true; continue;}
    const events = sample.evidence.facts.filter(f => f.at >= saved.assigned_at.getTime() && f.at <= saved.window_end.getTime());
    const success = events.some(f => d.primaryMetric === "retention" ? !!canonicalSignal(f.kind) && signalRegistry[canonicalSignal(f.kind)!].active && f.at >= saved.window_end.getTime() - 86400000
      : canonicalSignal(f.kind) === (d.primaryMetric === "activation" ? "activation.completed" : "reply.received"));
    groups[variant].n++; if (success) groups[variant].success++;
    const b = blocks[variant].get(saved.unit_key) ?? {n: 0, success: 0}; b.n++; if (success) b.success++; blocks[variant].set(saved.unit_key, b);
  }
  // Never call ExperimentService.result/assign: they persist results, assign
  // members and can pause the experiment. Saved assignments are never redrawn.
  const calculated = unknownOutcomes || groups.control.n + groups.treatment.n === 0 ? null : d.randomization === "member"
    ? analyzeBinary(groups.control, groups.treatment, d.minimumSample) : analyzeTimeBlocks([...blocks.control.values()], [...blocks.treatment.values()], d.minimumSample);
  // Current source cannot reconstruct all historical contact/leave guardrails.
  // Keep descriptive rates but do not turn an unchecked guardrail into support.
  const statistics = calculated ? {...calculated, evidenceStatus: "INSUFFICIENT_DATA", credibleInterval: null, probabilityTreatmentBetter: null} : null;
  if (statistics === null) reasonCodes.push("MATURE_OBSERVABLE_ASSIGNED_OUTCOMES_UNAVAILABLE");
  return {domain: revision.domain, outcomes, variants, statistics, liveControlState: controlState,
    reasonCodes: [...reasonCodes, ...(controlState !== "running" ? ["EXPERIMENT_NOT_RUNNING_SIMULATION_ONLY"] : []), "PROPOSED_ASSIGNMENTS_NOT_SAVED", "GUARDRAIL_AND_DELIVERY_OUTCOMES_NOT_SIMULATED"]};
}

/** Called only inside the health facade's scoped READ/privacy transaction.
 * Existing ANALYZE additionally gates all member-source reads. Only aggregates
 * and input fingerprints leave this function, never episode/actor/fact data. */
export async function previewSavedLifecycle(tx: Tx, scope: Scope, actor: Actor, before: Revision | null, after: Revision, planAvailable: boolean, now: Date, replay?: LifecyclePreviewReplay): Promise<LifecycleExecutionPreview> {
  const cfg = await new SettingsService(tx).get(scope, tx), enabled = cfg.enabled && (after.domain === "intervention" ? cfg.flags.interventions_v2 : after.domain === "experiment" ? cfg.flags.experiments_v2 : true);
  if (!["activation", "intervention", "experiment"].includes(after.domain)) return unavailable("DOMAIN_HAS_NO_EXECUTION_EVALUATOR", enabled);
  if (!(await actorPermissions(tx, scope, actor)).includes("ANALYZE")) return unavailable("PREVIEW_ANALYZE_PERMISSION_REQUIRED", enabled);
  if (!planAvailable) return unavailable("PREVIEW_PLAN_UNAVAILABLE", enabled);
  if ((before && !boundedPreviewDefinition(before.definition)) || !boundedPreviewDefinition(after.definition)) return unavailable("PREVIEW_COMPLEXITY_LIMIT", enabled);
  const asOf = replay ? new Date(replay.asOf) : now, cutoff = new Date(now.getTime() - cfg.detailedRetentionDays * 86400000);
  assert(Number.isFinite(asOf.getTime()) && asOf <= now && asOf >= cutoff, "PREVIEW_AS_OF_UNAVAILABLE", 400);
  const resolved = await analysisChannelScope(tx, scope, cfg), allowed = new Set(resolved.resolutions.filter(c => c.selected && c.collectionEligibility === "ELIGIBLE").map(c => c.actualChannelId));
  const [episodes, cursorResult, gaps, controls] = await Promise.all([
    sql<Episode>`SELECT e.id,e.joined_at,e.engagement_started_at FROM membership_episodes e JOIN member_identity_map m ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.identity_id
      WHERE e.organization_id=${scope.organizationId}::uuid AND e.guild_id=${scope.guildId} AND e.context='PRODUCTION' AND e.left_at IS NULL
      AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest
      AND e.joined_at>=${cutoff} AND e.joined_at<=${asOf} AND COALESCE(e.engagement_started_at,e.joined_at)<=${asOf}
      AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=e.organization_id AND d.guild_id=e.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=m.lookup_hash))
      ORDER BY e.joined_at DESC,e.id LIMIT 26`.execute(tx),
    sql<{first_seen: Date; last_seen: Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(scope)}`.execute(tx),
    sql<{started_at: Date; ended_at: Date | null}>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(scope)} AND started_at<${asOf} AND (ended_at IS NULL OR ended_at>${cutoff}) ORDER BY started_at LIMIT 101`.execute(tx),
    after.domain === "experiment" ? sql<{revision_id: string; state: string}>`SELECT revision_id,state FROM experiment_controls WHERE ${tenant(scope)} AND revision_id IN (${after.id}::uuid,${before?.id ?? after.id}::uuid) ORDER BY revision_id LIMIT 2`.execute(tx) : Promise.resolve({rows: [] as {revision_id: string; state: string}[]}),
  ]);
  const cursor = cursorResult.rows[0], samples: Sample[] = [];
  for (const episode of episodes.rows.slice(0, 25)) {
    const [events, state, native, assignment] = await Promise.all([
      sql<EventRow>`SELECT id,kind,occurred_at,jsonb_strip_nulls(jsonb_build_object('channelId',data->'channelId','seconds',data->'seconds','nodeId',data->'nodeId','optionId',data->'optionId')) AS data FROM lifecycle_events WHERE ${tenant(scope)} AND episode_id=${episode.id}::uuid AND context='PRODUCTION' AND occurred_at>=${episode.joined_at} AND occurred_at<=${asOf} ORDER BY occurred_at,id LIMIT 201`.execute(tx),
      sql<{roles: string[]; roles_observed_at: Date | null}>`SELECT roles,roles_observed_at FROM member_observable_state WHERE ${tenant(scope)} AND episode_id=${episode.id}::uuid`.execute(tx),
      sql<{observed_at: Date}>`SELECT observed_at FROM native_member_snapshots WHERE ${tenant(scope)} AND episode_id=${episode.id}::uuid AND observed_at<=${asOf} ORDER BY observed_at DESC LIMIT 1`.execute(tx),
      after.domain === "experiment" ? sql<Assignment & {revision_id: string}>`SELECT revision_id,variant,unit_key,assigned_at,window_end FROM experiment_assignments WHERE ${tenant(scope)} AND episode_id=${episode.id}::uuid AND revision_id IN (${after.id}::uuid,${before?.id ?? after.id}::uuid) AND assigned_at<=${asOf} ORDER BY assigned_at,revision_id LIMIT 2`.execute(tx) : Promise.resolve({rows: [] as (Assignment & {revision_id: string})[]}),
    ]);
    const unavailableSignals = new Set<NexusSignal>(["activation.completed"]), facts: Evidence["facts"] = [];
    const incomplete = events.rows.length > 200 || gaps.rows.length > 100 || !cursor || cursor.first_seen > episode.joined_at || cursor.last_seen.getTime() + 90000 < asOf.getTime() || gaps.rows.some(g => g.started_at < asOf && (g.ended_at === null || g.ended_at > episode.joined_at));
    if (incomplete) signals.forEach(s => unavailableSignals.add(s));
    if (!cfg.flags.native_snapshot_v2 || !native.rows[0] || native.rows[0].observed_at.getTime() + 90000 < asOf.getTime()) signals.filter(s => signalRegistry[s].source === "rest").forEach(s => unavailableSignals.add(s));
    for (const event of events.rows.slice(0, 200)) {
      const kind = canonicalSignal(event.kind); if (!kind) continue;
      if (channelBound.has(kind) && (typeof event.data.channelId !== "string" || !allowed.has(event.data.channelId))) {unavailableSignals.add(kind); continue;}
      // An activation projection lacks the source-channel/definition provenance
      // needed for evaluating a different revision under today's visible scope.
      if (kind === "activation.completed") {unavailableSignals.add(kind); continue;}
      if (event.data.seconds !== undefined && (typeof event.data.seconds !== "number" || !Number.isFinite(event.data.seconds) || event.data.seconds < 0)) {unavailableSignals.add(kind); continue;}
      facts.push({kind, at: event.occurred_at.getTime(), data: event.data});
    }
    const roles = state.rows[0], freshRoles = roles?.roles_observed_at && roles.roles_observed_at <= asOf && roles.roles_observed_at.getTime() + 90000 >= asOf.getTime();
    const base: Sample = {id: episode.id, joinedAt: episode.joined_at.getTime(), engagementAt: (episode.engagement_started_at ?? episode.joined_at).getTime(), truncated: events.rows.length > 200,
      evidence: {joinedAt: episode.joined_at.getTime(), asOf: asOf.getTime(), facts, roles: freshRoles ? roles!.roles : [], rolesObservedAt: freshRoles ? roles!.roles_observed_at!.getTime() : undefined, unavailable: [...unavailableSignals].sort()},
      assignment: null, assignments: assignment.rows};
    // Keep both pinned assignments separate: previewing another revision never
    // swaps an existing assignment or changes its deterministic variant.
    samples.push(base);
  }
  // Date values must participate as ISO strings (not canonicalized {}), so a
  // changed saved assignment clock invalidates replay as well.
  const sourceHash = configHash(JSON.parse(JSON.stringify({asOf: asOf.toISOString(), settingsRevision: cfg.revision, before: before ? {id: before.id, version: before.version, hash: before.hash} : null, after: {id: after.id, version: after.version, hash: after.hash}, samples, planAvailable, controls: controls.rows,
    selectedChannels: [...allowed].sort(), cursor: cursor ? [cursor.first_seen.toISOString(), cursor.last_seen.toISOString()] : null,
    gaps: gaps.rows.map(g => [g.started_at.toISOString(), g.ended_at?.toISOString() ?? null]), episodeTruncated: episodes.rows.length > 25})));
  if (replay && replay.sourceHash !== sourceHash) return unavailable("PREVIEW_SAVED_SOURCE_CHANGED", enabled);
  const forRevision = (revision: Revision) => samples.map(sample => ({...sample, assignment: sample.assignments.find(a => a.revision_id === revision.id) ?? null}));
  const controlState = (revision: Revision) => controls.rows.find(c => c.revision_id === revision.id)?.state ?? "running";
  return {available: true, kind: "BOUNDED_SAVED_SOURCE_SIMULATION", reasonCodes: [...(!enabled ? ["LIVE_FEATURE_DISABLED_SIMULATION_ONLY"] : []), ...(samples.length === 0 ? ["NO_ELIGIBLE_SAVED_SOURCE"] : []), ...(episodes.rows.length > 25 ? ["EPISODE_SAMPLE_TRUNCATED"] : [])],
    input: {asOf: asOf.toISOString(), sourceHash, settingsRevision: cfg.revision}, sample: {episodes: samples.length, truncated: episodes.rows.length > 25, factsTruncated: samples.some(s => s.truncated), maxEpisodes: 25, maxFactsPerEpisode: 200},
    before: before ? simulateSide(before, forRevision(before), controlState(before)) : null, after: simulateSide(after, forRevision(after), controlState(after)),
    liveEnabled: enabled, externalEffects: false, liveStateChanged: false, persisted: false, usageConsumed: false, limitations};
}
