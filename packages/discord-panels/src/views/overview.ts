import {ButtonStyle} from 'discord-api-types/v10';
import {formatNumber,formatPercentage} from '../formatting.js';
import {actionRow,divider,emptyState,footer,metricGrid,nexusPanel,recommendedAction,statusBanner,type Panel} from '../primitives.js';
import {coverageLabel} from '../status.js';
import type {Issue,MetricLike,Metrics} from '../types.js';

const metricNote=(metric:MetricLike|undefined)=>metric?`${metric.sampleSize} mature member${metric.sampleSize===1?'':'s'} · ${coverageLabel(metric.dataCoverage.status,metric.dataCoverage.expected?Number(metric.dataCoverage.observed)/metric.dataCoverage.expected:undefined)}`:'Observation window has not matured';

export async function overviewPanel(issue:Issue,metrics:Metrics):Promise<Panel>{
 const newcomers=metrics.new_members;
 if(!newcomers||newcomers.value===null||newcomers.value===0){
  return nexusPanel({title:'NEXUS · Community Overview',subtitle:'Community activation and retention snapshot',accent:'collecting',children:[
   divider(),statusBanner('COLLECTING DATA','NEXUS is connected and ready.\nNo new members have entered the tracked cohort yet.'),
   emptyState('Next milestone','Track the first newcomer.\n\nActivation, first reply, time to first value, and retention become measurable as observation windows mature.'),
   footer('Missing data is never treated as zero.')
  ],rows:[await actionRow(issue,[{label:'Refresh',action:'overview',style:ButtonStyle.Primary},{label:'Lifecycle',action:'lifecycle'},{label:'Setup',action:'setup'}])]});
 }
 const activation=metrics.activation_rate,reply=metrics.direct_reply_connection_rate,d7=metrics.d7_active_retention;
 const coverage=[activation,reply,d7,newcomers].filter(Boolean) as MetricLike[];
 const healthy=coverage.every(m=>m.dataCoverage.status==='healthy');
 const attention=!activation||activation.value===null?'Activation is still maturing.':!reply||reply.value===null?'First-reply measurement is still maturing.':!d7||d7.value===null?'D7 retention is not mature yet.':'No material data-quality issue detected.';
 return nexusPanel({title:'NEXUS · Community Overview',subtitle:'Community activation and retention snapshot',accent:healthy?'healthy':'collecting',children:[
  divider(),statusBanner(healthy?'HEALTHY DATA COVERAGE':'MEASUREMENT IN PROGRESS',healthy?'Primary signals are ready for interpretation.':'Some observation windows or inputs are still maturing.'),divider(),
  metricGrid([
   {label:'Activation',value:formatPercentage(activation?.value??null),note:metricNote(activation)},
   {label:'New Members',value:formatNumber(newcomers.value),note:'Rolling 30-day cohort'},
   {label:'First Reply',value:formatPercentage(reply?.value??null),note:metricNote(reply)},
   {label:'D7 Retention',value:formatPercentage(d7?.value??null),note:metricNote(d7)}
  ]),divider(),statusBanner('Attention',attention),
  recommendedAction(d7?.value===null?'Keep collecting mature cohorts':'Review lifecycle drop-offs',d7?.value===null?'D7 appears after members complete the required observation window.':'Use Lifecycle to locate the stage with the clearest opportunity.'),
  footer(`${coverageLabel(healthy?'healthy':'degraded')} · Updated from production cohorts only`)
 ],rows:[await actionRow(issue,[{label:'Create Experiment',action:'experiments',style:ButtonStyle.Primary},{label:'Lifecycle',action:'lifecycle'},{label:'Diagnose',action:'diagnose'},{label:'Refresh',action:'overview'}])]});
}
