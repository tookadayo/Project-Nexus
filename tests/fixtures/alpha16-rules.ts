import { sealRuleInput } from '../../packages/rules/src/facts';
import type { FactQuality, FactSnapshot, FactValue, RuleDecision, RuleId, RuleInput, RuleTarget, SealedRuleInput, SourceHealthObservation } from '../../packages/rules/src/facts';
import { METRIC_CATALOG, RULE_CATALOG, RULE_CATALOG_VERSION, RULE_ENGINE_VERSION, RULE_SCHEMA_VERSION } from '../../packages/rules/src/rule-catalog';
import type { PerRuleConfig, RuleEngineConfig } from '../../packages/rules/src/rule-config';
import { SOURCE_ADAPTER_CATALOG } from '../../packages/rules/src/source-adapters';

/** All numeric profiles in this file are synthetic test candidates, never operational defaults. */
export function fixtureRuleConfig(): RuleEngineConfig {
  const common: PerRuleConfig = { enabled:true,minimumN:'20',threshold:'0.6',minimumCoverage:'0.95',freshnessSeconds:86400,windowDays:7,cooldown:{unit:'CALENDAR_DAY',value:7,timeZone:'UTC'} };
  return {configVersion:'fixture-1',profile:'FIXTURE',approval:'APPROVED',retentionApproved:false,budget:{maxRules:50,maxFacts:500,maxTargets:100,maxDurationMs:5000,maxSteps:100000},approvedSourceTypes:SOURCE_ADAPTER_CATALOG.map((source)=>source.sourceType),rules:{
    'ONB-001':{...common},'HELP-001':{...common,threshold:'0.25'},'RET-001':{...common,threshold:'0.4',freshnessSeconds:172800},
    'ENG-001':{...common,threshold:'0.1',decline:'0.25',minimumCoverage:'0.9',freshnessSeconds:93600,cooldown:{unit:'SECOND',value:1209600}},
    'EVENT-001':{...common,threshold:'0.6',decline:'0.2',minimumEvents:'5',windowDays:28,minimumCoverage:'0.9',freshnessSeconds:93600,cooldown:{unit:'SECOND',value:1209600}},
    'REPORT-001':{...common,minimumN:'5',threshold:'0.9',decline:'0.1',generationGraceSeconds:7200,minimumCoverage:'0.9',freshnessSeconds:93600,cooldown:{unit:'SECOND',value:1209600}},
    'AUTO-001':{...common,threshold:'0.1',unknownRateLimit:'0.2',cooldown:{unit:'SECOND',value:86400}},'AUTO-002':{...common,threshold:'0.1',freshnessSeconds:300,windowDays:1,waitGraceSeconds:900,heartbeatGraceSeconds:300,cooldown:{unit:'SECOND',value:21600}},
    'PERM-001':{...common,minimumN:'5',threshold:'0.2',cooldown:{unit:'SECOND',value:86400}},'EXP-001':{...common,minimumN:'3',threshold:'0.666666666666666666',minimumConsecutivePeriods:2,windowDays:3,minimumCoverage:'1'},
    'PLAY-001':{...common,minimumN:'3',threshold:'0.666666666666666666',minimumConsecutivePeriods:2,windowDays:3,minimumCoverage:'1'},
    'DATA-001':{...common,minimumN:'1',threshold:'0',windowDays:1,cooldown:{unit:'SECOND',value:86400}},'COMM-001':{...common,minimumN:'1',threshold:'0',minimumCoverage:'0.666666666666666666',minimumDomains:2,communityWindowPolicy:'DECLARED_RULE_WINDOWS_FIXTURE',cooldown:{unit:'SECOND',value:86400}},
  }};
}
const stamp = (value: number) => new Date(value).toISOString().replace('.000Z','.000000Z');
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
export function fixtureInput(ruleId: RuleId): RuleInput {
  const rule = RULE_CATALOG.find((entry)=>entry.ruleId===ruleId)!;
  const asOf = '2026-10-15T12:00:00.000000Z', at = Date.parse(asOf);
  const target = {targetType:rule.targetType,targetId:ruleId==='COMM-001'?'884111111111111111':ruleId==='DATA-001'?'ONB_FIRST_ACTION_COMPLETION_RATE':`fixture-${ruleId}`,liveVersion:'1'};
  const fresh = ruleId==='AUTO-002' ? stamp(at-60000) : stamp(at-3600000);
  const health: SourceHealthObservation = {observationId:id(1),revision:'1',sourceType:rule.sourceTypes[0]??'source_health_observation_v1',observedAt:fresh,expiresAt:stamp(at+48*3600000),quality:'SUFFICIENT',state:'HEALTHY',lastSuccessfulIngestAt:stamp(at-3600000),neverSucceeded:false,coverage:'1',target};
  const metrics = rule.metricIds.length ? rule.metricIds : ruleId==='DATA-001' ? ['ONB_FIRST_ACTION_COMPLETION_RATE'] : [];
  let next = 2;
  const facts: FactSnapshot[]=[];
  for (const metricId of metrics) {
    const metric = METRIC_CATALOG.find((entry)=>entry.metricId===metricId)!;
    const roles = rule.comparison && metric.valueKind!=='generation' ? ['CURRENT','PREVIOUS'] as const : ['CURRENT'] as const;
    for (const role of roles) {
      const end = ['ONB-001','HELP-001','RET-001','AUTO-001','AUTO-002','EXP-001','PLAY-001','DATA-001'].includes(ruleId) ? Date.parse('2026-10-15T00:00:00Z') : at;
      const days = ruleId==='EVENT-001'?28:['EXP-001','PLAY-001'].includes(ruleId)?3:['AUTO-002','DATA-001'].includes(ruleId)?1:7;
      const windowEnd=stamp(end-(role==='PREVIOUS'?days*86400000:0)),windowStart=stamp(Date.parse(windowEnd)-days*86400000);
      let value: FactValue;
      switch(metric.valueKind){
        case 'ratio':value={kind:'ratio',numerator:'80',denominator:'100',...(ruleId==='EVENT-001'?{eligibleEvents:'5'}:{})};break;
        case 'generation':value={kind:'generation',dueAt:stamp(at-3600000),lastSuccessAt:stamp(at-1800000)};break;
        case 'outcomes':value={kind:'outcomes',succeeded:'40',failed:'0',unknown:'0',cancelled:'0',unfinished:'0',expired:'0'};break;
        case 'anomalies':value={kind:'anomalies',eligible:'40',anomalous:'0',expected:'40',observed:'40',projectionAsOf:asOf,waitGraceSeconds:'900',heartbeatGraceSeconds:'300'};break;
        case 'permissions':value={kind:'permissions',required:'5',allowed:'5',denied:'0',unknown:'0',suppressed:'0',requirementRegistered:true};break;
        case 'issuePeriods':value={kind:'issuePeriods',issueCode:'HELP_BACKLOG',periods:[0,1,2].map((i)=>({windowStart:stamp(Date.parse(windowStart)+i*86400000),windowEnd:stamp(Date.parse(windowStart)+(i+1)*86400000),state:'FIRE'}))};break;
        case 'enum':value={kind:'enum',value:'ABSENT'};break;
        default:throw new Error('FIXTURE_METRIC_UNSUPPORTED');
      }
      const factId=id(next++),snapshotId=id(next++);
      facts.push({factId,snapshotId,metricId,metricDefinitionVersion:'1',dimension:{targetType:target.targetType,targetId:target.targetId},periodRole:role,windowStart,windowEnd,sourceType:metric.sourceType,sourceRevision:'1',observedAt:fresh,expiresAt:health.expiresAt,sourceHealthRefs:[{observationId:health.observationId,revision:health.revision}],quality:'SUFFICIENT',value,unit:metric.unit,target,coverage:'1',sampleSize:'100',comparison:{cohortDefinitionVersion:'1',campaignClass:'STANDARD',maturityOffset:'0',windowKind:'ELAPSED',timeZone:'UTC',cohortId:role==='CURRENT'?'cohort-current':'cohort-prior'}});
    }
  }
  return {guildId:'884111111111111111',evaluationAsOf:asOf,versions:{engineVersion:RULE_ENGINE_VERSION,configVersion:'fixture-1',catalogVersion:RULE_CATALOG_VERSION,schemaVersion:RULE_SCHEMA_VERSION,branchVersion:'fixture-1',actionVersion:'fixture-1',explanationVersion:'fixture-1',ruleVersions:Object.fromEntries(RULE_CATALOG.map((entry)=>[entry.ruleId,entry.ruleVersion]))},requestedRuleIds:[ruleId],facts,sourceHealth:[health],targets:[target]};
}
export interface RuleFixture {fixtureId:string;sourceFixtureId:string;baseline:'alpha16-contract-20261016';ruleId:RuleId;input:SealedRuleInput;config:RuleEngineConfig;expectedDecision:RuleDecision;expectedReason?:string;expectedPriority?:'P1'|'P2'|'P3';sourceCorrection?:string}
function sourceFixtureId(ruleId:RuleId,suffix:string){if(['ONB-001','HELP-001','RET-001','ENG-001','EVENT-001','REPORT-001','COMM-001'].includes(ruleId))return `${ruleId.split('-')[0]}-${suffix}`;const section=['AUTO-001','AUTO-002','PERM-001'].includes(ruleId)?'C':'D';return `II-${section}-${ruleId.replace('-','')}-${suffix}`;}
const current=(input:RuleInput,metric?:string)=>input.facts.find((fact)=>fact.periodRole==='CURRENT'&&(!metric||fact.metricId===metric))!;
const previous=(input:RuleInput,metric?:string)=>input.facts.find((fact)=>fact.periodRole==='PREVIOUS'&&(!metric||fact.metricId===metric))!;
function changeRatio(fact:FactSnapshot,n:number,d=100){const v=fact.value as Extract<FactValue,{kind:'ratio'}>;fact.value={...v,numerator:String(n),denominator:String(d)};}
function quality(fact:FactSnapshot,state:FactQuality){fact.quality=state;if(!['SUFFICIENT','PARTIAL'].includes(state))fact.value=null;}
function outcomes(fact:FactSnapshot,failed:number,succeeded:number,unknown=0){fact.value={kind:'outcomes',failed:String(failed),succeeded:String(succeeded),unknown:String(unknown),cancelled:'0',unfinished:'0',expired:'0'};}
function fixture(ruleId:RuleId,suffix:string,decision:RuleDecision,reason:string|undefined,mutate:(input:RuleInput,config:RuleEngineConfig)=>void=()=>{},sourceCorrection?:string):RuleFixture{
  const input=fixtureInput(ruleId),config=fixtureRuleConfig();mutate(input,config);
  return {fixtureId:`${ruleId}-${suffix}`,sourceFixtureId:sourceFixtureId(ruleId,suffix),baseline:'alpha16-contract-20261016',ruleId,input:sealRuleInput(input),config,expectedDecision:decision,...(reason?{expectedReason:reason}:{}),...(sourceCorrection?{sourceCorrection}:{})};
}
const ratioFixtures:RuleFixture[]=[];
for(const [ruleId,low,healthy,boundary] of [['ONB-001',54,72,60],['HELP-001',30,20,25],['RET-001',32,45,40]] as const){
  ratioFixtures.push(
    fixture(ruleId,'F01','FIRE',undefined,(i)=>changeRatio(current(i),low)),
    fixture(ruleId,'F02','NO_FIRE','THRESHOLD_NOT_CROSSED',(i)=>changeRatio(current(i),healthy)),
    fixture(ruleId,'F03',ruleId==='HELP-001'?'FIRE':'NO_FIRE',undefined,(i)=>changeRatio(current(i),boundary)),
    fixture(ruleId,'F04','INELIGIBLE','MISSING',(i)=>quality(current(i),'MISSING')),
    fixture(ruleId,'F05','INELIGIBLE','INSUFFICIENT_N',(i)=>changeRatio(current(i),ruleId==='ONB-001'?8:ruleId==='RET-001'?4:3,10)),
    fixture(ruleId,'F06','INELIGIBLE','PRIVACY_SUPPRESSED',(i)=>quality(current(i),'SUPPRESSED')),
    fixture(ruleId,'F07','INELIGIBLE','ZERO_DENOMINATOR',(i)=>changeRatio(current(i),0,0)),
  );
}
function periodStates(input:RuleInput,states:readonly ('FIRE'|'NO_FIRE'|'MISSING')[]){const fact=current(input,'issue.recurrence_consecutive_periods');const v=fact.value as Extract<FactValue,{kind:'issuePeriods'}>;fact.value={...v,periods:v.periods.map((p,i)=>({...p,state:states[i]!}))};}
const EXP_PLAY:RuleFixture[]=[];
for(const ruleId of ['EXP-001','PLAY-001'] as const){
  EXP_PLAY.push(fixture(ruleId,'F01','FIRE',undefined,(i)=>periodStates(i,ruleId==='EXP-001'?['FIRE','FIRE','FIRE']:['FIRE','FIRE','NO_FIRE'])),fixture(ruleId,'F02','NO_FIRE','RECURRENCE_NOT_MET',(i)=>periodStates(i,ruleId==='EXP-001'?['NO_FIRE','NO_FIRE','NO_FIRE']:['FIRE','NO_FIRE','NO_FIRE'])),fixture(ruleId,'F03','FIRE',undefined,(i)=>periodStates(i,['FIRE','FIRE','NO_FIRE'])));
  if(ruleId==='EXP-001')EXP_PLAY.push(fixture(ruleId,'F04','NO_FIRE','RECURRENCE_NOT_MET',(i)=>periodStates(i,['FIRE','NO_FIRE','FIRE'])));
  else EXP_PLAY.push(fixture(ruleId,'F04','NO_FIRE','PLAYBOOK_EXISTS',(i)=>{current(i,'issue.playbook_coverage').value={kind:'enum',value:'ENABLED'};}));
  EXP_PLAY.push(fixture(ruleId,'F05','INELIGIBLE','PARTIAL_COVERAGE',(i)=>periodStates(i,['FIRE','FIRE','MISSING'])));
  if(ruleId==='EXP-001')EXP_PLAY.push(fixture(ruleId,'F06','NO_FIRE','ACTIVE_EXPERIMENT_EXISTS',(i)=>{current(i,'issue.active_experiment_state').value={kind:'enum',value:'PRESENT'};}),fixture(ruleId,'F07','INELIGIBLE','ACTIVE_EXPERIMENT_UNKNOWN',(i)=>{current(i,'issue.active_experiment_state').value={kind:'enum',value:'UNKNOWN'};}));
  else EXP_PLAY.push(fixture(ruleId,'F06','INELIGIBLE','PLAYBOOK_MAPPING_UNKNOWN',(i)=>{current(i,'issue.playbook_coverage').value={kind:'enum',value:'UNKNOWN'};}),fixture(ruleId,'F07','FIRE','PLAYBOOK_DISABLED',(i)=>{current(i,'issue.playbook_coverage').value={kind:'enum',value:'DISABLED'};}));
}
export const RULE_FIXTURES:readonly RuleFixture[]=[...ratioFixtures,
  fixture('ENG-001','F01','FIRE','LOW_RATE',(i)=>{changeRatio(current(i),6);changeRatio(previous(i),10);}),
  fixture('ENG-001','F02','NO_FIRE',undefined,(i)=>{changeRatio(current(i),12);changeRatio(previous(i),10);}),
  fixture('ENG-001','F03','NO_FIRE','THRESHOLD_NOT_CROSSED',(i)=>{changeRatio(current(i),10);changeRatio(previous(i),10);}),
  fixture('ENG-001','F04','FIRE','RELATIVE_DECLINE',(i)=>{changeRatio(current(i),75,1000);changeRatio(previous(i),100,1000);},'The printed 7.5/100 shorthand is represented as integer 75/1000; same exact ratio.'),
  fixture('ENG-001','F05','INELIGIBLE','STALE',(i)=>{current(i).observedAt='2026-10-14T06:00:00Z';}),
  fixture('ENG-001','F06','INELIGIBLE','INSUFFICIENT_N',(i)=>{changeRatio(current(i),2,4);changeRatio(previous(i),1,4);}),
  fixture('ENG-001','F07','INELIGIBLE','ZERO_DENOMINATOR',(i)=>changeRatio(current(i),0,0)),
  fixture('ENG-001','F08','INELIGIBLE','PRIVACY_SUPPRESSED',(i)=>quality(current(i),'SUPPRESSED')),
  fixture('EVENT-001','F01','FIRE','LOW_RATE',(i)=>{changeRatio(current(i),50);changeRatio(previous(i),70);}),
  fixture('EVENT-001','F02','NO_FIRE',undefined,(i)=>{changeRatio(current(i),70);changeRatio(previous(i),72);}),
  fixture('EVENT-001','F03','FIRE','PERCENTAGE_POINT_DECLINE',(i)=>{changeRatio(current(i),60);changeRatio(previous(i),80);}),
  fixture('EVENT-001','F04','INELIGIBLE','STALE',(i)=>{current(i).observedAt='2026-10-14T06:00:00Z';}),
  fixture('EVENT-001','F05','INELIGIBLE','INSUFFICIENT_N',(i)=>{changeRatio(current(i),4,10);changeRatio(previous(i),8,20);(current(i).value as Extract<FactValue,{kind:'ratio'}>).eligibleEvents='2';(previous(i).value as Extract<FactValue,{kind:'ratio'}>).eligibleEvents='2';}),
  fixture('EVENT-001','F06','INELIGIBLE','PRIVACY_SUPPRESSED',(i)=>quality(current(i),'SUPPRESSED')),
  fixture('EVENT-001','F07','INELIGIBLE','ZERO_DENOMINATOR',(i)=>changeRatio(current(i),0,0)),
  fixture('EVENT-001','F08','INELIGIBLE','MISSING',(i)=>quality(current(i),'MISSING')),
  fixture('REPORT-001','F01','FIRE','GENERATION_OVERDUE',(i)=>{current(i,'REPORT.GENERATION_DUE_STATE').value={kind:'generation',dueAt:'2026-10-15T09:00:00Z',lastSuccessAt:'2026-10-14T09:00:00Z'};outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,10);outcomes(previous(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,10);}),
  fixture('REPORT-001','F02','FIRE','DELIVERY_FAILURE',(i)=>outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),2,8)),
  fixture('REPORT-001','F03','FIRE','DELIVERY_DECLINE',(i)=>{outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),1,9);outcomes(previous(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,10);}),
  fixture('REPORT-001','F04','NO_FIRE',undefined,(i)=>{outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,10);outcomes(previous(i,'REPORT.DELIVERY_RESULT_COUNTS'),1,9);}),
  fixture('REPORT-001','F05','NO_FIRE','THRESHOLD_NOT_CROSSED',(i)=>{current(i,'REPORT.GENERATION_DUE_STATE').value={kind:'generation',dueAt:'2026-10-15T10:00:00Z',lastSuccessAt:'2026-10-14T12:00:00Z'};outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,10);outcomes(previous(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,10);}),
  fixture('REPORT-001','F06','INELIGIBLE','STALE',(i)=>{for(const f of i.facts)f.observedAt='2026-10-14T06:00:00Z';}),
  fixture('REPORT-001','F07','INELIGIBLE','INSUFFICIENT_N',(i)=>{outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,1);outcomes(previous(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,1);}),
  fixture('REPORT-001','F08','INELIGIBLE','ZERO_DENOMINATOR',(i)=>outcomes(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),0,0)),
  fixture('REPORT-001','F09','INELIGIBLE','PRIVACY_SUPPRESSED',(i)=>quality(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),'SUPPRESSED')),
  fixture('REPORT-001','F10','INELIGIBLE','MISSING',(i)=>{current(i,'REPORT.GENERATION_DUE_STATE').value={kind:'generation',dueAt:null,lastSuccessAt:null};quality(current(i,'REPORT.DELIVERY_RESULT_COUNTS'),'MISSING');}),
  fixture('AUTO-001','F01','FIRE',undefined,(i)=>{outcomes(current(i),6,34);const v=current(i).value as Extract<FactValue,{kind:'outcomes'}>;v.cancelled='3';v.unfinished='2';v.expired='1';}),
  fixture('AUTO-001','F02','NO_FIRE',undefined,(i)=>outcomes(current(i),2,38)),
  fixture('AUTO-001','F03','FIRE',undefined,(i)=>outcomes(current(i),4,36)),
  fixture('AUTO-001','F04','INELIGIBLE','UNKNOWN_SUPPRESSED',(i)=>outcomes(current(i),6,14,6)),
  fixture('AUTO-001','F05','INELIGIBLE','INSUFFICIENT_N',(i)=>outcomes(current(i),3,12)),
  fixture('AUTO-001','F06','INELIGIBLE','ZERO_DENOMINATOR',(i)=>outcomes(current(i),0,0)),
  fixture('AUTO-001','F07','INELIGIBLE','STALE',(i)=>{current(i).observedAt='2026-10-13T12:00:00Z';}),
  ...[6,2,4].map((n,index)=>fixture('AUTO-002',`F0${index+1}`,n>=4?'FIRE':'NO_FIRE',undefined,(i)=>{(current(i).value as Extract<FactValue,{kind:'anomalies'}>).anomalous=String(n);})),
  fixture('AUTO-002','F04','INELIGIBLE','STALE',(i)=>{current(i).observedAt='2026-10-15T11:40:00Z';}),
  fixture('AUTO-002','F05','INELIGIBLE','PARTIAL_COVERAGE',(i)=>{current(i).value={...current(i).value as Extract<FactValue,{kind:'anomalies'}>,eligible:'24',anomalous:'6',expected:'30',observed:'24'};}),
  fixture('AUTO-002','F06','INELIGIBLE','INSUFFICIENT_N',(i)=>{current(i).value={...current(i).value as Extract<FactValue,{kind:'anomalies'}>,eligible:'10',anomalous:'3',expected:'10',observed:'10'};}),
  fixture('AUTO-002','F07','INELIGIBLE','ZERO_DENOMINATOR',(i)=>{current(i).value={...current(i).value as Extract<FactValue,{kind:'anomalies'}>,eligible:'0',anomalous:'0',expected:'40',observed:'40'};}),
  fixture('AUTO-002','F08','NO_FIRE',undefined,(i)=>{current(i).value={...current(i).value as Extract<FactValue,{kind:'anomalies'}>,eligible:'30',anomalous:'0',expected:'30',observed:'30'};}),
  ...[1,0,2].map((denied,index)=>fixture('PERM-001',`F0${index+1}`,denied?'FIRE':'NO_FIRE',undefined,(i)=>{current(i).value={kind:'permissions',required:'5',allowed:String(5-denied),denied:String(denied),unknown:'0',suppressed:'0',requirementRegistered:true};})),
  fixture('PERM-001','F04','INELIGIBLE','OBSERVATION_UNAVAILABLE',(i)=>{current(i).value={kind:'permissions',required:'5',allowed:'3',denied:'1',unknown:'1',suppressed:'0',requirementRegistered:true};}),
  fixture('PERM-001','F05','INELIGIBLE','INSUFFICIENT_N',(i)=>{current(i).value={kind:'permissions',required:'2',allowed:'2',denied:'0',unknown:'0',suppressed:'0',requirementRegistered:true};}),
  fixture('PERM-001','F06','INELIGIBLE','ZERO_DENOMINATOR',(i)=>{current(i).value={kind:'permissions',required:'0',allowed:'0',denied:'0',unknown:'0',suppressed:'0',requirementRegistered:true};}),
  fixture('PERM-001','F07','INELIGIBLE','PRIVACY_SUPPRESSED',(i)=>{current(i).value={kind:'permissions',required:'5',allowed:'4',denied:'0',unknown:'0',suppressed:'1',requirementRegistered:true};}),
  fixture('PERM-001','F08','INELIGIBLE','STALE',(i)=>{current(i).observedAt='2026-10-13T12:00:00Z';}),
  ...EXP_PLAY,
  fixture('DATA-001','F01','FIRE','BUSINESS_FACT_MISSING',(i)=>quality(current(i),'MISSING')),
  fixture('DATA-001','F02','NO_FIRE','SOURCE_HEALTH_SUFFICIENT'),
  fixture('DATA-001','F03','FIRE','BUSINESS_FACT_STALE',(i)=>{quality(current(i),'STALE');i.sourceHealth[0]!.lastSuccessfulIngestAt='2026-10-14T12:00:00Z';}),
  fixture('DATA-001','F04','INELIGIBLE','SOURCE_HEALTH_UNKNOWN',(i)=>{i.sourceHealth=[];for(const f of i.facts)f.sourceHealthRefs=[];}),
  fixture('DATA-001','F05','FIRE','BUSINESS_INGEST_STALE',(i)=>{quality(current(i),'STALE');i.sourceHealth[0]!.lastSuccessfulIngestAt='2026-10-14T11:59:00Z';},'IV0/VA: fresh health observation can warn about stale business ingest.'),
  fixture('DATA-001','F06','FIRE','BUSINESS_PARTIAL_COVERAGE',(i)=>{quality(current(i),'MISSING');i.sourceHealth[0]!.coverage='0.94';},'IV0/VA: insufficient business coverage is a warning, not its own freshness gate.'),
  fixture('DATA-001','F07','FIRE','SOURCE_NEVER_SUCCEEDED',(i)=>{quality(current(i),'MISSING');i.sourceHealth[0]!.lastSuccessfulIngestAt=null;i.sourceHealth[0]!.neverSucceeded=true;},'IV0/VA: confirmed neverSucceeded is a warning; missing observation remains unknown.'),
  fixture('DATA-001','F08','INELIGIBLE','PRIVACY_SUPPRESSED',(i)=>{quality(current(i),'STALE');i.sourceHealth[0]!.quality='SUPPRESSED';}),
];

