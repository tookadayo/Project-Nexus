import { evaluateRules, type RuleEvaluationControl, type RuleEvaluationOutput } from "./rule-engine";
import type { RuleEngineConfig } from "./rule-config";
import {hashRuleValue,type SealedRuleInput,type RuleResult} from "./facts";
import { evaluateCase, createAggregateBudget, normalizeCaseTimestamp, canonicalCaseHash,arbitrateCaseActions } from "./case-engine";
import type { CaseEvaluation, CaseRegistry, DecisionContext, EvaluationProfile } from "./case-types";
import { CASE_CATALOG } from "./catalog";
import { digest } from "./domain";
import {caseSnapshotHash,type CaseContextRef,type CaseSnapshotInput} from "./case-storage";

export interface CaseEvaluationRequest {caseId:string;context:DecisionContext;profile:EvaluationProfile;registry:CaseRegistry;seal:CaseContextRef;}
export interface PipelineRequest {
 input:SealedRuleInput;config:RuleEngineConfig;cases:readonly CaseEvaluationRequest[];
 aggregateBudget:{maxSteps:number;maxOperations:number;maxInputs:number}|null;
}
export interface PipelineOutput {
 complete:boolean;publishable:boolean;ruleOutput:RuleEvaluationOutput;caseResults:readonly CaseEvaluation[];
 reasonCodes:readonly string[];inputHash:string;
 supersededRuleHashes:readonly string[];
}
export function platformInputHash(ruleInputHash:string,cases:readonly CaseContextRef[],aggregateBudget:PipelineRequest["aggregateBudget"]):string{
 return !cases.length&&!aggregateBudget?ruleInputHash:digest({ruleInputHash,cases:[...cases].sort((a,b)=>a.caseId<b.caseId?-1:a.caseId>b.caseId?1:0),aggregateBudget});
}
export function caseEnvelopeVersions(input:SealedRuleInput,caseId:string,root:DecisionContext["rootTrigger"]):DecisionContext["versions"]{
 const definition=CASE_CATALOG.find(c=>c.id===caseId);
 return {catalog:input.versions.catalogVersion,rule:root.kind==="BASE_RULE_RESULT"?input.versions.ruleVersions[root.ruleId as keyof typeof input.versions.ruleVersions]??"unregistered":definition?.revision??"unregistered",engine:input.versions.engineVersion,config:input.versions.configVersion,schema:input.versions.schemaVersion,branch:input.versions.branchVersion,action:input.versions.actionVersion,explanation:input.versions.explanationVersion};
}
function sameWindow(a:{start:string;end:string},b:{start:string;end:string}){return normalizeCaseTimestamp(a.start)===normalizeCaseTimestamp(b.start)&&normalizeCaseTimestamp(a.end)===normalizeCaseTimestamp(b.end);}
function currentBaseResult(context:DecisionContext,results:readonly RuleResult[]):RuleResult|undefined{
 const root=context.rootTrigger,ref=root.ruleResultRef;
 if(root.kind!=="BASE_RULE_RESULT"||!ref||root.ruleId!==ref.ruleId)return undefined;
 const matches=results.filter(result=>result.ruleId===root.ruleId&&canonicalCaseHash(result.target)===canonicalCaseHash(ref.target)&&sameWindow({start:result.windowStart,end:result.windowEnd},ref.window));
 return matches.length===1?matches[0]:undefined;
}
/** Bind only after the final native+CASE target envelope is sealed and evaluated.
 * Past result identity selects a current native slot; it never supplies this
 * evaluation's decision/hash. Observations and windows are not recollected. */
export function bindCurrentCaseRoots(input:SealedRuleInput,entries:readonly CaseSnapshotInput[],output:RuleEvaluationOutput):CaseSnapshotInput[]{
 if(output.status!=="COMPLETED"||output.inputHash!==input.inputHash)throw new Error("BASE_RULE_EVALUATION_INCOMPLETE");
 return entries.map(entry=>{
  const root=entry.context.rootTrigger;
  if(root.kind!=="BASE_RULE_RESULT")return {...entry,context:{...entry.context,versions:caseEnvelopeVersions(input,entry.caseId,root)}};
  const definition=CASE_CATALOG.find(value=>value.id===entry.caseId),current=currentBaseResult(entry.context,output.results);
  if(!current||!definition?.baseRuleIds?.includes(current.ruleId)||!sameWindow(entry.context.window,{start:current.windowStart,end:current.windowEnd}))throw new Error("BASE_RULE_RESULT_NOT_AVAILABLE");
  const bound:DecisionContext["rootTrigger"]={kind:"BASE_RULE_RESULT",ruleId:current.ruleId,outcome:current.decision,ruleResultRef:{ruleId:current.ruleId,ruleVersion:current.ruleVersion,target:{...current.target},window:{start:current.windowStart,end:current.windowEnd},hash:hashRuleValue(current)}};
  return {...entry,context:{...entry.context,rootTrigger:bound,versions:caseEnvelopeVersions(input,entry.caseId,bound)}};
 });
}
function disabledCase(caseId:string,hash:string):CaseEvaluation{return {caseId,outcome:"DISABLED",reasonCode:"CASE_CONTEXT_NOT_AVAILABLE",complete:true,publishable:false,canonicalHash:canonicalCaseHash({caseId,inputHash:hash}),branchPath:[],action:null,explanation:null,usedFields:[],coverage:{requestedSourceIds:[],evaluatedSourceIds:[],unavailableSourceIds:[]},budget:{steps:0,operations:0,inputs:0}};}
/** A completed partial COMM summary is distinct from an interrupted evaluation.
 * No evaluator can turn fixture approval into an operational publication. */
