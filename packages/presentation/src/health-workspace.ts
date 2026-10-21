import {z} from "zod";
import {sql, tenant, type Database, type Tx} from "../../db/src/index";
import {assert, type Scope} from "../../shared/src/index";
import type {CapabilitySnapshot} from "../../shared/src/community-model";
import type {IntegrationHealth} from "../../shared/src/integration-health";
import {SettingsService, type Actor} from "../../settings/src/index";
import {domainRevisions} from "../../settings/src/domain-config";
import type {ConfigDomain, Revision} from "../../settings/src/revisions";
import {EntitlementService} from "../../settings/src/billing/entitlements";
import {actorPermissions, operationsAccess} from "../../operations/src/policy";
import {latestCapability} from "../../lifecycle/src/discovery";
import {integrationHealth} from "../../lifecycle/src/observation";
import {acquireRuleScopeLocks, ruleScopeLockSet} from "../../rules/src/locks";
import {SOURCE_ADAPTER_CATALOG} from "../../rules/src/source-adapters";
import {boundedPreviewDefinition, previewSavedLifecycle, type LifecycleExecutionPreview, type LifecyclePreviewReplay} from "./lifecycle-preview";

export type HealthValidity = "CURRENT" | "EXPIRED" | "UNOBSERVED" | "FAILED" | "UNKNOWN";
/** Freshness is a display validity bound, never a new physical retention policy. */
export function healthValidity(observedAt: string | null, expiresAt: string | null, now: string, failed = false): HealthValidity {
  if (observedAt === null) return failed ? "FAILED" : "UNOBSERVED";
  const observed = Date.parse(observedAt), expires = expiresAt === null ? NaN : Date.parse(expiresAt), at = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(at) || observed > at || !Number.isFinite(expires) || expires <= observed) return "UNKNOWN";
  if (expires <= at) return "EXPIRED";
  return failed ? "FAILED" : "CURRENT";
}
const expiry = (at: string | null, milliseconds: number) => at && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at) + milliseconds).toISOString() : null;
export interface HealthSource {
  observationId: string; revision: string; sourceType: string; targetType: string; targetId: string;
  liveVersion: string; observedAt: string; expiresAt: string; validity: HealthValidity;
  evidenceAvailable: boolean; quality: string; state: string; lastSuccessfulIngestAt: string | null; neverSucceeded: boolean | null; coverage: string | null;
}
export function sourceHealthView(row: Omit<HealthSource, "validity" | "evidenceAvailable">, now: string): HealthSource {
  // Never replace null last-success/coverage with the read time or zero.
  const validity = healthValidity(row.observedAt, row.expiresAt, now, row.state === "FAILED");
  const evidenceAvailable = validity === "CURRENT" || validity === "FAILED";
  // Expiry is a read gate even if physical purge has not run yet. Only minimal
  // identity/time metadata describes the expired observation on this screen.
  return {...row, validity, evidenceAvailable, ...(evidenceAvailable ? {} : {quality: "UNKNOWN", state: "UNKNOWN", lastSuccessfulIngestAt: null, neverSucceeded: null, coverage: null})};
}
export function permissionObservation(snapshot: CapabilitySnapshot | null, health: IntegrationHealth, now: string) {
  const observedAt = snapshot?.checkedAt ?? null, expiresAt = expiry(observedAt, 3600000);
  const failure = health.lastRefreshFailure !== null && (health.lastSuccessfulRefresh === null || Date.parse(health.lastRefreshFailure) > Date.parse(health.lastSuccessfulRefresh));
  const validity = healthValidity(observedAt, expiresAt, now, failure);
  return {
    observedAt, expiresAt, validity,
    // Values describe the original observation. A stale true is never an effective grant.
    botPermissions: (['manageGuild', 'manageRoles', 'sendMessages'] as const).map(key => ({
      key, observed: snapshot?.botPermissions?.[key] ?? null,
      effective: validity === "CURRENT" ? snapshot?.botPermissions?.[key] ?? null : null,
    })),
    capabilities: Object.entries(snapshot?.capabilities ?? {}).map(([key, value]) => ({key, observed: value.status, effective: validity === "CURRENT" ? value.status : "UNKNOWN"})),
    requirementRegistry: {state: "UNVERIFIED" as const, reasonCode: "APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED"},
  };
}
type RevisionSummary = {id: string; domain: ConfigDomain; version: number; hash: string; state: string; publishedAt: string | null};
type RevisionMetadata = Pick<Revision, "id" | "domain" | "version" | "hash" | "state" | "published_at">;
const revisionSummary = (value: RevisionMetadata): RevisionSummary => ({id: value.id, domain: value.domain, version: value.version, hash: value.hash, state: value.state, publishedAt: value.published_at?.toISOString() ?? null});
/** Compare registered configuration fields without copying message contents or actor identity into a new response. */
export function legacyPreviewSummary(before: Revision | null, after: Revision, planAvailable: boolean) {
  const old = before?.definition && typeof before.definition === "object" ? before.definition as Record<string, unknown> : {};
  const next = after.definition && typeof after.definition === "object" ? after.definition as Record<string, unknown> : {};
  return {kind: "CONFIGURATION_COMPARISON" as const, before: before ? revisionSummary(before) : null, after: revisionSummary(after),
    changedFields: [...new Set([...Object.keys(old), ...Object.keys(next)])].sort().filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key])),
    planAvailable, externalEffects: false as const, liveStateChanged: false as const,
    executionSimulation: {available: false as const, reasonCode: "LEGACY_PREVIEW_COMPARES_CONFIGURATION_ONLY"}};
}
export type LegacyLifecyclePreview = Omit<ReturnType<typeof legacyPreviewSummary>, "executionSimulation"> & {executionSimulation: LifecycleExecutionPreview | ReturnType<typeof legacyPreviewSummary>["executionSimulation"]};
interface SourceRow {id: string; revision: string; source_id: string; target_type: string; target_id: string; live_version: string; observed_at: Date; expires_at: Date; quality: string; health_state: string; last_success_at: Date | null; never_succeeded: boolean | null; coverage: string | null;}
export interface HealthOverview {
  guildId: string; readAt: string;
  readiness: {state: "NEEDS_ATTENTION" | "UNVERIFIED"; settingsRevision: number; onboardingMode: string; activationRevision: RevisionSummary | null; onboardingRevision: RevisionSummary | null; reasonCodes: string[]};
  data: {gateway: IntegrationHealth["gateway"]; gatewayObservedAt: string | null; gatewayExpiresAt: string | null; gatewayValidity: HealthValidity;
    intents: IntegrationHealth["intents"]; rest: IntegrationHealth["rest"]; lastSuccessfulRefresh: string | null; lastRefreshFailure: string | null;
    coverage: {ratio: number | null; state: string; observedAt: string | null; validity: HealthValidity};
    sources: HealthSource[]; sourceSchema: "AVAILABLE" | "UNAVAILABLE"; truncated: boolean};
  permission: ReturnType<typeof permissionObservation> & {viewerCheckedAt: string; viewerExpiresAt: string; nexusPermissions: readonly string[]};
  plan: {key: string; features: {key: string; allowed: boolean}[]};
  rules: {enabled: false; reasonCodes: string[]; sources: readonly {sourceType: string; compatibility: string; reason: string}[]};
  lifecycleRevisions: RevisionSummary[]; lifecycleRevisionsTruncated: boolean;
}
/** READ-only facade. No refresh jobs, Fact correction, retention copies or runtime writes. */
export class HealthWorkspaceService {
  constructor(readonly db: Database) {}
  private async read<T>(scope: Scope, actor: Actor, work: (tx: Tx, now: Date) => Promise<T>, readOnly = false) {
    assert(actor.source === "WEB_DASHBOARD" || actor.source === "DISCORD_PANEL", "CURRENT_USER_REQUIRED", 403);
    return this.db.transaction().execute(async tx => {
      // Keep READ COMMITTED: a repeatable-read snapshot taken by a blocking
      // advisory-lock SELECT could predate the deletion that owned that lock.
      if (readOnly) await sql`SET TRANSACTION READ ONLY`.execute(tx);
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
      await operationsAccess(tx, scope, actor, "READ");
      assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(scope)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
      const now = (await sql<{now: Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      return work(tx, now);
    });
  }
  async overview(scope: Scope, actor: Actor, authority: {checkedAt: number; scope: Scope}): Promise<HealthOverview> {
    assert(authority.scope.organizationId === scope.organizationId && authority.scope.guildId === scope.guildId, "AUTHORIZATION_SCOPE_MISMATCH", 403);
    return this.read<HealthOverview>(scope, actor, async (tx, now) => {
      assert(Number.isFinite(authority.checkedAt) && now.getTime() >= authority.checkedAt && now.getTime() - authority.checkedAt <= 10000, "AUTHORIZATION_EXPIRED", 403);
      const settings = new SettingsService(tx), revisions = domainRevisions(tx), entitlements = new EntitlementService(tx);
      const [cfg, snapshot, health, activation, onboarding, nexusPermissions, plan, schema, storedRevisions] = await Promise.all([
        settings.get(scope, tx), latestCapability(tx, scope), integrationHealth(tx, scope, now), revisions.current(scope, "activation", tx), revisions.current(scope, "onboarding", tx),
        actorPermissions(tx, scope, actor), entitlements.effective(scope, now),
        sql<{present: boolean}>`SELECT to_regclass('rule_source_health') IS NOT NULL AS present`.execute(tx),
        sql<RevisionMetadata>`SELECT id,domain,version,hash,state,published_at FROM guild_config_revisions WHERE ${tenant(scope)} AND domain IN ('activation','onboarding','intervention','experiment','privacy') ORDER BY version DESC,id LIMIT 101`.execute(tx),
      ]);
      const rows = schema.rows[0]?.present ? (await sql<SourceRow>`SELECT DISTINCT ON(source_id,target_type,target_id) id,revision,source_id,target_type,target_id,live_version,observed_at,expires_at,quality,health_state,last_success_at,never_succeeded,coverage::text FROM rule_source_health WHERE ${tenant(scope)} ORDER BY source_id,target_type,target_id,observed_at DESC,id DESC LIMIT 101`.execute(tx)).rows : [];
      const readAt = now.toISOString(), permission = permissionObservation(snapshot, health, readAt);
      const reasonCodes = ["APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED", ...(cfg.revision === 0 ? ["SETTINGS_NOT_SAVED"] : []), ...(!activation ? ["ACTIVATION_NOT_CONFIGURED"] : []), ...(health.gateway !== "CONNECTED" ? ["GATEWAY_NOT_CURRENTLY_CONNECTED"] : []), ...(permission.validity !== "CURRENT" ? ["PERMISSION_OBSERVATION_NOT_CURRENT"] : [])];
      const features = await Promise.all((['coverage_health', 'interventions', 'experiments', 'custom_activation', 'improvement_tracking'] as const).map(async key => ({key, allowed: await entitlements.can(scope, key)})));
      return {
        guildId: scope.guildId, readAt,
        readiness: {state: !activation || health.gateway !== "CONNECTED" ? "NEEDS_ATTENTION" : "UNVERIFIED", settingsRevision: cfg.revision, onboardingMode: cfg.onboardingMode,
          activationRevision: activation ? revisionSummary(activation) : null, onboardingRevision: onboarding ? revisionSummary(onboarding) : null, reasonCodes},
        data: {gateway: health.gateway, gatewayObservedAt: health.lastGatewayAt, gatewayExpiresAt: expiry(health.lastGatewayAt, 90000),
          gatewayValidity: healthValidity(health.lastGatewayAt, expiry(health.lastGatewayAt, 90000), readAt), intents: health.intents, rest: health.rest,
          lastSuccessfulRefresh: health.lastSuccessfulRefresh, lastRefreshFailure: health.lastRefreshFailure,
          coverage: {ratio: snapshot?.coverage.ratio ?? null, state: snapshot?.coverage.coverageState ?? "UNKNOWN", observedAt: snapshot?.checkedAt ?? null, validity: permission.validity},
          sourceSchema: schema.rows[0]?.present ? "AVAILABLE" : "UNAVAILABLE", truncated: rows.length > 100,
          sources: rows.slice(0, 100).map(row => sourceHealthView({observationId: row.id, revision: row.revision, sourceType: row.source_id, targetType: row.target_type, targetId: row.target_id,
            liveVersion: row.live_version, observedAt: row.observed_at.toISOString(), expiresAt: row.expires_at.toISOString(), quality: row.quality, state: row.health_state,
            lastSuccessfulIngestAt: row.last_success_at?.toISOString() ?? null, neverSucceeded: row.never_succeeded, coverage: row.coverage}, readAt))},
        permission: {...permission, viewerCheckedAt: new Date(authority.checkedAt).toISOString(), viewerExpiresAt: new Date(authority.checkedAt + 10000).toISOString(), nexusPermissions},
        plan: {key: plan.plan, features}, rules: {enabled: false, reasonCodes: ["OPERATIONAL_CONFIG_NOT_ACTIVATED"], sources: SOURCE_ADAPTER_CATALOG},
        lifecycleRevisions: storedRevisions.rows.slice(0, 100).map(revisionSummary), lifecycleRevisionsTruncated: storedRevisions.rows.length > 100,
      };
    });
  }
  async lifecyclePreview(scope: Scope, actor: Actor, revisionId: string, replay?: LifecyclePreviewReplay, authority?: {checkedAt: number; scope: Scope}): Promise<LegacyLifecyclePreview> {
    z.uuid().parse(revisionId);
    const checkAuthority = (at: number) => {if (authority) assert(authority.scope.organizationId === scope.organizationId && authority.scope.guildId === scope.guildId && at >= authority.checkedAt && at - authority.checkedAt <= 10000, "AUTHORIZATION_EXPIRED", 403);};
    return this.read(scope, actor, async (tx, now) => {
      checkAuthority(now.getTime());
      // Original validator and original scoped immutable revisions remain authoritative.
      const revisions = domainRevisions(tx), selected = await revisions.get(scope, revisionId, tx);
      assert(boundedPreviewDefinition(selected.definition), "PREVIEW_COMPLEXITY_LIMIT", 400);
      const value = await revisions.preview(scope, revisionId), entitlement = new EntitlementService(tx);
      const planAvailable = value.after.domain === "activation" ? await entitlement.canDefineActivation(scope, value.after.definition)
        : value.after.domain === "experiment" ? await entitlement.can(scope, "experiments")
        : value.after.domain === "intervention" ? await entitlement.can(scope, "interventions") : true;
      const executionSimulation = await previewSavedLifecycle(tx, scope, actor, value.before, value.after, planAvailable, now, replay);
      checkAuthority(Date.now());
      return {...legacyPreviewSummary(value.before, value.after, planAvailable), executionSimulation};
    }, true);
  }
}
