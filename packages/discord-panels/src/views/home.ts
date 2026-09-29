import type {Measurement} from '../../../presentation/src/measurement.js';
import {t,type UiLocale} from '../i18n/index.js';
import {callout,divider,footer,metricGrid,type PanelChild} from '../primitives.js';
import type {ControlData} from './control.js';

export function measurementLabel(metric:Measurement|undefined,locale:UiLocale,minutes=false){
 if(!metric)return t(locale,'experience.pending');
 if(metric.value!==null)return minutes?t(locale,'control.minutes',{count:metric.value}):`${metric.value}%`;
 if(metric.state==='UNAVAILABLE')return t(locale,'polish.unavailable');
 if(metric.state==='NO_ELIGIBLE_MEMBERS')return t(locale,'polish.noMembers');
 if(minutes&&metric.state==='INSUFFICIENT_SAMPLE'&&metric.sample===0)return t(locale,'polish.noReplies');
 if(metric.state==='INSUFFICIENT_SAMPLE')return t(locale,'polish.moreSample',{count:metric.needed});
 return t(locale,'experience.pending');
}
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
 children.push(divider(),callout(t(locale,'polish.week'),community?.weekly&&Object.values(community.weekly).some(item=>item.value!==null)?t(locale,'polish.weekIntro'):[t(locale,'polish.noComparison'),noEligibleWeek?t(locale,'polish.moreSample',{count:Math.max(...Object.values(community!.weekly).map(item=>item.needed))}):''].filter(Boolean).join('\n')));
 if(community?.weekly&&!noEligibleWeek){
  const date=(value:string)=>new Intl.DateTimeFormat(locale==='en'?'en-US':'ja-JP',{timeZone:data.settings?.timezone??'UTC',month:'short',day:'numeric'}).format(new Date(value));
  children.push(metricGrid((['reply','connection','retention'] as const).map(key=>{
   const item=community.weekly[key];
   let trend='';
   if(item.value!==null&&item.previous!==null){const delta=item.value-item.previous;trend=delta===0?t(locale,'polish.same'):key==='reply'?t(locale,delta<0?'polish.faster':'polish.slower',{count:Math.abs(delta)}):t(locale,'polish.points',{count:`${delta>0?'+':''}${delta}`});}
   return {label:t(locale,key==='reply'?'polish.replyTime':key==='connection'?'polish.connection':'polish.retention'),value:measurementLabel(item,locale,key==='reply'),note:[trend,item.value!==null?t(locale,'polish.sample',{count:item.sample}):'',t(locale,'polish.period',{from:date(item.from),through:date(new Date(new Date(item.through).getTime()-1).toISOString()),days:item.observationDays})].filter(Boolean).join(' · ')};
  })));
 }
 if(community?.suggestion?.key==='reply_rescue')children.push(divider(),callout(t(locale,'polish.insight'),`${t(locale,'experience.suggestionWhy',{new:community.suggestion.basis.newcomerMinutes,regular:community.suggestion.basis.continuingMinutes})}\n${t(locale,'polish.sample',{count:(community.compare?.newcomers?.members??0)+(community.compare?.continuing?.members??0)})}`));
 children.push(divider(),callout(t(locale,'polish.monitoringTitle'),t(locale,'polish.monitoring')),footer(t(locale,'experience.reactionWeak')));
 return children;
}