export function evaluatePlatform(request:PipelineRequest,control:RuleEvaluationControl={}):PipelineOutput{
 const ruleOutput=evaluateRules(request.input,request.config,control),caseResults:CaseEvaluation[]=[];
 const inputHash=platformInputHash(request.input.inputHash,request.cases.map(c=>c.seal),request.aggregateBudget);
 const supersededRuleHashes:string[]=[];
 const finish=(complete:boolean,publishable:boolean,reasonCodes:string[]):PipelineOutput=>({complete,publishable,ruleOutput,caseResults,reasonCodes,inputHash,supersededRuleHashes});
 if(ruleOutput.status!=="COMPLETED")return finish(false,false,[...ruleOutput.reasonCodes]);
 if(request.cases.length&&!request.aggregateBudget)return finish(false,false,["AGGREGATE_BUDGET_NOT_APPROVED"]);
 if(request.cases.length>CASE_CATALOG.length||new Set(request.cases.map(c=>c.caseId)).size!==request.cases.length)return finish(false,false,["CASE_CONTEXT_NOT_SEALED"]);
 const budget=request.aggregateBudget?createAggregateBudget(request.aggregateBudget):undefined;
 for(const entry of [...request.cases].sort((a,b)=>a.caseId<b.caseId?-1:a.caseId>b.caseId?1:0)){
  if(control.cancelled?.()||control.tombstoned?.())return finish(false,false,[control.tombstoned?.()?"TOMBSTONED":"CANCELLED"]);
  const definition=CASE_CATALOG.find(c=>c.id===entry.caseId);if(!definition)return finish(false,false,["CASE_NOT_REGISTERED"]);
  // Every case belongs to the same immutable evaluation envelope. Contexts
  // obtained later or supplied for another guild cannot be spliced into it.
  try{
   if(entry.context.guildId!==request.input.guildId||normalizeCaseTimestamp(entry.context.evaluationAsOf)!==normalizeCaseTimestamp(request.input.evaluationAsOf)||digest(entry.context.versions)!==digest(caseEnvelopeVersions(request.input,entry.caseId,entry.context.rootTrigger))||entry.seal.caseId!==entry.caseId||entry.seal.revision!==definition.revision||entry.seal.contentHash!==caseSnapshotHash({caseId:entry.caseId,context:entry.context,profile:entry.profile,registry:entry.registry})||entry.seal.profileHash!==canonicalCaseHash(entry.profile)||entry.seal.registryHash!==canonicalCaseHash(entry.registry)||!request.input.targets.some(target=>canonicalCaseHash(target)===canonicalCaseHash(entry.context.target)))return finish(false,false,["CASE_CONTEXT_NOT_SEALED"]);
  }catch{return finish(false,false,["CASE_CONTEXT_NOT_SEALED"]);}
  if(entry.context.rootTrigger.kind==="BASE_RULE_RESULT"){
   const root=entry.context.rootTrigger,ref=root.ruleResultRef,current=currentBaseResult(entry.context,ruleOutput.results);
   if(!ref||!current||!definition.baseRuleIds?.includes(current.ruleId)||current.ruleVersion!==ref.ruleVersion||current.decision!==root.outcome||hashRuleValue(current)!==ref.hash||!sameWindow(entry.context.window,ref.window))return finish(false,false,["BASE_RULE_CONTEXT_NOT_SEALED"]);
  }
  const result=evaluateCase(definition,entry.context,entry.profile,entry.registry,{aggregateBudget:budget,now:control.nowMs});caseResults.push(result);
  if(result.outcome==="ACTION"&&entry.context.rootTrigger.kind==="BASE_RULE_RESULT"&&entry.context.rootTrigger.outcome!=="FIRE")return finish(false,false,["BASE_RULE_CONTEXT_NOT_FIRED"]);
  if(!result.complete&&result.outcome!=="DISABLED")return finish(false,false,[result.reasonCode]);
 }
 for(const definition of CASE_CATALOG)if(!request.cases.some(c=>c.caseId===definition.id))caseResults.push(disabledCase(definition.id,inputHash));
 const arbitration=arbitrateCaseActions(caseResults,Object.fromEntries(request.cases.map(entry=>[entry.caseId,entry.context.window])));
 caseResults.splice(0,caseResults.length,...arbitration.results);
 if(!arbitration.valid)return finish(false,false,[arbitration.reasonCode!]);
 for(const result of caseResults)if(result.action){const ref=request.cases.find(c=>c.caseId===result.caseId)?.context.rootTrigger.ruleResultRef;if(ref)supersededRuleHashes.push(ref.hash);}
 const missingRequired=ruleOutput.results.some(r=>r.decision==="INELIGIBLE"&&!r.partialCoverage&&r.reasonCodes.some(c=>["MISSING","SOURCE_UNKNOWN","SOURCE_HEALTH_UNKNOWN","SOURCE_IN_FUTURE"].includes(c)));
 if(missingRequired)return finish(false,false,["REQUIRED_INPUT_INCOMPLETE"]);
 return finish(true,ruleOutput.publishable&&caseResults.every(r=>r.outcome==="DISABLED"||r.publishable||r.outcome!=="ACTION"),[]);
}
