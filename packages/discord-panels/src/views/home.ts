import {t,type UiLocale} from '../i18n/index.js';
import {callout,divider,footer,metricGrid,type PanelChild} from '../primitives.js';
import type {ControlData} from './control.js';
import {activityWindow,replyDenominator,measurementLabel} from '../i18n/terminology.js';
export {measurementLabel} from '../i18n/terminology.js';
export function homeContent(data:ControlData,locale:UiLocale):PanelChild[]{
 const community=data.community,daily=community?.daily,children:PanelChild[]=[];
 children.push(callout(daily?.ready?(daily.attentionCount?`⚠️ ${t(locale,'experience.needsReply',{count:daily.attentionCount})}`:`✅ ${t(locale,'experience.allClear')}`):t(locale,'control.queueUnavailable'),daily?.ready?(community?.attention[0]?`<#${community.attention[0].channelId}> · ${t(locale,'control.minutes',{count:community.attention[0].waitingMinutes})}`:t(locale,'experience.queueRule',{count:data.settings?.firstResponseMinutes??20})):t(locale,'polish.monitoring')));
 children.push(divider(),callout(t(locale,'polish.today'),daily?.timezone??data.settings?.timezone??'UTC'));
 children.push(metricGrid([
  {label:t(locale,'control.joined'),value:daily?.todayJoined===null||daily?.todayJoined===undefined?t(locale,'polish.unavailable'):daily.todayJoined?t(locale,'polish.people',{count:daily.todayJoined}):t(locale,'polish.noneJoined')},
  {label:t(locale,'control.connected'),value:daily?.todayConnected===null||daily?.todayConnected===undefined?t(locale,'polish.unavailable'):daily.todayJoined===0?t(locale,'polish.noneEligible'):t(locale,'polish.people',{count:daily.todayConnected})},
  {label:`⏳ ${t(locale,'polish.waiting')}`,value:daily?.ready?t(locale,'polish.count',{count:daily.attentionCount??0}):t(locale,'polish.unavailable')}
 ]));
 const noEligibleWeek=community?.weekly&&Object.values(community.weekly).every(item=>item.state==='NO_ELIGIBLE_MEMBERS');
 children.push(divider(),callout(t(locale,'polish.week'),community?.weekly&&Object.values(community.weekly).some(item=>item.value!==null)?t(locale,'polish.weekIntro'):noEligibleWeek?t(locale,'polish.noMembers'):t(locale,'polish.noComparison')));
 if(community?.weekly&&!noEligibleWeek){
  const date=(value:string)=>new Intl.DateTimeFormat(locale==='en'?'en-US':'ja-JP',{timeZone:data.settings?.timezone??'UTC',month:'short',day:'numeric'}).format(new Date(value));
  children.push(metricGrid((['reply','connection','retention'] as const).map(key=>{
   const item=community.weekly[key];
   let trend='';
   if(item.value!==null&&item.previous!==null){const delta=item.value-item.previous;trend=delta===0?t(locale,'polish.same'):key==='reply'?t(locale,delta<0?'polish.faster':'polish.slower',{count:Math.abs(delta)}):t(locale,'polish.points',{count:`${delta>0?'+':''}${delta}`});}
   return {label:key==='retention'?activityWindow(locale==='en'?'en':'ja',item.activityFromDay,item.observationDays):t(locale,key==='reply'?'polish.replyTime':'polish.connection'),value:measurementLabel(item,locale,key==='reply'),note:[trend,key==='reply'?replyDenominator(locale==='en'?'en':'ja',item):item.value!==null?`${item.numerator} / ${item.sample} ${locale==='en'?'members':'人'}`:'',t(locale,'polish.period',{from:date(item.from),through:date(new Date(new Date(item.through).getTime()-1).toISOString()),days:item.observationDays})].filter(Boolean).join(' · ')};
  })));
 }
 if(community?.suggestion?.key==='reply_rescue')children.push(divider(),callout(t(locale,'polish.insight'),`${t(locale,'experience.suggestionWhy',{new:community.suggestion.basis.newcomerMinutes,regular:community.suggestion.basis.continuingMinutes})}\n${t(locale,'polish.sample',{count:(community.compare?.newcomers?.members??0)+(community.compare?.continuing?.members??0)})}`));
 children.push(divider(),callout(t(locale,'polish.monitoringTitle'),t(locale,'polish.monitoring')),footer(t(locale,'experience.reactionWeak')));
 return children;
}
