import {canonicalSignal,signalRegistry} from '../../events/src/registry.js';
import type {MetricEpisode,MetricEvent} from './index.js';
export type CoverageMetric={signal:string,expected:number|null,observed:number|null,status:'healthy'|'degraded'|'incomplete'|'unavailable'};
export function inputCoverage(signal:string,expected:number|null,observed:number|null):CoverageMetric{return {signal,expected,observed,status:expected===null||observed===null?'unavailable':observed>=expected?'healthy':observed===0?'incomplete':'degraded'};}
export const metricRegistry={
 new_members:{version:1,input:'members'},onboarding_completion:{version:2,input:'onboarding'},home_actions_completion:{version:1,input:'native'},
 activation_rate:{version:2,input:'activation'},ttfv_median:{version:2,input:'activation'},ttfv_p75:{version:2,input:'activation'},ttfv_p90:{version:2,input:'activation'},
 direct_reply_connection_rate:{version:1,input:'messages'},median_first_reply_latency:{version:1,input:'messages'},
 d1_active_retention:{version:2,input:'activity'},d7_active_retention:{version:2,input:'activity'},d30_active_retention:{version:2,input:'activity'},leave_rate:{version:1,input:'members'}
} as const;
export type MetricKey=keyof typeof metricRegistry;
export type MetricResult={metricKey:MetricKey,metricVersion:number,value:number|null,numerator?:number,denominator?:number,sampleSize:number,window:{from:string,to:string,asOf:string},dataCoverage:CoverageMetric,provisional:boolean,definitionIds?:string[]};
export function percentile(values:number[],p:number){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),i=(s.length-1)*p;return s[Math.floor(i)]!+(s[Math.ceil(i)]!-s[Math.floor(i)]!)*(i%1);}
export function canonicalMetrics(episodes:MetricEpisode[],events:MetricEvent[],from:number,to:number,asOf:number,coverage:Record<string,CoverageMetric>,activationSeconds=604800,definitions:Record<string,{id:string,windowSeconds:number}>={}):Record<MetricKey,MetricResult>{
 const cohort=episodes.filter(e=>e.context==='PRODUCTION'&&e.joinedAt>=from&&e.joinedAt<to&&e.joinedAt<=asOf);
 const facts=(e:MetricEpisode)=>events.filter(f=>f.context==='PRODUCTION'&&f.episodeId===e.id&&f.at>=e.joinedAt&&f.at<=asOf);
 const mature=(seconds:number)=>cohort.filter(e=>e.joinedAt+seconds*1000<=asOf);
 const activationWindow=(e:MetricEpisode)=>definitions[e.id]?.windowSeconds??activationSeconds;
 const activationMature=cohort.filter(e=>e.joinedAt+activationWindow(e)*1000<=asOf);
 const has=(e:MetricEpisode,kind:string,seconds:number)=>facts(e).some(f=>canonicalSignal(f.kind)===kind&&f.at<=e.joinedAt+seconds*1000);
 const results={} as Record<MetricKey,MetricResult>;
 const put=(key:MetricKey,value:number|null,n:number,provisional=false,numerator?:number,denominator?:number)=>{
  const d=metricRegistry[key],c=coverage[d.input]??inputCoverage(d.input,null,null);
  results[key]={metricKey:key,metricVersion:d.version,value:c.status==='unavailable'||c.status==='incomplete'?null:value,sampleSize:n,window:{from:new Date(from).toISOString(),to:new Date(to).toISOString(),asOf:new Date(asOf).toISOString()},dataCoverage:c,provisional,...(numerator===undefined?{}:{numerator,denominator}),...(d.input==='activation'?{definitionIds:[...new Set(cohort.map(e=>definitions[e.id]?.id??'legacy'))].sort()}: {})};
 };
 const rate=(key:MetricKey,eligible:MetricEpisode[],yes:(e:MetricEpisode)=>boolean)=>{const n=eligible.filter(yes).length;put(key,eligible.length?n/eligible.length:null,eligible.length,eligible.length<cohort.length,n,eligible.length);};
 put('new_members',cohort.length,cohort.length);
 rate('onboarding_completion',mature(activationSeconds),e=>has(e,'native_onboarding.observed_completed',activationSeconds)||has(e,'fallback.completed',activationSeconds));
 rate('home_actions_completion',mature(activationSeconds),e=>has(e,'home_actions.observed_completed',activationSeconds));
 rate('activation_rate',activationMature,e=>has(e,'activation.completed',activationWindow(e)));
 const ttfv=cohort.flatMap(e=>{const activation=facts(e).filter(f=>f.kind==='activation.completed'&&f.at<=e.joinedAt+activationWindow(e)*1000);return activation.length?[(Math.min(...activation.map(f=>f.at))-e.joinedAt)/1000]:[];});
 for(const [key,p] of [['ttfv_median',.5],['ttfv_p75',.75],['ttfv_p90',.9]] as const)put(key,percentile(ttfv,p),ttfv.length,activationMature.length<cohort.length);
 const messages=cohort.flatMap(e=>{const first=facts(e).filter(f=>f.kind==='message.sent'&&f.at<=e.joinedAt+activationSeconds*1000).sort((a,b)=>a.at-b.at)[0];return first&&first.at+86400000<=asOf?[first]:[];});
 const latencies=messages.flatMap(f=>typeof f.data.firstReplyLatencySeconds==='number'&&f.data.firstReplyLatencySeconds<=86400?[f.data.firstReplyLatencySeconds]:[]);
 put('direct_reply_connection_rate',messages.length?latencies.length/messages.length:null,messages.length,messages.length<cohort.length,latencies.length,messages.length);
 put('median_first_reply_latency',percentile(latencies,.5),latencies.length);
 for(const d of [1,7,30] as const)rate(`d${d}_active_retention`,mature((d+1)*86400),e=>facts(e).some(f=>{const key=canonicalSignal(f.kind);return key&&signalRegistry[key].active&&f.at>=e.joinedAt+d*86400000&&f.at<e.joinedAt+(d+1)*86400000;}));
 rate('leave_rate',mature(activationSeconds),e=>has(e,'member.left',activationSeconds));return results;
}
