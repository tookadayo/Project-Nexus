import {describe, expect, it} from "vitest";
import {emptySourceForm, sourceDefinition, type NativeSourceOptions} from "../../apps/web/app/rules/sources/model";
const flow = "11111111-1111-4111-8111-111111111111", activation = "22222222-2222-4222-8222-222222222222", channel = "333333333333333333";
const options: NativeSourceOptions = {settingsRevision: 7, timeZone: "Asia/Tokyo", flowVersions: [{id: flow, version: 2, targetVersion: "native-flow-v2"}], activationRevisions: [{id: activation, version: 3}], intakePanels: [], channels: [{id: channel, eligible: true, targetVersion: "c".repeat(64)}], events: [], reasonCodes: [], canConfigure: true, operationalApproval: false};
describe("alpha16 typed source UI input contract", () => {
  it("does not turn empty numeric inputs into executable defaults", () => {
    const form = {...emptySourceForm(options), campaignClass: "fixture-campaign", flowVersionId: flow, activationRevisionId: activation};
    for (const observationSeconds of ["", "0", "1.5", "2592001"]) expect(sourceDefinition({...form, observationSeconds}, options)).toBeNull();
    expect(sourceDefinition({...form, observationSeconds: "600"}, options)).toMatchObject({flowVersionId: flow, flowTargetVersion: "native-flow-v2", activationRevisionId: activation, observationSeconds: 600, windowDays: 7});
  });
  it("requires current saved candidates and settings rather than inventing missing references", () => {
    const form = {...emptySourceForm(options), campaignClass: "fixture-campaign", flowVersionId: flow, activationRevisionId: activation, observationSeconds: "600"};
    expect(sourceDefinition(form, {...options, flowVersions: []})).toBeNull();
    expect(sourceDefinition({...form, settingsRevision: 6}, options)).toBeNull();
  });
  it("does not accept unavailable channels or an undeclared comparison population", () => {
    const form = {...emptySourceForm(options), kind: "CHANNEL_PARTICIPATION_COHORT" as const, campaignClass: "fixture-campaign", channelId: channel, populationChannelIds: [channel], signals: ["message.sent" as const]};
    expect(sourceDefinition(form, options)).toMatchObject({channelId: channel, populationChannelIds: [channel], windowDays: 7});
    expect(sourceDefinition({...form, populationChannelIds: []}, options)).toBeNull();
    expect(sourceDefinition(form, {...options, channels: [{id: channel, eligible: false, targetVersion: "c".repeat(64)}]})).toBeNull();
    expect(sourceDefinition(form, {...options, channels: [{id: channel, eligible: true, targetVersion: null}]})).toBeNull();
  });
});
