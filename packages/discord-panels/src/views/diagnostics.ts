import {ButtonStyle} from 'discord-api-types/v10';
import {formatDuration,formatPercentage,formatSignedPoints} from '../formatting.js';
import {discordLabel,t,type UiLocale} from '../i18n/index.js';
import {actionRow,divider,emptyState,footer,nexusPanel,section,type Panel} from '../primitives.js';
import {diagnosisLabel} from '../status.js';
import type {Issue} from '../types.js';
export type DiagnosisView={type:string;severity:'warning'|'critical';comparison:{current:number;baseline:number}|null;facts:Record<string,number|string>;sampleSize:number;confidenceLabel:'insufficient'|'observational'};
const isDuration=(type:string)=>type.includes('TTFV')||type.includes('LATENCY');
export async function diagnosticsPanel(issue:Issue,findings:DiagnosisView[],locale:UiLocale='en'):Promise<Panel>{
 const children=findings.length?findings.flatMap((finding,index)=>{const comparison=finding.comparison,fmt=(value:number)=>isDuration(finding.type)?formatDuration(value,locale):formatPercentage(value,0,locale);const count=Number(finding.facts.affectedMetrics??finding.sampleSize);const body=comparison?`${t(locale,'diagnostics.current')}\n**${fmt(comparison.current)}**\n\n${t(locale,'diagnostics.previous')}\n**${fmt(comparison.baseline)}**\n\n${t(locale,'diagnostics.change')}\n**${isDuration(finding.type)?formatDuration(comparison.current-comparison.baseline,locale):formatSignedPoints(comparison.current-comparison.baseline,locale)}**`:t(locale,'diagnostics.requireAttention',{count});return [...(index?[divider()]:[]),section(diagnosisLabel(finding.type,locale),body)];}):[emptyState(t(locale,'diagnostics.empty'),t(locale,'diagnostics.emptyDetail'))];
 return nexusPanel({title:t(locale,'diagnostics.title'),subtitle:t(locale,'diagnostics.subtitle'),accent:findings.some(f=>f.severity==='critical')?'critical':findings.length?'warning':'healthy',children:[divider(),...children,divider(),footer(t(locale,'diagnostics.footer'))],rows:[await actionRow(issue,[{label:discordLabel(locale,'overview.createExperiment'),action:'experiments',style:ButtonStyle.Primary},{label:discordLabel(locale,'common.lifecycle'),action:'lifecycle'},{label:discordLabel(locale,'common.refresh'),action:'diagnose'}])]});
}
