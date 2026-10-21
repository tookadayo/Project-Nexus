import type {HealthOverview, LegacyLifecyclePreview} from "../../packages/presentation/src/health-workspace";
export const healthGuild = "884111111111111111";
export const healthRevision = "a1680000-0000-4000-8000-000000000001";
/** Synthetic UI data only. No operational source health is generated from this fixture. */
export function healthFixture(at = "2026-10-16T12:00:00.000Z"): HealthOverview {
  const later = (seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
  return {
    guildId: healthGuild, readAt: at,
    readiness: {state: "NEEDS_ATTENTION", settingsRevision: 3, onboardingMode: "fallback", activationRevision: null, onboardingRevision: null, reasonCodes: ["APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED", "ACTIVATION_NOT_CONFIGURED", "GATEWAY_NOT_CURRENTLY_CONNECTED"]},
    data: {gateway: "UNKNOWN", gatewayObservedAt: null, gatewayExpiresAt: null, gatewayValidity: "UNOBSERVED", intents: {members: "UNKNOWN", messages: "UNKNOWN", reactions: "UNKNOWN", polls: "UNKNOWN", voice: "UNKNOWN", scheduledEvents: "UNKNOWN", autoMod: "UNKNOWN"},
      rest: "UNKNOWN", lastSuccessfulRefresh: null, lastRefreshFailure: null, coverage: {ratio: null, state: "UNKNOWN", observedAt: null, validity: "UNOBSERVED"}, sources: [], sourceSchema: "AVAILABLE", truncated: false},
    permission: {observedAt: null, expiresAt: null, validity: "UNOBSERVED", botPermissions: [{key: "manageGuild", observed: null, effective: null}, {key: "manageRoles", observed: null, effective: null}, {key: "sendMessages", observed: null, effective: null}],
      capabilities: [], requirementRegistry: {state: "UNVERIFIED", reasonCode: "APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED"}, viewerCheckedAt: at, viewerExpiresAt: later(10), nexusPermissions: ["READ"]},
    plan: {key: "FREE", features: [{key: "coverage_health", allowed: true}, {key: "experiments", allowed: false}]},
    rules: {enabled: false, reasonCodes: ["OPERATIONAL_CONFIG_NOT_ACTIVATED"], sources: [{sourceType: "permission_observation_v1", compatibility: "BLOCKED_UNVERIFIED", reason: "APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED"}]},
    lifecycleRevisions: [{id: healthRevision, domain: "intervention", version: 2, hash: "a".repeat(64), state: "draft", publishedAt: null}], lifecycleRevisionsTruncated: false,
  };
}
export const healthPreviewFixture: LegacyLifecyclePreview = {
  kind: "CONFIGURATION_COMPARISON", before: null, after: {id: healthRevision, domain: "intervention", version: 2, hash: "a".repeat(64), state: "draft", publishedAt: null},
  changedFields: ["actions", "eligibility"], planAvailable: false, externalEffects: false, liveStateChanged: false,
  executionSimulation: {available: false, reasonCode: "LEGACY_PREVIEW_COMPARES_CONFIGURATION_ONLY"},
};
