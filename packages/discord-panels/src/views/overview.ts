import {ButtonStyle} from 'discord-api-types/v10';
import {formatNumber,formatPercentage} from '../formatting.js';
import {discordLabel,t,type UiLocale} from '../i18n/index.js';
import {actionRow,divider,emptyState,footer,metricGrid,nexusPanel,recommendedAction,statusBanner,type Panel} from '../primitives.js';
import {coverageLabel,diagnosisLabel} from '../status.js';
import type {Issue,MetricLike,Metrics} from '../types.js';

export type OverviewContext={diagnosis?:{type:string;severity:'warning'|'critical'};unansweredAfter24h?:number|null};
const metricNote=(metric:MetricLike|undefined,locale:UiLocale)=>metric?`${t(locale,'overview.matureMembers',{count:metric.sampleSize})} · ${coverageLabel(metric.dataCoverage.status,metric.dataCoverage.expected?Number(metric.dataCoverage.observed)/metric.dataCoverage.expected:undefined,locale)}`:t(locale,'overview.observationPending');

export async function overviewPanel(issue:Issue,metrics:Metrics,locale:UiLocale='en',context:OverviewContext={}):Promise<Panel>{
 const newcomers=metrics.new_members;
 if(!newcomers||newcomers.value===null||newcomers.value===0)return nexusPanel({title:t(locale,'overview.title'),subtitle:t(locale,'overview.subtitle'),accent:'collecting',children:[
  divider(),statusBanner(t(locale,'overview.collecting'),t(locale,'overview.connected')),emptyState(t(locale,'overview.milestone'),t(locale,'overview.trackFirst')),footer(t(locale,'overview.missingZero'))
 ],rows:[await actionRow(issue,[{label:discordLabel(locale,'common.refresh'),action:'overview',style:ButtonStyle.Primary},{label:discordLabel(locale,'common.lifecycle'),action:'lifecycle'},{label:discordLabel(locale,'common.setup'),action:'setup'}])]});
 const activation=metrics.activation_rate,reply=metrics.direct_reply_connection_rate,d7=metrics.d7_active_retention;
 const primary=[activation,reply,d7,newcomers].filter(Boolean) as MetricLike[],healthy=primary.length===4&&primary.every(m=>m.dataCoverage.status==='healthy');
 const dataWarnings=primary.filter(m=>m.dataCoverage.status!=='healthy').length;
 const performance=context.diagnosis?diagnosisLabel(context.diagnosis.type,locale):context.unansweredAfter24h&&context.unansweredAfter24h>0?t(locale,'overview.unanswered',{count:context.unansweredAfter24h}):t(locale,'overview.noIssue');
 const recommendation=context.diagnosis?{title:t(locale,'diagnostics.investigate'),detail:diagnosisLabel(context.diagnosis.type,locale)}:context.unansweredAfter24h&&context.unansweredAfter24h>0?{title:t(locale,'overview.reviewUnanswered'),detail:t(locale,'overview.reviewUnansweredDetail')}:d7?.value===null?{title:t(locale,'overview.keepCollecting'),detail:t(locale,'overview.keepCollectingDetail')}:{title:t(locale,'overview.reviewDropoffs'),detail:t(locale,'overview.reviewDropoffsDetail')};
 return nexusPanel({title:t(locale,'overview.title'),subtitle:t(locale,'overview.subtitle'),accent:context.diagnosis?.severity==='critical'?'critical':healthy?'healthy':'collecting',children:[
  divider(),statusBanner(healthy?t(locale,'overview.healthy'):t(locale,'overview.progress'),healthy?t(locale,'overview.healthyDetail'):t(locale,'overview.progressDetail')),divider(),
  metricGrid([{label:t(locale,'common.activation'),value:formatPercentage(activation?.value??null,0,locale),note:metricNote(activation,locale)},{label:t(locale,'common.newMembers'),value:formatNumber(newcomers.value,locale),note:t(locale,'overview.rolling')},{label:t(locale,'common.firstReply'),value:formatPercentage(reply?.value??null,0,locale),note:metricNote(reply,locale)},{label:t(locale,'common.d7Retention'),value:formatPercentage(d7?.value??null,0,locale),note:metricNote(d7,locale)}]),
  divider(),statusBanner(t(locale,'overview.attention'),performance),statusBanner(t(locale,'overview.dataHealth'),dataWarnings?t(locale,'overview.dataWarning',{count:dataWarnings}):t(locale,'overview.dataHealthy')),recommendedAction(recommendation.title,recommendation.detail,t(locale,'overview.recommended')),footer(`${coverageLabel(healthy?'healthy':'degraded',undefined,locale)} · ${t(locale,'overview.footer')}`)
 ],rows:[await actionRow(issue,[{label:discordLabel(locale,'overview.createExperiment'),action:'experiments',style:ButtonStyle.Primary},{label:discordLabel(locale,'common.lifecycle'),action:'lifecycle'},{label:discordLabel(locale,'common.diagnose'),action:'diagnose'},{label:discordLabel(locale,'common.refresh'),action:'overview'}])]});
}
