import {ButtonStyle} from 'discord-api-types/v10';
import {formatDuration,formatPercentage,formatSignedPoints,humanize} from '../formatting.js';
import {actionRow,divider,emptyState,footer,nexusPanel,section,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';

export type DiagnosisView={type:string;severity:'warning'|'critical';comparison:{current:number;baseline:number}|null;facts:Record<string,number|string>;sampleSize:number;confidenceLabel:'insufficient'|'observational'};
const labels:Record<string,string>={ACTIVATION_DROP:'Activation dropped',TTFV_SPIKE:'Time to first value increased',CONNECTION_DROP:'First replies dropped',REPLY_LATENCY_SPIKE:'Reply time increased',ONBOARDING_DROP:'Onboarding completion dropped',HOME_ACTION_DROP:'Home Actions completion dropped',RETENTION_DROP:'D7 retention dropped',DATA_COVERAGE_DROP:'Data coverage needs attention',ACTION_FAILURE_SPIKE:'Intervention failures increased'};
const isDuration=(type:string)=>type.includes('TTFV')||type.includes('LATENCY');
export async function diagnosticsPanel(issue:Issue,findings:DiagnosisView[]):Promise<Panel>{
 const children=findings.length?findings.flatMap((finding,index)=>{
  const comparison=finding.comparison;
  const fmt=(value:number)=>isDuration(finding.type)?formatDuration(value):formatPercentage(value);
  const body=comparison?`Current cohort\n**${fmt(comparison.current)}**\n\nPrevious comparable cohort\n**${fmt(comparison.baseline)}**\n\nChange\n**${isDuration(finding.type)?formatDuration(comparison.current-comparison.baseline):formatSignedPoints(comparison.current-comparison.baseline)}**`:`${Number(finding.facts.affectedMetrics??finding.sampleSize)} signal${Number(finding.facts.affectedMetrics??finding.sampleSize)===1?'':'s'} require attention.`;
  return [...(index?[divider()]:[]),section(labels[finding.type]??humanize(finding.type),body)];
 }):[emptyState('No comparable signal yet','NEXUS has not found a diagnosis with enough comparable evidence.\nMissing data is not treated as zero.')];
 return nexusPanel({title:'NEXUS · Diagnoses',subtitle:'Observational signals across comparable cohorts',accent:findings.some(f=>f.severity==='critical')?'critical':findings.length?'warning':'healthy',children:[divider(),...children,divider(),footer('Observational signal only. This does not establish causality.')],rows:[await actionRow(issue,[{label:'Create Experiment',action:'experiments',style:ButtonStyle.Primary},{label:'Lifecycle',action:'lifecycle'},{label:'Refresh',action:'diagnose'}])]});
}
