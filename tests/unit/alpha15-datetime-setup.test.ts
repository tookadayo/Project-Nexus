import {describe, expect, it} from "vitest";
import {initialSetupTimeZone, type SetupStatus} from "../../apps/web/app/setup/model";

const status = (patch: Partial<SetupStatus> = {}): SetupStatus => ({
  state: "SETUP_REQUIRED", settingsRevision: 0, setupVersion: 2, existing: false,
  missing: ["review"], timeZoneSource: "missing",
  settings: {uiLanguage: "ja", timezone: "UTC", analysisScope: {mode: "include", channelIds: []}, helperChannelId: null, helperEnabled: false, managerRoleIds: [], newMemberGoals: []},
  ...patch,
});

describe("DT10 setup region provenance and confirmation", () => {
  it("suggests the browser region independently of language and UTC defaults", () => {
    for (const language of ["ja", "en"] as const) {
      const input = status(); input.settings.uiLanguage = language;
      expect(initialSetupTimeZone(input, () => "America/New_York")).toEqual({value: "America/New_York", source: "browser", confirmed: false});
    }
    expect(initialSetupTimeZone(status(), () => "UTC")).toEqual({value: "UTC", source: "browser", confirmed: false});
  });
  it("preserves a saved guild region before consulting a changed device", () => {
    const input = status({existing: true, timeZoneSource: "saved"}); input.settings.timezone = "Asia/Tokyo";
    expect(initialSetupTimeZone(input, () => { throw new Error("must not consult device"); })).toEqual({value: "Asia/Tokyo", source: "saved", confirmed: true});
    expect(initialSetupTimeZone(input, () => "Europe/Paris").value).toBe("Asia/Tokyo");
    expect(input.settings.timezone).toBe("Asia/Tokyo");
  });
  it("preserves a saved draft ahead of the guild region and device", () => {
    const input = status({existing: true, timeZoneSource: "saved"});
    input.draft = {id: "saved-draft", version: 2, settingsRevision: 4, appliedRevision: null, settings: {...input.settings, timezone: "Europe/Paris"}};
    expect(initialSetupTimeZone(input, () => { throw new Error("must not consult device"); })).toEqual({value: "Europe/Paris", source: "draft", confirmed: true});
  });
  it("never promotes a legacy fallback or an unavailable candidate to confirmed UTC", () => {
    for (const source of ["legacy", "missing", "invalid"] as const) {
      const input = status({existing: source !== "missing", timeZoneSource: source});
      expect(initialSetupTimeZone(input, () => { throw new Error("unavailable"); })).toEqual({value: "", source: "required", confirmed: false});
      expect(initialSetupTimeZone(input, () => "Moon/Unknown")).toEqual({value: "", source: "required", confirmed: false});
      expect(initialSetupTimeZone(input, () => undefined)).toEqual({value: "", source: "required", confirmed: false});
    }
  });
  it("retains saved settings from an older response without rewriting them", () => {
    const input = status({existing: true, timeZoneSource: undefined}); input.settings.timezone = "Asia/Tokyo";
    expect(initialSetupTimeZone(input, () => "America/New_York").value).toBe("Asia/Tokyo");
    expect(input.settings.timezone).toBe("Asia/Tokyo");
  });
});
