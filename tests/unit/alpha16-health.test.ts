import {describe, expect, it} from "vitest";
import {healthValidity, legacyPreviewSummary, permissionObservation, sourceHealthView} from "../../packages/presentation/src/health-workspace";
import type {CapabilitySnapshot} from "../../packages/shared/src/community-model";
import type {IntegrationHealth} from "../../packages/shared/src/integration-health";
import type {Revision} from "../../packages/settings/src/revisions";
const at = "2026-10-16T12:00:00.000Z", old = "2026-10-16T11:00:00.000Z", next = "2026-10-16T12:01:00.000Z";
const health: IntegrationHealth = {gateway: "UNKNOWN", lastGatewayAt: null, intents: {members: "UNKNOWN", messages: "UNKNOWN", reactions: "UNKNOWN", polls: "UNKNOWN", voice: "UNKNOWN", scheduledEvents: "UNKNOWN", autoMod: "UNKNOWN"}, rest: "UNKNOWN", capabilityFresh: false, lastSuccessfulRefresh: null, lastRefreshFailure: null, lastErrorCategory: null, severe: true};
const snapshot = (checkedAt: string): CapabilitySnapshot => ({schemaVersion: 2, checkedAt, features: [], memberCount: null, afkChannelId: null, channelTypeCounts: {}, botPermissions: {manageGuild: true, manageRoles: false, sendMessages: true, highestRolePosition: null}, capabilities: {members: {status: "AVAILABLE", availableSince: null}}, channels: [], coverage: {observableChannels: 0, totalRelevantChannels: 0, ratio: null, blindSpots: [], privateThreads: "PARTIAL"}, onboarding: null, suggestions: [], incidents: {}, observedUsage: {}});
const revision = (definition: unknown): Revision => ({id: "a1680000-0000-4000-8000-000000000001", domain: "intervention", version: 1, definition, hash: "a".repeat(64), author: "DO_NOT_RETURN", state: "draft", published_at: null});
describe("alpha16 read-only readiness and health projections", () => {
  it.each([
    [null, null, false, "UNOBSERVED"], [null, null, true, "FAILED"],
    [old, at, false, "EXPIRED"], [at, next, false, "CURRENT"], [at, next, true, "FAILED"],
    [next, "2026-10-16T12:02:00Z", false, "UNKNOWN"], [old, null, false, "UNKNOWN"], ["invalid", next, false, "UNKNOWN"],
  ] as const)("keeps observed=%s expiry=%s failure=%s as %s", (observed, expires, failed, expected) => expect(healthValidity(observed, expires, at, failed)).toBe(expected));
  it("does not turn unobserved permission flags into denied or healthy booleans", () => {
    const value = permissionObservation(null, health, at);
    expect(value.validity).toBe("UNOBSERVED"); expect(value.botPermissions.every(item => item.observed === null && item.effective === null)).toBe(true);
    expect(value.requirementRegistry.state).toBe("UNVERIFIED");
  });
  it("keeps an expired true as historical evidence while withholding a current grant", () => {
    const value = permissionObservation(snapshot(old), health, at);
    expect(value.validity).toBe("EXPIRED"); expect(value.botPermissions.find(item => item.key === "manageGuild")).toEqual({key: "manageGuild", observed: true, effective: null});
    expect(value.capabilities[0]).toMatchObject({observed: "AVAILABLE", effective: "UNKNOWN"});
  });
  it("preserves refresh failure even when a prior saved snapshot has not expired", () => {
    const value = permissionObservation(snapshot(at), {...health, lastRefreshFailure: at}, at);
    expect(value.validity).toBe("FAILED"); expect(value.botPermissions.every(item => item.effective === null)).toBe(true);
  });
  it("preserves null last success, never-succeeded and coverage independently", () => {
    const value = sourceHealthView({observationId: "id", revision: "1", sourceType: "source_health_observation_v1", targetType: "GUILD", targetId: "guild", liveVersion: "1", observedAt: old, expiresAt: at, quality: "UNKNOWN", state: "UNKNOWN", lastSuccessfulIngestAt: null, neverSucceeded: null, coverage: null}, at);
    expect(value).toMatchObject({validity: "EXPIRED", lastSuccessfulIngestAt: null, neverSucceeded: null, coverage: null, state: "UNKNOWN"});
    expect(sourceHealthView({...value, expiresAt: next, observedAt: at, neverSucceeded: true}, at).neverSucceeded).toBe(true);
  });
  it("withholds expired source-health values even before physical purge", () => {
    const value = sourceHealthView({observationId: "id", revision: "1", sourceType: "source_health_observation_v1", targetType: "GUILD", targetId: "guild", liveVersion: "1", observedAt: old, expiresAt: at, quality: "SUFFICIENT", state: "HEALTHY", lastSuccessfulIngestAt: old, neverSucceeded: false, coverage: "1"}, at);
    expect(value).toMatchObject({validity: "EXPIRED", evidenceAvailable: false, state: "UNKNOWN", quality: "UNKNOWN", coverage: null, lastSuccessfulIngestAt: null, neverSucceeded: null});
  });
  it("compares immutable configuration metadata without returning bodies, authors or simulating effects", () => {
    const before = revision({name: "Original", actions: [{content: "PRIVATE_BODY"}]}), after = {...revision({name: "Changed", actions: [{content: "OTHER_PRIVATE_BODY"}]}), version: 2};
    const value = legacyPreviewSummary(before, after, false), wire = JSON.stringify(value);
    expect(value.changedFields).toEqual(["actions", "name"]); expect(value.before?.version).toBe(1); expect(value.after.version).toBe(2);
    expect(value).toMatchObject({planAvailable: false, externalEffects: false, liveStateChanged: false, executionSimulation: {available: false}});
    expect(wire).not.toContain("PRIVATE_BODY"); expect(wire).not.toContain("DO_NOT_RETURN"); expect(before.version).toBe(1);
  });
});
