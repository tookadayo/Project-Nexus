import {ButtonStyle} from 'discord-api-types/v10';
import {formatDuration,formatNumber,formatPercentage} from '../formatting.js';
import {actionRow,divider,footer,nexusPanel,section,type Panel} from '../primitives.js';
import {coverageLabel} from '../status.js';
import type {Issue,MetricLike,Metrics} from '../types.js';

const unavailable:Record<string,string>={d1_active_retention:'D1 appears after the first full retention window.',d7_active_retention:'D7 appears after members reach the 7-day observation window.',d30_active_retention:'D30 is not mature yet.',onboarding_completion:'Onboarding completion is still being observed.',home_actions_completion:'Native Home Actions are not available for this cohort.'};
const show=(metric:MetricLike|undefined,kind:'rate'|'duration'|'number')=>{
 if(!metric||metric.value===null)return unavailable[metric?.metricKey??'']??'Not available yet.';
 const value=kind==='rate'?formatPercentage(metric.value):kind==='duration'?formatDuration(metric.value):formatNumber(metric.value);
 return `**${value}**\n-# ${metric.sampleSize} mature · ${coverageLabel(metric.dataCoverage.status,metric.dataCoverage.expected?Number(metric.dataCoverage.observed)/metric.dataCoverage.expected:undefined)}${metric.provisional?' · Provisional':''}`;
};
export async function lifecyclePanel(issue:Issue,metrics:Metrics):Promise<Panel>{
 return nexusPanel({title:'NEXUS · Observable Lifecycle',subtitle:'JOIN → ONBOARD → ACTIVATE → CONNECT → RETAIN',children:[divider(),
  section('JOIN',`New Members\n${show(metrics.new_members,'number')}`),
  section('ONBOARD',`Completion\n${show(metrics.onboarding_completion,'rate')}`),
  section('ACTIVATE',`Activation\n${show(metrics.activation_rate,'rate')}\n\nMedian TTFV\n${show(metrics.ttfv_median,'duration')}`),
  section('CONNECT',`First Reply\n${show(metrics.direct_reply_connection_rate,'rate')}\n\nMedian Reply Time\n${show(metrics.median_first_reply_latency,'duration')}`),
  section('RETAIN',`D1\n${show(metrics.d1_active_retention,'rate')}\n\nD7\n${show(metrics.d7_active_retention,'rate')}\n\nD30\n${show(metrics.d30_active_retention,'rate')}`),
  divider(),footer('Missing or immature observations are not counted as zero.')
 ],rows:[await actionRow(issue,[{label:'Diagnose',action:'diagnose',style:ButtonStyle.Primary},{label:'Overview',action:'overview'},{label:'Refresh',action:'lifecycle'}])]});
}
