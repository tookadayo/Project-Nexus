import {ButtonStyle} from 'discord-api-types/v10';
import {formatDuration,formatNumber,formatPercentage} from '../formatting.js';
import {discordLabel,t,type MessageKey,type UiLocale} from '../i18n/index.js';
import {actionRow,divider,footer,nexusPanel,section,type Panel} from '../primitives.js';
import {coverageLabel} from '../status.js';
import type {Issue,MetricLike,Metrics} from '../types.js';
const unavailable:Record<string,MessageKey>={d1_active_retention:'lifecycle.d1Pending',d7_active_retention:'lifecycle.d7Pending',d30_active_retention:'lifecycle.d30Pending',onboarding_completion:'lifecycle.onboardingPending',home_actions_completion:'lifecycle.homePending'};
const show=(metric:MetricLike|undefined,kind:'rate'|'duration'|'number',locale:UiLocale)=>{
 if(!metric||metric.value===null)return t(locale,unavailable[metric?.metricKey??'']??'common.notAvailableYet');
 const value=kind==='rate'?formatPercentage(metric.value,0,locale):kind==='duration'?formatDuration(metric.value,locale):formatNumber(metric.value,locale);
 return `**${value}**\n-# ${t(locale,'lifecycle.mature',{count:metric.sampleSize})} · ${coverageLabel(metric.dataCoverage.status,metric.dataCoverage.expected?Number(metric.dataCoverage.observed)/metric.dataCoverage.expected:undefined,locale)}${metric.provisional?` · ${t(locale,'lifecycle.provisional')}`:''}`;
};
export async function lifecyclePanel(issue:Issue,metrics:Metrics,locale:UiLocale='en'):Promise<Panel>{return nexusPanel({title:t(locale,'area.journey'),subtitle:t(locale,'area.journeySubtitle'),children:[divider(),
 section(t(locale,'lifecycle.join'),`${t(locale,'common.newMembers')}\n${show(metrics.new_members,'number',locale)}`),section(t(locale,'lifecycle.onboard'),`${t(locale,'lifecycle.completion')}\n${show(metrics.onboarding_completion,'rate',locale)}`),
 section(t(locale,'lifecycle.activate'),`${t(locale,'common.activation')}\n${show(metrics.activation_rate,'rate',locale)}\n\n${t(locale,'lifecycle.medianTtfv')}\n${show(metrics.ttfv_median,'duration',locale)}`),section(t(locale,'lifecycle.connect'),`${t(locale,'common.firstReply')}\n${show(metrics.direct_reply_connection_rate,'rate',locale)}\n\n${t(locale,'lifecycle.medianReply')}\n${show(metrics.median_first_reply_latency,'duration',locale)}`),
 section(t(locale,'lifecycle.retain'),`D1\n${show(metrics.d1_active_retention,'rate',locale)}\n\nD7\n${show(metrics.d7_active_retention,'rate',locale)}\n\nD30\n${show(metrics.d30_active_retention,'rate',locale)}`),divider(),footer(t(locale,'lifecycle.footer'))
 ],rows:[await actionRow(issue,[{label:discordLabel(locale,'common.diagnose'),action:'diagnose',style:ButtonStyle.Primary},{label:discordLabel(locale,'common.overview'),action:'overview'},{label:discordLabel(locale,'common.refresh'),action:'lifecycle'}])]});}
