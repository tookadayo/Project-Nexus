import {describe, expect, it} from "vitest";
import {changedSettings, pollDelay, problemFor, selectedScope, setupPatch, validTimezone, type SetupSettings} from "../../apps/web/app/setup/model";

const settings: SetupSettings = {
  uiLanguage: "ja", timezone: "Asia/Tokyo", analysisScope: {mode: "exclude", channelIds: ["111111111111111111"], excludedChannelIds: ["222222222222222222"]},
  helperChannelId: null, helperEnabled: true, managerRoleIds: ["333333333333333333"], newMemberGoals: ["reply", "playtest"], goalPreset: "early_access",
};

describe("alpha15 Web setup preserves the existing configuration", () => {
  it("does not translate team/goals or include feature activation in a settings patch", () => {
    expect(setupPatch(settings, {...settings})).toEqual({});
    expect(setupPatch(settings, {...settings, timezone: "UTC", helperChannelId: "444444444444444444"})).toEqual({timezone: "UTC", helperChannelId: "444444444444444444"});
    expect(changedSettings(settings, {...settings, helperEnabled: false, goalPreset: null})).toEqual([]);
  });
  it("can explicitly revert a saved draft field to its applied value", () => {
    const draft = {...settings, timezone: "UTC"};
    expect(setupPatch(draft, settings)).toEqual({timezone: "Asia/Tokyo"});
  });
  it("keeps explicit exclusions and unavailable old references while rejecting new unknown IDs", () => {
    const original = {mode: "include" as const, channelIds: ["111111111111111111"], excludedChannelIds: ["222222222222222222"]};
    const candidates = [{id: "444444444444444444", name: "Public", type: 0}, {id: "555555555555555555", name: "Category", type: 4}];
    expect(selectedScope(original, ["111111111111111111", "444444444444444444", "666666666666666666", "555555555555555555"], candidates)).toEqual({mode: "include", channelIds: ["111111111111111111", "444444444444444444"], excludedChannelIds: ["222222222222222222"]});
    expect(selectedScope(original, [], candidates).channelIds).toEqual([]);
    expect(selectedScope(settings.analysisScope, ["444444444444444444"], candidates)).toEqual({mode: "include", channelIds: ["444444444444444444"], excludedChannelIds: ["222222222222222222", "111111111111111111"]});
  });
  it("distinguishes current insufficient permission, unavailable verification, eligibility and version conflicts", () => {
    expect(problemFor("ADMIN_REQUIRED", 403)).toBe("PERMISSION");
    expect(problemFor("AUTHORIZATION_UNAVAILABLE", 503)).toBe("UNAVAILABLE");
    expect(problemFor("AUTHORIZATION_EXPIRED", 403)).toBe("UNAVAILABLE");
    expect(problemFor("BETA_UNAVAILABLE", 403)).toBe("BETA");
    expect(problemFor("REVISION_CONFLICT", 409)).toBe("CONFLICT");
  });
  it("uses bounded polling with a manual retry boundary", () => {
    expect(pollDelay(0)).toBe(2000);
    expect(pollDelay(10000)).toBe(5000);
    expect(pollDelay(59999)).toBe(5000);
    expect(pollDelay(60000)).toBeNull();
  });
  it("validates IANA time zones without replacing saved dates or choosing the device zone", () => {
    expect(validTimezone("Asia/Tokyo")).toBe(true);
    expect(validTimezone("America/New_York")).toBe(true);
    expect(validTimezone("")).toBe(false);
    expect(validTimezone("Moon/Unknown")).toBe(false);
  });
});
