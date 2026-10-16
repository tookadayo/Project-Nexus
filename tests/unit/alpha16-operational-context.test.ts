import {describe, expect, it} from "vitest";
import {CASE_CATALOG} from "../../packages/rules/src/catalog";
import {caseFieldSourceKind, caseOperationalSourceReadiness, operationalMutation, operationalProfileSave, parseOperatorFields, profileConfigFields, validateOperationalProfile} from "../../packages/rules/src/operational-context-contract";
import {operationalContextPlugins} from "../../packages/rules/src/operational-context-plugins";
import {evaluateCase} from "../../packages/rules/src/case-engine";
import {CASE_FIXTURES_13_20} from "../fixtures/alpha16-cases-13-20";
const definition = (caseId: string) => CASE_CATALOG.find((item) => item.id === caseId)!;
const profile = {operation: "PROFILE_SAVE", caseId: "CASE18", expectedVersion: 0, enabled: true, budget: {maxDepth: 16, maxSteps: 64, maxOperations: 256, maxInputs: 128}, aggregateBudget: {maxSteps: 128, maxOperations: 1024, maxInputs: 512}, values: {}, metricConfigs: {}};
describe("alpha16 closed operational context contracts", () => {
  it("separates implemented operator/native sources from original unavailable source mappings", () => {
    expect(CASE_CATALOG).toHaveLength(20);
    for (const def of CASE_CATALOG) {expect(def.sourceMappings[0]?.confirmed).toBe(false); for (const field of def.fields) {const kind = caseFieldSourceKind(def.id, field.id), mapping = def.sourceMappings.find((source) => source.id === field.sourceId)!; expect(mapping.confirmed).toBe(kind !== "UNAVAILABLE"); if (mapping.confirmed) expect(mapping.codeRefs).toContain("packages/rules/src/operational-context.ts:readStoredOperationalCase");}}
    expect(caseFieldSourceKind("CASE17", "reportChannel.actualPermission")).toBe("NATIVE"); expect(caseFieldSourceKind("CASE20", "locked")).toBe("NATIVE");
  });
  it("rejects actual permission, cohort, no-contact and measured counters as operator answers", () => {
    for (const [caseId, fields] of [["CASE01", {"onb.actualAccess": "ALLOWED"}], ["CASE02", {"welcome.noContact": false}], ["CASE05", {"cohort.newCurrent": 0.7}], ["CASE13", {actionableCount: 10}], ["CASE17", {"reportChannel.actualPermission": "PUBLIC"}], ["CASE20", {channelType: "FORUM"}]] as const) expect(() => parseOperatorFields(definition(caseId), {...fields}, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow("OPERATOR_FIELD_NOT_ALLOWED");
  });
  it("uses catalog enums and explicit nullable metadata, without filling omitted fields", () => {
    expect(parseOperatorFields(definition("CASE18"), {barrierReport: "REPORTED"}, "resource")).toEqual({barrierReport: "REPORTED"});
    expect(() => parseOperatorFields(definition("CASE18"), {barrierReport: "An unrestricted narrative"}, "resource")).toThrow("OPERATOR_ENUM_INVALID");
    expect(parseOperatorFields(definition("CASE16"), {incidentResolvedAt: null}, "resource")).toEqual({incidentResolvedAt: null});
  });
  it("requires role ownership and canonical duplicate references without a personal owner field", () => {
    const def = definition("CASE09"), id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(() => parseOperatorFields(def, {"request.ownerAssigned": true}, id)).toThrow("REQUEST_OWNER_INVALID");
    expect(() => parseOperatorFields(def, {"request.status": "DUPLICATE", "request.duplicateOfRequestId": id}, id)).toThrow("REQUEST_DUPLICATE_INVALID");
    expect(() => parseOperatorFields(def, {"request.ownerId": "person"}, id)).toThrow("OPERATOR_FIELD_NOT_ALLOWED");
  });
  it("does not accept client clocks, provenance, approval, permission claims, free text or code", () => {
    const body = {operation: "CONTEXT_SAVE", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedVersion: 0, caseId: "CASE18", target: {targetType: "ACCESSIBILITY", targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", liveVersion: null}, fields: {barrierReport: "REPORTED"}, baseResultId: null};
    expect(operationalMutation.parse(body)).toEqual(body); for (const extra of [{rootTarget:{targetType:"EVENT_PROGRAM",targetId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",liveVersion:"1"}},{sourceKind: "SYSTEM_OBSERVATION"}, {observedAt: "2026-10-16T12:00:00Z"}, {expiresAt: "2100-01-01T00:00:00Z"}, {approved: true}, {actorHash: "other"}, {body: "message text"}, {sql: "SELECT 1"}]) expect(() => operationalMutation.parse({...body, ...extra})).toThrow();
  });
  it("requires all operational budgets explicitly and never supplies fixture thresholds", () => {
    expect(() => operationalProfileSave.parse({...profile, budget: undefined})).toThrow(); const parsed = operationalProfileSave.parse({...profile, values: {"CASE18.cooldownSeconds": {value: 60, unit: "seconds"}}}); expect(validateOperationalProfile(definition("CASE18"), parsed)).toBeUndefined();
    expect(() => validateOperationalProfile(definition("CASE18"), operationalProfileSave.parse(profile))).toThrow("CASE_PROFILE_INCOMPLETE");
    expect(validateOperationalProfile(definition("CASE18"), operationalProfileSave.parse({...profile, enabled: false}))).toBeUndefined();
    const incomplete = operationalProfileSave.parse({...profile, caseId: "CASE14"}); expect(() => validateOperationalProfile(definition("CASE14"), incomplete)).toThrow("CASE_PROFILE_INCOMPLETE"); expect(profileConfigFields(definition("CASE14")).map((field) => field.id)).toContain("queueAgeThresholdMinutes");
  });
  it("declares each Case ACTION cooldown with its exact seconds unit and a positive lower bound", () => {
    for (const def of CASE_CATALOG) expect(profileConfigFields(def).filter(field => field.id.endsWith(".cooldownSeconds"))).toEqual([{id: `${def.id}.cooldownSeconds`, unit: "seconds", minimum: 1}]);
    for (const value of [0, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => validateOperationalProfile(definition("CASE18"), operationalProfileSave.parse({...profile, values: {"CASE18.cooldownSeconds": {value, unit: "seconds"}}}))).toThrow("CASE_PROFILE_CONFIG_RANGE");
    for (const values of [{"CASE18.cooldownSeconds": {value: 60, unit: "minutes"}}, {"CASE17.cooldownSeconds": {value: 60, unit: "seconds"}}]) expect(() => validateOperationalProfile(definition("CASE18"), operationalProfileSave.parse({...profile, values}))).toThrow("CASE_PROFILE_CONFIG_INVALID");
    expect(() => operationalProfileSave.parse({...profile, values: {"CASE18.cooldownSeconds": {value: -1, unit: "seconds"}}})).toThrow();
  });
  it("connects an explicitly synthetic approved profile to the existing ACTION gate without a cooldown fallback", () => {
    const row = structuredClone(CASE_FIXTURES_13_20.find(fixture => fixture.caseId === "CASE18" && fixture.expected.outcome === "ACTION")!);
    row.profile.kind = "OPERATIONAL"; row.profile.approved = true; row.profile.retentionApproved = true;
    const evaluate = () => evaluateCase(definition(row.caseId), row.context, row.profile, row.registry, {now: () => Date.parse(row.context.evaluationAsOf)});
    expect(evaluate()).toMatchObject({outcome: "ACTION", publishable: true});
    delete row.profile.values["CASE18.cooldownSeconds"];
    expect(evaluate()).toMatchObject({outcome: "DISABLED", reasonCode: "CASE_COOLDOWN_NOT_APPROVED", action: null});
  });
  it("checks exact case config names, units and finite ratio ranges", () => {
    for (const values of [{arbitrary: {value: 1, unit: "count"}}, {queueAgeThresholdMinutes: {value: 120, unit: "seconds"}}, {assignmentConcentrationThreshold: {value: 1.1, unit: "ratio"}}]) {const parsed = operationalProfileSave.parse({...profile, caseId: "CASE14", enabled: false, values}); expect(() => validateOperationalProfile(definition("CASE14"), parsed)).toThrow();}
    expect(() => operationalProfileSave.parse({...profile, values: {unknown: {value: Number.NaN, unit: "count"}}})).toThrow();
  });
  it("registers only finite implemented native readers and keeps nonexistent outcome/viewing/alert sources unavailable",()=>{const plugins=operationalContextPlugins();expect(plugins.map(plugin=>plugin.id)).toEqual(["CASE_01_12_NATIVE","ROLE_ACCESS_NATIVE","CASE_13_20_NATIVE"]);for(const plugin of plugins)for(const [caseId,fields]of Object.entries(plugin.supportedFields))for(const id of fields)expect(caseFieldSourceKind(caseId,id)).toBe(["CASE03","CASE04"].includes(caseId)?"UNAVAILABLE":"NATIVE");for(const [caseId,id]of [["CASE02","welcome.noContact"],["CASE03","support.askerOutcome"],["CASE04","support.askerExplicitOutcome"],["CASE05","activity.optInInterest"],["CASE07","format.preferredFormat"],["CASE16","platformAlertType"],["CASE19","authorizedAggregateViewing.sourceAvailable"]] as const)expect(caseFieldSourceKind(caseId,id)).toBe("UNAVAILABLE");});
  it("does not permit source configuration to include observations, permission claims, bodies or unknown fields",()=>{const plugin=operationalContextPlugins().find(value=>value.id==="ROLE_ACCESS_NATIVE")!,config={destinationKind:"CASE_CHANNEL",channelId:"877711111111111111",channelVersion:"a".repeat(64),representativeRoleIds:["877722222222222222"]};expect(plugin.parseConfig(config)).toEqual(config);for(const extra of [{actualPermission:"PUBLIC"},{observedAt:"2026-10-16T00:00:00Z"},{memberId:"877733333333333333"},{body:"unrestricted text"},{sql:"SELECT 1"}])expect(()=>plugin.parseConfig({...config,...extra})).toThrow();});
  it("closes the missing HELP issue relation without blocking other source-ready cases",()=>{for(const id of ["CASE03","CASE04"])expect(caseOperationalSourceReadiness(id)).toEqual({available:false,reasonCode:"CASE_ISSUE_TARGET_SOURCE_UNAVAILABLE"});expect(caseOperationalSourceReadiness("CASE18")).toEqual({available:true,reasonCode:null});});
});
