import type {Diagnosis} from '../../analytics/src/diagnoses.js';
import type {MetricKey,MetricResult} from '../../analytics/src/registry.js';
import type {ExperimentDefinition} from '../../lifecycle/src/experiments.js';
import type {InterventionDefinition} from '../../lifecycle/src/interventions.js';
import type {ActionPresentation,DataHealthSummary,DeliveryFunnel,DeliveryState,ExperimentPresentation,JourneyStage,KPI,Maturity,Opportunity,PresentationMetricKey,TrendPoint} from './types.js';

const ranks={healthy:0,degraded:1,incomplete:2,unavailable:3} as const;
export function dataHealth(metric?:MetricResult):DataHealthSummary{
 if(!metric)return {status:'unavailable',coverageRatio:null,label:'unavailable',notes:['no_verified_data']};
 const {status,expected,observed}=metric.dataCoverage,ratio=expected&&observed!==null?Math.max(0,Math.min(1,observed/expected)):status==='healthy'?1:null;
 return {status,coverageRatio:ratio,label:status==='healthy'?'healthy':status==='unavailable'||status==='incomplete'?'unavailable':'partial',notes:[...(metric.provisional?['maturing' as const]:[]),...(status==='healthy'?[]:['missing_observations' as const])]};
}
export function aggregateHealth(metrics:(MetricResult|undefined)[]):DataHealthSummary{
 const health=metrics.map(dataHealth),worst=health.sort((a,b)=>ranks[b.status]-ranks[a.status])[0]??dataHealth();
 const known=health.map(h=>h.coverageRatio).filter((v):v is number=>v!==null);
 return {...worst,coverageRatio:known.length?Math.min(...known):null,notes:[...new Set(health.flatMap(h=>h.notes))]};
}
export const maturity=(metric?:MetricResult):Maturity=>!metric||metric.value===null?'unavailable':metric.provisional?'provisional':'mature';
export function toTrendPoint(bucket:string,metric?:MetricResult):TrendPoint{return {bucket,value:metric?.value??null,sampleSize:metric?.sampleSize??0,maturity:maturity(metric),coverage:dataHealth(metric)};}
export function retentionMaturity(value:number|null,cohortStart:number,day:number,asOf:number,available=true):Maturity{return value!==null?'mature':asOf<cohortStart+(day+1)*86400000?'provisional':available?'unavailable':'unavailable';}
export function toKpi(key:KPI['key'],current?:MetricResult,previous?:MetricResult):KPI{
 const a=current?.value??null,b=previous?.value??null;
 return {key,current:a,previous:b,delta:a!==null&&b!==null?a-b:null,sampleSize:current?.sampleSize??0,maturity:maturity(current),coverage:dataHealth(current)};
}
const stageMetric:Record<Exclude<JourneyStage['key'],'joined'>,PresentationMetricKey>={onboarded:'onboarding_completion',first_value:'activation_rate',connected:'direct_reply_connection_rate',d7_active:'d7_active_retention'};
export function toJourney(metrics:Partial<Record<MetricKey,MetricResult>>):JourneyStage[]{
 const joined=metrics.new_members,count=joined?.value??null;
 return (['joined','onboarded','first_value','connected','d7_active'] as const).map(key=>{
  const metric=key==='joined'?joined:metrics[stageMetric[key]],stageCount=key==='joined'?count:metric?.value===null||metric?.value===undefined?null:metric.numerator??null;
  return {key,value:metric?.value??null,valueKind:key==='joined'?'count':'rate',count:stageCount,rateFromJoined:key==='joined'&&count!==null?1:null,conversionFromPrevious:null,sampleSize:metric?.sampleSize??0,sampleKind:key==='joined'?'observed':key==='first_value'||key==='d7_active'?'mature':'eligible',maturity:maturity(metric),coverage:dataHealth(metric)};
 });
}
const opportunityMap:Record<string,{stage:Opportunity['stage'];suggested:Opportunity['suggestedAction']}>= {ACTIVATION_DROP:{stage:'first_value',suggested:'welcome_helper'},TTFV_SPIKE:{stage:'first_value',suggested:'welcome_helper'},CONNECTION_DROP:{stage:'connected',suggested:'reply_rescue'},REPLY_LATENCY_SPIKE:{stage:'connected',suggested:'reply_rescue'},ONBOARDING_DROP:{stage:'onboarded',suggested:'welcome_helper'},HOME_ACTION_DROP:{stage:'onboarded',suggested:'channel_recommendation'},RETENTION_DROP:{stage:'d7_active',suggested:'inactive_follow_up'},DATA_COVERAGE_DROP:{stage:'data',suggested:null},ACTION_FAILURE_SPIKE:{stage:'delivery',suggested:null}};
export function toOpportunity(diagnosis:Diagnosis,index:number,metrics:Partial<Record<MetricKey,MetricResult>>):Opportunity{
 const key=typeof diagnosis.facts.metric==='string'?diagnosis.facts.metric as MetricKey:undefined,metric=key?metrics[key]:undefined,current=diagnosis.comparison?.current??null,previous=diagnosis.comparison?.baseline??null,map=opportunityMap[diagnosis.type]??{stage:'data' as const,suggested:null};
 return {id:`${diagnosis.type.toLowerCase()}-${index+1}`,type:diagnosis.type,severity:diagnosis.severity,stage:map.stage,current,previous,difference:current!==null&&previous!==null?current-previous:null,sampleSize:diagnosis.sampleSize,dataHealth:dataHealth(metric),evidence:diagnosis.confidenceLabel,causality:'not_established',reason:diagnosis.type==='DATA_COVERAGE_DROP'?'measurement_coverage':diagnosis.type==='ACTION_FAILURE_SPIKE'?'delivery_failures':'threshold_change',suggestedAction:map.suggested};
}
export function rankOpportunities(items:Opportunity[]):Opportunity[]{
 const severity=(item:Opportunity)=>item.severity==='critical'?1:0,coverage=(item:Opportunity)=>item.dataHealth.status==='healthy'?1:item.dataHealth.status==='degraded'?.5:0;
 return [...items].sort((a,b)=>severity(b)-severity(a)||Math.abs(b.difference??0)-Math.abs(a.difference??0)||Math.log1p(b.sampleSize)*coverage(b)-Math.log1p(a.sampleSize)*coverage(a)||a.type.localeCompare(b.type));
}
export function deliveryState(state:string|undefined):DeliveryState|null{return state==='suggested'||state==='approval'?'eligible':state==='queued'||state==='running'?'approved':state==='delivered'||state==='failed'||state==='unknown'||state==='suppressed'?state:null;}
export function deliveryFunnel(states:string[]):DeliveryFunnel{
 const count=(...values:string[])=>states.filter(s=>values.includes(s)).length;
 return {triggered:states.length,eligible:count('suggested','approval','queued','running','delivered','failed','unknown'),approved:count('queued','running','delivered','failed','unknown'),delivered:count('delivered'),failed:count('failed'),unknown:count('unknown'),suppressed:count('suppressed')};
}
export function toAction(row:{id:string;version:number;definition:InterventionDefinition},runs:{id:string;state:string}[]):ActionPresentation{
 const d=row.definition,action=d.actions[0]!,condition=d.conditions[0],conditionName=condition?.op==='connection_state'&&condition.connected===false?'not_connected':condition?.op==='activation_state'&&condition.activated===false?'not_activated':'all_eligible';
 const actionNames:Record<string,ActionPresentation['action']>={staff_alert:'staff_alert',send_dm:'send_dm',recommend_channels:'recommend_channels',recommend_event:'recommend_event',channel_message:'channel_message',assign_nexus_role:'assign_role',remove_nexus_role:'remove_role'};
 const states=runs.map(r=>r.state);return {id:row.id,name:d.name,version:row.version,status:'active',trigger:d.trigger,delaySeconds:d.delaySeconds,condition:conditionName,action:actionNames[action.type]!,safety:{mode:d.safetyMode,contactsPerWeek:d.frequencyCaps.contactsPerWeek,dmPerDay:d.frequencyCaps.dmPerDay},delivery:deliveryFunnel(states),recentState:deliveryState(states[0]),approvals:runs.filter(r=>r.state==='suggested'||r.state==='approval').map(r=>({id:r.id,state:'eligible' as const}))};
}
type ExperimentResult={controlN:number;treatmentN:number;controlRate:number|null;treatmentRate:number|null;absoluteLift:number|null;credibleInterval:(number|undefined)[]|null;probabilityTreatmentBetter:number|null;evidenceStatus:string;assigned:number;mature:number;provisional:boolean;guardrails:{deliveryFailureRate:number|null;alertVolume:number};dataCoverage:string;coverageRatio:number;randomization:'member'|'time_block';state:string};
export function toExperiment(row:{id:string;definition:ExperimentDefinition;publishedAt:string|null},result:ExperimentResult):ExperimentPresentation{
 const evidence=result.evidenceStatus==='SUPPORTED'?'supported':result.evidenceStatus==='DIRECTIONAL'?'directional':result.evidenceStatus==='INCONCLUSIVE'?'inconclusive':result.evidenceStatus==='GUARDRAIL_BREACH'?'guardrail':'insufficient';
 const health:DataHealthSummary={status:result.dataCoverage==='healthy'?'healthy':result.dataCoverage==='degraded'?'degraded':'unavailable',coverageRatio:result.coverageRatio,label:result.dataCoverage==='healthy'?'healthy':result.coverageRatio>0?'partial':'unavailable',notes:result.provisional?['maturing']:[]};
 const interval=result.credibleInterval?.[0]!==undefined&&result.credibleInterval[1]!==undefined?[result.credibleInterval[0],result.credibleInterval[1]] as [number,number]:null;
 return {id:row.id,name:row.definition.name,primaryMetric:row.definition.primaryMetric,control:{sampleSize:result.controlN,rate:result.controlRate},treatment:{sampleSize:result.treatmentN,rate:result.treatmentRate},absoluteLift:result.absoluteLift,credibleInterval:interval,probabilityTreatmentBetter:result.probabilityTreatmentBetter,evidence,maturity:{assigned:result.assigned,mature:result.mature,provisional:result.provisional},deliveryHealth:{failureRate:result.guardrails.deliveryFailureRate,alertVolume:result.guardrails.alertVolume},guardrailStatus:result.state==='paused'?'paused':'healthy',dataHealth:health,randomization:result.randomization,timeline:{startedAt:row.publishedAt,windowDays:Math.round(row.definition.windowSeconds/86400)},analysis:'intention_to_treat',spilloverRisk:result.randomization==='time_block',state:result.state==='stopped'?'stopped':result.state==='paused'?'paused':'running'};
}
