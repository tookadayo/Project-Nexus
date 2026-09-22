import type {MetricKey,MetricResult} from './registry.js';
export const diagnosisRules=[
 {type:'ACTIVATION_DROP',key:'activation_rate',direction:'drop',threshold:.1},
 {type:'TTFV_SPIKE',key:'ttfv_median',direction:'spike',threshold:.5},
 {type:'CONNECTION_DROP',key:'direct_reply_connection_rate',direction:'drop',threshold:.1},
 {type:'REPLY_LATENCY_SPIKE',key:'median_first_reply_latency',direction:'spike',threshold:.5},
 {type:'ONBOARDING_DROP',key:'onboarding_completion',direction:'drop',threshold:.1},
 {type:'HOME_ACTION_DROP',key:'home_actions_completion',direction:'drop',threshold:.1},
 {type:'RETENTION_DROP',key:'d7_active_retention',direction:'drop',threshold:.1}
] as const;
export type Diagnosis={type:string,severity:'warning'|'critical',cohort:string,facts:Record<string,number|string>,comparison:{current:number,baseline:number}|null,sampleSize:number,confidenceLabel:'insufficient'|'observational',causality:'not_established'};
export function diagnose(current:Partial<Record<MetricKey,MetricResult>>,baseline:Partial<Record<MetricKey,MetricResult>>,cohort='New members',actionFailure?:{failed:number,total:number}):Diagnosis[]{
 const result:Diagnosis[]=[];
 for(const rule of diagnosisRules){
  const c=current[rule.key],b=baseline[rule.key];
  if(!c||!b||c.metricVersion!==b.metricVersion||JSON.stringify(c.definitionIds)!==JSON.stringify(b.definitionIds)||c.value===null||b.value===null||Math.min(c.sampleSize,b.sampleSize)<20||c.dataCoverage.status!=='healthy'||b.dataCoverage.status!=='healthy')continue;
  if(rule.direction==='drop'?b.value-c.value>=rule.threshold:b.value>0&&c.value>=b.value*(1+rule.threshold))result.push({type:rule.type,severity:'warning',cohort,facts:{metric:rule.key,current:c.value,baseline:b.value},comparison:{current:c.value,baseline:b.value},sampleSize:c.sampleSize,confidenceLabel:'observational',causality:'not_established'});
 }
 const missing=Object.values(current).filter(m=>m.dataCoverage.status!=='healthy');
 if(missing.length)result.push({type:'DATA_COVERAGE_DROP',severity:'warning',cohort,facts:{affectedMetrics:missing.length},comparison:null,sampleSize:0,confidenceLabel:'insufficient',causality:'not_established'});
 if(actionFailure&&actionFailure.total>=20&&actionFailure.failed/actionFailure.total>.1)result.push({type:'ACTION_FAILURE_SPIKE',severity:'critical',cohort,facts:actionFailure,comparison:null,sampleSize:actionFailure.total,confidenceLabel:'observational',causality:'not_established'});
 return result;
}
