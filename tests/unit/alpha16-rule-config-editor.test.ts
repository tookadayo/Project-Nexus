/** Prepared acceptance source only; no operational profile/default is implied. */
import {expect,it} from "vitest";
import {emptyConfigDraft,editConfigDraft,configDraftMutation,ruleIds} from "../../apps/web/app/rules/config/model";
import {fixtureRuleConfig} from "../fixtures/alpha16-rules";
import {REGISTERED_SOURCE_TYPES} from "../../packages/rules/src/rule-catalog";
import {validateRuleConfig} from "../../packages/rules/src/rule-config";
function complete(){const config=fixtureRuleConfig();config.rules={...config.rules,"COMM-001":{...config.rules["COMM-001"]!,communityWindowPolicy:"SAME_WINDOW"}};return editConfigDraft(config);}
it("copies every typed rule/optional field but always builds a new disabled OPERATIONAL revision",()=>{
 const form=complete(),build=configDraftMutation(form,7,REGISTERED_SOURCE_TYPES);expect(build.ok).toBe(true);if(!build.ok)throw new Error("fixture");
 const definition=build.envelope.payload.definition;
 expect(build.envelope).toMatchObject({operation:"CONFIG_REVISE",expectedVersion:7,payload:{baseConfigVersion:7,definition:{configVersion:"8",profile:"OPERATIONAL",approval:"DISABLED",retentionApproved:false}}});
 expect(Object.keys(definition.rules).sort()).toEqual([...ruleIds].sort());expect(()=>validateRuleConfig(definition)).not.toThrow();
 expect(definition.rules["AUTO-001"]!.unknownRateLimit).toBe("0.2");expect(definition.rules["AUTO-002"]!.heartbeatGraceSeconds).toBe(300);expect(definition.rules["REPORT-001"]!.generationGraceSeconds).toBe(7200);
 expect(definition.rules["EVENT-001"]!.minimumEvents).toBe("5");expect(definition.rules["EXP-001"]!.minimumConsecutivePeriods).toBe(2);expect(definition.rules["COMM-001"]!.communityWindowPolicy).toBe("SAME_WINDOW");
});
it("keeps empty input empty and never coerces a blank optional field into zero",()=>{
 const empty=emptyConfigDraft();expect(empty.budgetMode).toBe("");expect(Object.values(empty.rules).every(row=>!row.configured&&Object.values(row.values).every(value=>value===""))).toBe(true);
 expect(configDraftMutation(empty,0,REGISTERED_SOURCE_TYPES)).toMatchObject({ok:false,field:"budgetMode"});
 const form=complete();form.rules["ONB-001"].values.minimumN="";expect(configDraftMutation(form,0,REGISTERED_SOURCE_TYPES)).toMatchObject({ok:false,field:"ONB-001.minimumN"});
 form.rules["ONB-001"].configured=false;form.rules["AUTO-002"].values.waitGraceSeconds="";
 const built=configDraftMutation(form,0,REGISTERED_SOURCE_TYPES);expect(built.ok).toBe(true);if(!built.ok)throw new Error("fixture");
 expect(built.envelope.payload.definition.rules["ONB-001"]).toBeUndefined();expect(built.envelope.payload.definition.rules["AUTO-002"]!.waitGraceSeconds).toBeUndefined();
});
it("preserves exact count/decimal input and rejects unsafe ranges, clocks and source types",()=>{
 const form=complete();form.rules["ONB-001"].values.minimumN="9223372036854775807";form.rules["ONB-001"].values.threshold="0.123456789123456789";
 const built=configDraftMutation(form,0,REGISTERED_SOURCE_TYPES);expect(built.ok).toBe(true);if(!built.ok)throw new Error("fixture");expect(built.envelope.payload.definition.rules["ONB-001"]).toMatchObject({minimumN:"9223372036854775807",threshold:"0.123456789123456789"});
 for(const [field,value] of [["minimumN","9223372036854775808"],["threshold","0.1234567891234567891"],["windowDays","367"],["freshnessSeconds","1e3"]] as const){const changed=complete();changed.rules["ONB-001"].values[field]=value;expect(configDraftMutation(changed,0,REGISTERED_SOURCE_TYPES).ok).toBe(false);}
 const zone=complete();zone.rules["ONB-001"].timeZone="";expect(configDraftMutation(zone,0,REGISTERED_SOURCE_TYPES)).toMatchObject({ok:false,field:"ONB-001.cooldown.timeZone"});
 const budget=complete();budget.budget.maxSteps="100001";expect(configDraftMutation(budget,0,REGISTERED_SOURCE_TYPES)).toMatchObject({ok:false,field:"budget.maxSteps"});
 const source=complete();source.sourceTypes.push("UNREGISTERED_SOURCE");expect(configDraftMutation(source,0,REGISTERED_SOURCE_TYPES)).toMatchObject({ok:false,field:"sourceTypes"});
});
it("requires an explicit replacement for a fixture-only cross-domain window policy",()=>{
 const form=editConfigDraft(fixtureRuleConfig());expect(form.rules["COMM-001"].communityWindowPolicy).toBe("UNSUPPORTED");
 expect(configDraftMutation(form,0,REGISTERED_SOURCE_TYPES)).toMatchObject({ok:false,field:"COMM-001.communityWindowPolicy"});
 form.rules["COMM-001"].communityWindowPolicy="SAME_WINDOW";expect(configDraftMutation(form,0,REGISTERED_SOURCE_TYPES).ok).toBe(true);
});
