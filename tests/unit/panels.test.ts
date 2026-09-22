import {ComponentType} from 'discord-api-types/v10';
import {describe,expect,it} from 'vitest';
import {coverageLabel,diagnosticsPanel,errorPanel,experimentsPanel,formatDuration,formatPercentage,lifecyclePanel,overviewPanel,rootPanel,settingsPanel,type MetricLike,type Panel} from '../../packages/discord-panels/src/index.js';

let counter=0;const issue=async()=>`opaque-${counter++}`;
const metric=(metricKey:string,value:number|null,sampleSize=12,status:MetricLike['dataCoverage']['status']='healthy'):MetricLike=>({metricKey,value,sampleSize,provisional:false,dataCoverage:{status,expected:100,observed:status==='healthy'?100:63}});
const metrics=()=>({
 new_members:metric('new_members',12),activation_rate:metric('activation_rate',.583),direct_reply_connection_rate:metric('direct_reply_connection_rate',.67),d7_active_retention:metric('d7_active_retention',.31),
 onboarding_completion:metric('onboarding_completion',.74),ttfv_median:metric('ttfv_median',1080),median_first_reply_latency:metric('median_first_reply_latency',523),d1_active_retention:metric('d1_active_retention',.54),d30_active_retention:metric('d30_active_retention',null,0)
});
const experiment=(evidenceStatus:string)=>({name:'Helper alert vs holdout',primaryMetric:'activation',minimumSample:20,windowSeconds:604800,result:{controlN:24,treatmentN:25,controlRate:.4,treatmentRate:.56,absoluteLift:.16,evidenceStatus,credibleInterval:evidenceStatus==='SUPPORTED'?[.02,.3]:null,probabilityTreatmentBetter:evidenceStatus==='SUPPORTED'?.98:null,dataCoverage:'healthy',coverageRatio:1,assigned:49,mature:49,provisional:false,guardrails:{leaveRate:.04,deliveryFailureRate:.02,alertVolume:25},randomization:'time_block',state:'running'}});
const json=(panel:Panel)=>JSON.stringify(panel);

describe('NEXUS Discord design system',()=>{
 it('formats percentages for people',()=>{expect(formatPercentage(.583)).toBe('58%');expect(formatPercentage(.583,1)).toBe('58.3%');});
 it('formats durations compactly',()=>{expect(formatDuration(523)).toBe('8m 43s');expect(formatDuration(3660)).toBe('1h 1m');});
 it('does not turn a zero sample into a zero metric',async()=>{const panel=await lifecyclePanel(issue,{...metrics(),activation_rate:metric('activation_rate',null,0)});expect(json(panel)).toContain('Not available yet');expect(json(panel)).not.toContain('**0%**');});
 it('explains an unavailable retention metric',async()=>{const panel=await lifecyclePanel(issue,metrics());expect(json(panel)).toContain('D30 is not mature yet');});
 it('formats partial coverage',()=>{expect(coverageLabel('degraded',.63)).toBe('Partial coverage · 63%');});
 it('formats healthy coverage without redundant percentage',()=>{expect(coverageLabel('healthy',1)).toBe('Healthy coverage');});
 it('renders the overview empty state without an unavailable wall',async()=>{const panel=await overviewPanel(issue,{new_members:metric('new_members',0,0)});expect(json(panel)).toContain('COLLECTING DATA');expect(json(panel)).toContain('Track the first newcomer');expect(json(panel).match(/Not available/g)?.length??0).toBe(0);});
 it('renders four populated overview KPIs',async()=>{const panel=await overviewPanel(issue,metrics());for(const label of ['Activation','New Members','First Reply','D7 Retention'])expect(json(panel)).toContain(label);expect(json(panel)).toContain('58%');});
 it('groups lifecycle metrics by stage',async()=>{const panel=await lifecyclePanel(issue,metrics());for(const stage of ['JOIN','ONBOARD','ACTIVATE','CONNECT','RETAIN'])expect(json(panel)).toContain(`### ${stage}`);});
 it('translates diagnosis enums and shows comparison',async()=>{const panel=await diagnosticsPanel(issue,[{type:'ACTIVATION_DROP',severity:'warning',comparison:{current:.41,baseline:.56},facts:{},sampleSize:30,confidenceLabel:'observational'}]);expect(json(panel)).toContain('Activation dropped');expect(json(panel)).toContain('−15 percentage points');expect(json(panel)).not.toContain('ACTIVATION_DROP');});
 it('renders insufficient experiment evidence in plain language',async()=>{const panel=await experimentsPanel(issue,experiment('INSUFFICIENT_DATA'));expect(json(panel)).toContain('Not enough data');expect(json(panel)).not.toContain('INSUFFICIENT_DATA');});
 it('renders supported experiment evidence without overstating causality',async()=>{const panel=await experimentsPanel(issue,experiment('SUPPORTED'));expect(json(panel)).toContain('Supported by current evidence');expect(json(panel)).toContain('Causality is not established');});
 it('renders a guardrail breach as a stopped safety state',async()=>{const panel=await experimentsPanel(issue,experiment('GUARDRAIL_BREACH'));expect(json(panel)).toContain('Stopped by guardrail');expect(json(panel)).toContain('paused because a safety limit was exceeded');});
 it('renders a standardized safe error panel',async()=>{const panel=await errorPanel(issue,'generic');expect(json(panel)).toContain("Action couldn't be completed");expect(json(panel)).toContain('No configuration change was committed');expect(json(panel)).not.toMatch(/stack|token|database error/i);});
 it('keeps generated panels within Discord component limits',async()=>{
  const panels=[await rootPanel(issue),await settingsPanel(issue,{enabled:false,onboardingEnabled:false,template:'Gaming',startChannelId:null,revision:0}),await overviewPanel(issue,metrics()),await lifecyclePanel(issue,metrics()),await experimentsPanel(issue,experiment('SUPPORTED'))];
  const count=(value:unknown):number=>value&&typeof value==='object'&&'type' in value?1+('components' in value&&Array.isArray(value.components)?value.components.reduce((n:number,c:unknown)=>n+count(c),0):0):0;
  for(const panel of panels){expect(panel.flags).toBe(32768);expect(panel.allowed_mentions).toEqual({parse:[]});expect((panel.components??[]).reduce((n,c)=>n+count(c),0)).toBeLessThanOrEqual(40);for(const component of panel.components??[])if(component.type===ComponentType.Container)expect(component.components.length).toBeLessThanOrEqual(40);}
 });
});
