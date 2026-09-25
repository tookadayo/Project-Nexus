import {ButtonStyle,ComponentType,type APIButtonComponent,type APIStringSelectComponent} from 'discord-api-types/v10';
import type {CommunityService} from '../../../presentation/src/community.js';
import {t,type UiLocale} from '../i18n/index.js';
import {actionRow,callout,divider,footer,metricGrid,nexusPanel,type ActionRow,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';

export const controlPages=['overview','newMembers','community','channels','improve','results','settings','diagnostics'] as const;
export type ControlPage=typeof controlPages[number];
type Community=Awaited<ReturnType<CommunityService['overview']>>;
export type ControlData={
 community?:Community|null;
 settings?:{analysisScope:{mode:string;channelIds:string[]};weeklySummaryEnabled:boolean;helperEnabled:boolean;goalPreset:'multiplayer'|'early_access'|'live_service'|null;uiLanguage:string};
 results?:{controlRate:number|null;treatmentRate:number|null;controlN:number;treatmentN:number;state:string}|null;
 diagnostics?:{gatewayConnected:boolean;transport:'gateway'|'webhook';commandsRegistered:boolean;lastReceivedAt:string|null;lastResult:string|null};
 dashboardUrl?:string;
 updatedAt?:Date;
};
const percent=(value:number|null|undefined)=>value===null||value===undefined?'—':`${value}%`;
const rate=(value:number|null|undefined)=>value===null||value===undefined?'—':`${Math.round(value*100)}%`;
const date=(value:string,locale:UiLocale)=>new Intl.DateTimeFormat(locale==='en'?'en-US':'ja-JP',{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'}).format(new Date(value));

export async function controlPanel(issue:Issue,page:ControlPage,data:ControlData,locale:UiLocale='en'):Promise<Panel>{
 const children=[divider()],community=data.community;
 if(page==='overview'||page==='newMembers'){
  if(community){
   const window=community.cohortWindow;
   children.push(callout(t(locale,'control.joinedPeriod',{from:date(window.joinedFrom,locale),through:date(new Date(new Date(window.joinedThrough).getTime()-1).toISOString(),locale),days:window.observedThroughDays}),t(locale,'control.sample',{count:community.eligibleMembers})));
   if(community.dataReady){
    children.push(metricGrid(community.stages.map(step=>({label:t(locale,`control.${step.key==='joined'?'joined':step.key==='activated'?'activated':step.key==='connected'?'connected':step.key==='repeated'?'repeated':'retained'}`),value:String(step.count)}))));
    if(community.largestDrop)children.push(callout(t(locale,'control.improve'),t(locale,'control.largestDrop',{from:t(locale,`control.${community.largestDrop.fromKey as 'joined'}`),to:t(locale,`control.${community.largestDrop.toKey as 'joined'}`)})));
   }else children.push(callout(t(locale,'control.newMembers'),t(locale,'control.moreData')));
   if(page==='newMembers')children.push(metricGrid([{label:t(locale,'control.retained'),value:String(community.outcomes.retained)},{label:t(locale,'control.moreData'),value:String(community.outcomes.pending+community.outcomes.insufficient)}]));
   if(page==='overview')children.push(callout(t(locale,'control.today'),community.daily.ready?`${t(locale,'control.unanswered',{count:community.daily.attentionCount??0})}\n${t(locale,'control.yesterday',{joined:community.daily.yesterdayJoined??0,connected:community.daily.yesterdayConnected??0})}`:t(locale,'control.queueUnavailable')));
   if(page==='newMembers'){
    if(!community.daily.ready)children.push(callout(t(locale,'control.today'),t(locale,'control.queueUnavailable')));
    else if(community.attention.length)for(const item of community.attention)children.push(callout(t(locale,'control.queueTitle',{channel:item.channelId}),t(locale,'control.queueDetail',{minutes:item.waitingMinutes,url:item.url})));
    else children.push(callout(t(locale,'control.today'),t(locale,'control.queueEmpty')));
   }
  }else children.push(callout(t(locale,'control.newMembers'),t(locale,'control.moreData')));
 }else if(page==='community'){
  if(community){children.push(metricGrid([{label:t(locale,'control.continuing'),value:String(community.classification.continuing)},{label:t(locale,'control.inactive'),value:String(community.classification.inactive)},{label:t(locale,'control.exited'),value:String(community.classification.exited)},{label:t(locale,'control.staffExcluded'),value:String(community.classification.staffExcluded)}]));
   children.push(callout(t(locale,'control.newMembers'),community.compare.available?t(locale,'control.replyComparison',{new:community.compare.newcomers?.replyMinutes??'—',regular:community.compare.continuing?.replyMinutes??'—'}):t(locale,'control.noComparison')));
   children.push(callout(t(locale,'helper.coverage'),community.helperCoverage.length?community.helperCoverage.map(row=>t(locale,'helper.coverageLine',{from:row.fromHourUtc,through:row.throughHourUtc,minutes:row.medianReplyMinutes,count:row.sample})).join('\n'):t(locale,'helper.coverageUnavailable')));
  }else children.push(callout(t(locale,'control.community'),t(locale,'control.moreData')));
 }else if(page==='channels'){
  if(community?.channels.length){for(const channel of community.channels.slice(0,5)){const purpose=community.importantPlaces.find(item=>item.channelId===channel.channelId)?.purpose;children.push(callout(`<#${channel.channelId}>${purpose?` · ${t(locale,`goal.${purpose}`)}`:''}`,t(locale,'control.channelLine',{count:channel.newcomers,reply:percent(channel.receivedReplyPercent),elsewhere:percent(channel.laterElsewherePercent),later:percent(channel.weekLaterPercent)})));}
   if(community.hiddenChannelCount)children.push(footer(t(locale,'control.hiddenChannels',{count:community.hiddenChannelCount})));
  }else children.push(callout(t(locale,'control.channels'),t(locale,'control.noChannels')));
 }else if(page==='improve')children.push(callout(t(locale,'control.improve'),community?.suggestion?.key==='reply_rescue'?t(locale,'control.replySuggestion'):t(locale,'control.noSuggestion')));
 else if(page==='results')children.push(data.results?metricGrid([{label:t(locale,'experiment.control'),value:rate(data.results.controlRate),note:t(locale,'experiment.matureAssigned',{count:data.results.controlN})},{label:t(locale,'experiment.treatment'),value:rate(data.results.treatmentRate),note:t(locale,'experiment.matureAssigned',{count:data.results.treatmentN})}]):callout(t(locale,'control.results'),t(locale,'control.noResults')));
 else if(page==='settings')children.push(data.settings?metricGrid([{label:t(locale,'control.scope'),value:data.settings.analysisScope.mode==='all'?t(locale,'control.scopeAll'):data.settings.analysisScope.mode==='include'?t(locale,'control.scopeInclude'):t(locale,'control.scopeExclude')},{label:t(locale,'control.weekly'),value:t(locale,data.settings.weeklySummaryEnabled?'control.on':'control.off')},{label:t(locale,'helper.title'),value:t(locale,data.settings.helperEnabled?'control.on':'control.off')},{label:t(locale,'goal.preset'),value:data.settings.goalPreset?t(locale,`goal.${data.settings.goalPreset}`):t(locale,'goal.none')},{label:t(locale,'settings.language'),value:t(locale,data.settings.uiLanguage==='auto'?'settings.auto':data.settings.uiLanguage==='ja'?'settings.japanese':data.settings.uiLanguage==='en'?'settings.english':'settings.bilingual')} ]):callout(t(locale,'control.settings'),t(locale,'control.moreData')));
 else if(page==='diagnostics')children.push(data.diagnostics?metricGrid([{label:'Discord Gateway',value:data.diagnostics.gatewayConnected?t(locale,'control.on'):t(locale,'control.off')},{label:t(locale,'control.commandStatus'),value:data.diagnostics.commandsRegistered?t(locale,'control.on'):t(locale,'control.off')},{label:t(locale,'control.lastCommand'),value:data.diagnostics.lastReceivedAt?date(data.diagnostics.lastReceivedAt,locale):t(locale,'control.noCommand')} ]):callout(t(locale,'control.diagnostics'),t(locale,'control.moreData')));
 if(page==='diagnostics'&&data.diagnostics?.transport==='gateway')children.push(footer(t(locale,'control.gatewayHint')));
 const select:ActionRow={type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'controlNavigate'},true),placeholder:t(locale,'control.choosePage'),options:controlPages.map(value=>({label:t(locale,`control.${value}`),value,default:page===value}))} satisfies APIStringSelectComponent]};
 const buttons=await actionRow(issue,[{label:t(locale,'control.refresh'),action:'controlRefresh',data:{page},publicEntry:true,style:ButtonStyle.Primary},{label:t(locale,'control.openImprove'),action:'improve',publicEntry:true},{label:t(locale,'control.openSettings'),action:'settings',publicEntry:true}]);
 try{if(data.dashboardUrl&&/^https?:$/.test(new URL(data.dashboardUrl).protocol))buttons.components.push({type:ComponentType.Button,style:ButtonStyle.Link,label:t(locale,'control.openWeb'),url:data.dashboardUrl} satisfies APIButtonComponent);}catch{/* No link when the URL is invalid. */}
 children.push(footer(t(locale,'control.updated',{time:`<t:${Math.floor((data.updatedAt??new Date()).getTime()/1000)}:R>`})));
 return nexusPanel({title:t(locale,'control.title'),subtitle:`${t(locale,`control.${page}`)} · ${t(locale,'control.subtitle')}`,children,rows:[select,buttons]});
}
