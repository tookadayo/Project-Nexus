/** Source-only acceptance vectors; operational enablement is never inferred. */
import {expect,it} from "vitest";
import {CASE_FIXTURES_01_12} from "../fixtures/alpha16-cases-01-12";
import {fixtureInput,fixtureRuleConfig} from "../fixtures/alpha16-rules";
import {sealRuleInput,hashRuleValue,verifySealedRuleInput} from "../../packages/rules/src/facts";
import {evaluateRules} from "../../packages/rules/src/rule-engine";
import {bindCurrentCaseRoots,caseEnvelopeVersions,evaluatePlatform} from "../../packages/rules/src/pipeline";
import {caseSnapshotHash,type CaseSnapshotInput} from "../../packages/rules/src/case-storage";
import {canonicalCaseHash} from "../../packages/rules/src/case-engine";
import {CASE_CATALOG} from "../../packages/rules/src/catalog";
import {enqueueRequest} from "../../packages/rules/src/domain";

const aggregateBudget={maxSteps:1000,maxOperations:10000,maxInputs:10000};
function context(id:string,guildId:string):CaseSnapshotInput{
 const row=structuredClone(CASE_FIXTURES_01_12.find(value=>value.id===id)!);
 row.context.guildId=guildId;
 for(const field of Object.values(row.context.fields))field.authorityScope.guildId=guildId;
 return {caseId:row.caseId,context:row.context,profile:row.profile,registry:row.registry};
}
function sealedCase(entry:CaseSnapshotInput){
 return {...entry,seal:{snapshotId:"00000000-0000-4000-8000-000000000999",caseId:entry.caseId,revision:CASE_CATALOG.find(value=>value.id===entry.caseId)!.revision,contentHash:caseSnapshotHash(entry),profileHash:canonicalCaseHash(entry.profile),registryHash:canonicalCaseHash(entry.registry),expiresAt:"2026-10-15T13:00:00.000000Z"}};
}
function base(fire:boolean){
 const raw=fixtureInput("ONB-001");
 raw.facts=raw.facts.map(fact=>({...fact,value:{kind:"ratio" as const,numerator:fire?"20":"80",denominator:"100"}}));
 const entry=context("CASE01-ACCESS",raw.guildId),independent=context("CASE09-OVERDUE",raw.guildId),target=raw.targets[0]!;
 entry.context.target={...target};entry.context.window={start:raw.facts[0]!.windowStart,end:raw.facts[0]!.windowEnd};
 for(const field of Object.values(entry.context.fields))field.authorityScope={...field.authorityScope,...target};
 entry.context.rootTrigger={kind:"BASE_RULE_RESULT",ruleId:"ONB-001",outcome:"FIRE",ruleResultRef:{ruleId:"ONB-001",ruleVersion:"1",target:{...target},window:{...entry.context.window},hash:"0".repeat(64)}};
 const input=sealRuleInput({...raw,ruleTargets:raw.targets,targets:[...raw.targets,{...independent.context.target,liveVersion:independent.context.target.liveVersion!}]}),config=fixtureRuleConfig(),output=evaluateRules(input,config),bound=bindCurrentCaseRoots(input,[entry,independent],output);
 return {input,config,output,bound,entry};
}
it("binds the base hash only after all independent CASE targets enter the final input",()=>{
 const f=base(true),root=f.bound[0]!.context.rootTrigger;
 expect(root.outcome).toBe("FIRE");expect(root.ruleResultRef!.hash).toBe(hashRuleValue(f.output.results[0]));expect(root.ruleResultRef!.hash).not.toBe("0".repeat(64));
 const result=evaluatePlatform({input:f.input,config:f.config,cases:f.bound.map(sealedCase),aggregateBudget},{nowMs:()=>Date.parse(f.input.evaluationAsOf)});
 expect(result.complete).toBe(true);expect(result.ruleOutput.results).toHaveLength(1);expect(result.ruleOutput.results[0]!.decision).toBe("FIRE");
 expect(result.caseResults.find(value=>value.caseId==="CASE01")?.outcome).toBe("ACTION");
});
it("accepts a current NO_FIRE as BASE_RULE_NOT_FIRED without carrying a past FIRE action",()=>{
 const f=base(false);expect(f.bound[0]!.context.rootTrigger.outcome).toBe("NO_FIRE");
 const request={input:f.input,config:f.config,cases:f.bound.map(sealedCase),aggregateBudget},clock={nowMs:()=>Date.parse(f.input.evaluationAsOf)},result=evaluatePlatform(request,clock);
 expect(result.complete).toBe(true);expect(result.caseResults.find(value=>value.caseId==="CASE01")).toMatchObject({outcome:"INELIGIBLE",reasonCode:"BASE_RULE_NOT_FIRED",action:null});
 for(const mutate of [(entry:CaseSnapshotInput)=>{entry.context.rootTrigger.outcome="FIRE";},(entry:CaseSnapshotInput)=>{entry.context.rootTrigger.ruleResultRef!.hash="f".repeat(64);}]){
  const changed=structuredClone(f.bound);mutate(changed[0]!);
  expect(evaluatePlatform({...request,cases:changed.map(sealedCase)},clock)).toMatchObject({complete:false,reasonCodes:["BASE_RULE_CONTEXT_NOT_SEALED"]});
 }
});
it("evaluates an independent case-only envelope with no 13-rule targets or fabricated Facts",()=>{
 const raw=fixtureInput("ONB-001"),entry=context("CASE09-OVERDUE",raw.guildId);
 const input=sealRuleInput({...raw,requestedRuleIds:[],facts:[],sourceHealth:[],ruleTargets:[],targets:[{...entry.context.target,liveVersion:entry.context.target.liveVersion!}]}),config=fixtureRuleConfig();
 entry.context.versions=caseEnvelopeVersions(input,entry.caseId,entry.context.rootTrigger);
 const result=evaluatePlatform({input,config,cases:[sealedCase(entry)],aggregateBudget},{nowMs:()=>Date.parse(input.evaluationAsOf)});
 expect(result.complete).toBe(true);expect(result.ruleOutput.results).toEqual([]);expect(result.caseResults.find(value=>value.caseId==="CASE09")?.outcome).toBe("ACTION");expect(result.publishable).toBe(false);
 const missing=base(true).entry;expect(()=>bindCurrentCaseRoots(input,[missing],evaluateRules(input,config))).toThrow("BASE_RULE_RESULT_NOT_AVAILABLE");
 expect(()=>verifySealedRuleInput({...input,ruleTargets:raw.targets})).toThrow();
});
it("keeps CASE selection a finite resource selector and rejects raw context or an implicit empty request",()=>{
 const body={configVersion:1,inputs:[],reason:"MANUAL"};
 expect(enqueueRequest.parse({...body,requestedCaseIds:["CASE20","CASE09"]}).requestedCaseIds).toEqual(["CASE09","CASE20"]);
 for(const invalid of [body,{...body,requestedCaseIds:[]},{...body,requestedCaseIds:["CASE09","CASE09"]},{...body,requestedCaseIds:["CASE21"]},{...body,requestedCaseIds:["CASE09"],observations:[]},{...body,requestedCaseIds:["CASE09"],approval:true}])expect(enqueueRequest.safeParse(invalid).success).toBe(false);
});
it("seals an actual EVENT recommendation target separately from its current EVENT_PROGRAM base root",()=>{
 const raw=fixtureInput("EVENT-001"),entry=context("CASE06-CAPACITY",raw.guildId),program=raw.targets[0]!,nativeEvent={targetType:"EVENT",targetId:"955500000000000004",liveVersion:"native-event-v1"};
 entry.context.target=nativeEvent;entry.context.window={start:raw.facts[0]!.windowStart,end:raw.facts[0]!.windowEnd};entry.context.rootTrigger={kind:"BASE_RULE_RESULT",ruleId:"EVENT-001",outcome:"FIRE",ruleResultRef:{ruleId:"EVENT-001",ruleVersion:raw.versions.ruleVersions["EVENT-001"]!,target:program,window:entry.context.window,hash:"0".repeat(64)}};
 const input=sealRuleInput({...raw,ruleTargets:raw.targets,targets:[...raw.targets,nativeEvent]}),output=evaluateRules(input,fixtureRuleConfig()),bound=bindCurrentCaseRoots(input,[entry],output)[0]!;
 expect(bound.context.target).toEqual(nativeEvent);expect(bound.context.rootTrigger.ruleResultRef?.target).toEqual(program);expect(bound.context.rootTrigger.ruleResultRef?.hash).toBe(hashRuleValue(output.results.find(result=>result.ruleId==="EVENT-001")));
 const aliased=structuredClone(entry);aliased.context.rootTrigger.ruleResultRef!.target=nativeEvent;expect(()=>bindCurrentCaseRoots(input,[aliased],output)).toThrow("BASE_RULE_RESULT_NOT_AVAILABLE");
});