export function communityFixture(suffix:string,eligibleRuleIds:readonly RuleId[],fireRuleIds:readonly RuleId[],privacyRuleId?:RuleId):RuleFixture{
  const ids:RuleId[]=['ONB-001','HELP-001','RET-001','ENG-001','EVENT-001','REPORT-001','AUTO-001','AUTO-002','PERM-001'];
  const requestedIds=suffix==='F01'?ids.filter((ruleId)=>ruleId!=='PERM-001'):ids;
  const input=fixtureInput('COMM-001'),config=fixtureRuleConfig();
  let next=100;
  const parts=requestedIds.map((ruleId)=>fixtureInput(ruleId));
  const facts:FactSnapshot[]=[],health:SourceHealthObservation[]=[];
  for(let index=0;index<parts.length;index++){
    const part=parts[index]!,ruleId=requestedIds[index]!,oldHealth=part.sourceHealth[0]!;
    oldHealth.observationId=id(next++);health.push(oldHealth);
    for(const f of part.facts){f.factId=id(next++);f.snapshotId=id(next++);f.sourceHealthRefs=[{observationId:oldHealth.observationId,revision:oldHealth.revision}];facts.push(f);}
    if(!eligibleRuleIds.includes(ruleId)){for(const f of part.facts)quality(f,ruleId===privacyRuleId?'SUPPRESSED':'MISSING');continue;}
    const fire=fireRuleIds.includes(ruleId);
    if(['ONB-001','HELP-001','RET-001','ENG-001','EVENT-001'].includes(ruleId)){
      const n=ruleId==='HELP-001'?(fire?30:10):(fire?1:80);changeRatio(current(part),n);if(part.facts.some((f)=>f.periodRole==='PREVIOUS'))changeRatio(previous(part),80);
    }else if(ruleId==='REPORT-001')outcomes(current(part,'REPORT.DELIVERY_RESULT_COUNTS'),fire?2:0,fire?8:10);
    else if(ruleId==='AUTO-001')outcomes(current(part),fire?6:0,fire?34:40);
    else if(ruleId==='AUTO-002')(current(part).value as Extract<FactValue,{kind:'anomalies'}>).anomalous=fire?'6':'0';
    else if(ruleId==='PERM-001')current(part).value={kind:'permissions',required:'5',allowed:fire?'4':'5',denied:fire?'1':'0',unknown:'0',suppressed:'0',requirementRegistered:true};
  }
  const extraTargets:RuleTarget[]=[];
  if(suffix==='F01'){
    // Nine declared slots: eight rule families plus a second independently declared RET target.
    const prior=parts.find((part)=>part.requestedRuleIds[0]==='RET-001')!;
    const extraTarget={...prior.targets[0]!,targetId:'fixture-RET-001-second'};extraTargets.push(extraTarget);
    for(const f of prior.facts)facts.push({...f,factId:id(next++),snapshotId:id(next++),target:extraTarget,dimension:{...f.dimension,targetId:extraTarget.targetId}});
  }
  input.requestedRuleIds=[...requestedIds,'COMM-001'];input.targets=[...parts.map((part)=>part.targets[0]!),...extraTargets,input.targets[0]!];input.facts=facts;input.sourceHealth=health;
  const domains=new Set(fireRuleIds.map((ruleId)=>RULE_CATALOG.find((r)=>r.ruleId===ruleId)!.domain));
  const partial=requestedIds.some((ruleId)=>!eligibleRuleIds.includes(ruleId));
  return {fixtureId:`COMM-001-${suffix}`,sourceFixtureId:sourceFixtureId('COMM-001',suffix),baseline:'alpha16-contract-20261016',ruleId:'COMM-001',input:sealRuleInput(input),config,expectedDecision:domains.size>=2?'FIRE':partial?'INELIGIBLE':'NO_FIRE',expectedReason:domains.size>=2?(partial?'PARTIAL_INPUT':'MULTI_DOMAIN_ISSUES'):(partial?'PARTIAL_COVERAGE':'DOMAIN_COUNT_BELOW_MIN'),expectedPriority:domains.size>=3?(partial?'P2':'P1'):fireRuleIds.length>=3?'P2':'P3'};
}
const baseIds:RuleId[]=['ONB-001','HELP-001','RET-001','ENG-001','EVENT-001','REPORT-001','AUTO-001','AUTO-002','PERM-001'];
export const COMMUNITY_FIXTURES:readonly RuleFixture[]=[
  communityFixture('F01',baseIds,['HELP-001','RET-001','EVENT-001']),
  communityFixture('F02',baseIds,['HELP-001']),
  communityFixture('F03',baseIds.slice(0,6),['HELP-001','ENG-001']),
  communityFixture('F04',baseIds,['HELP-001','ENG-001']),
  communityFixture('F05',baseIds.slice(0,7),['HELP-001','RET-001']),
  communityFixture('F06',baseIds.filter((id)=>id!=='RET-001'),['HELP-001','EVENT-001'],'RET-001'),
];
