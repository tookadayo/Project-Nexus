import { describe, expect, it } from "vitest";
import { assertTemplateHasNoCredentials, DEFAULT_PERSONAL_PREFERENCES, personalizationExpiry, personalizationFingerprint, personalizationMutation, preferenceSettings, type PersonalizationPolicy } from "../../packages/operations/src/alpha16-personalization";

describe("alpha16 Templates and Preference Center contracts", () => {
  it("accepts only the person's explicit non-escalating preferences", () => {
    expect(preferenceSettings.parse(DEFAULT_PERSONAL_PREFERENCES)).toEqual({suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"});
    expect(preferenceSettings.parse({suggestionDisplay: "HIDE", personalNotifications: "MUTED"})).toEqual({suggestionDisplay: "HIDE", personalNotifications: "MUTED"});
    for (const settings of [
      {suggestionDisplay: "HIDE", personalNotifications: "ALLOW_DM"},
      {...DEFAULT_PERSONAL_PREFERENCES, userId: "other-person"},
      {...DEFAULT_PERSONAL_PREFERENCES, adminOverride: true},
      {...DEFAULT_PERSONAL_PREFERENCES, token: "must-not-save"},
    ]) expect(() => preferenceSettings.parse(settings)).toThrow();
  });
  it("rejects caller identity, unknown fields and unpaired immutable source references", () => {
    const create = {operation: "TEMPLATE_CREATE", name: "Welcome", sourceFlowId: "source-flow", sourceRevision: 3};
    expect(personalizationMutation.parse(create)).toEqual(create);
    for (const input of [
      {...create, userId: "another-user"}, {...create, guildId: "another-guild"},
      {...create, definition: {}}, {...create, activate: true}, {...create, secret: "not-accepted"},
      {operation: "TEMPLATE_UPDATE", templateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedVersion: 1, name: "Updated", sourceFlowId: "source-flow"},
      {operation: "PREFERENCE_SAVE", expectedVersion: 0, settings: DEFAULT_PERSONAL_PREFERENCES, actorHash: "another-person"},
    ]) expect(() => personalizationMutation.parse(input)).toThrow();
  });
  it("requires independent lifetime classes and never infers 48h/14d or extends a source ceiling", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(() => personalizationExpiry(undefined, "TEMPLATE_DEFINITION", now)).toThrow("PERSONALIZATION_RETENTION_UNCONFIGURED");
    const policy: PersonalizationPolicy = {revision: "synthetic-fixture", classes: {TEMPLATE_DEFINITION: {seconds: 100, approvalReference: "fixture-only"}}};
    expect(personalizationExpiry(policy, "TEMPLATE_DEFINITION", now).toISOString()).toBe("2026-10-16T12:01:40.000Z");
    expect(personalizationExpiry(policy, "TEMPLATE_DEFINITION", now, new Date("2026-10-16T12:00:10Z")).toISOString()).toBe("2026-10-16T12:00:10.000Z");
    expect(() => personalizationExpiry(policy, "PERSONAL_PREFERENCE", now)).toThrow();
  });
  it("rejects explicit credential fields and recognizable credential payloads", () => {
    for (const value of [
      {authorization: "not-a-field"}, {nested: {accessToken: "not-a-field"}},
      {value: "Bearer secret-value"}, {value: "-----BEGIN PRIVATE KEY-----"},
      {value: "https://discord.com/api/webhooks/111/secret"},
    ]) expect(() => assertTemplateHasNoCredentials(value)).toThrow("TEMPLATE_CREDENTIAL_FORBIDDEN");
    expect(() => assertTemplateHasNoCredentials({name: "Welcome", body: [{kind: "end", id: "end"}]})).not.toThrow();
  });
  it("binds request equality to operation, immutable source and settings without property order differences", () => {
    expect(personalizationFingerprint({operation: "PREFERENCE_SAVE", expectedVersion: 1, settings: DEFAULT_PERSONAL_PREFERENCES})).toBe(personalizationFingerprint({settings: {personalNotifications: "UNCHANGED", suggestionDisplay: "SHOW"}, expectedVersion: 1, operation: "PREFERENCE_SAVE"}));
    expect(personalizationFingerprint({sourceRevision: 1})).not.toBe(personalizationFingerprint({sourceRevision: 2}));
  });
});
