import {ComponentType, ButtonStyle} from "discord-api-types/v10";
import {actionRow, callout, footer, nexusPanel, type PanelChild} from "../primitives";
import {analysisCopy as c, metricNames, localized, qualityNames} from "../i18n/analysis";
import type {Issue} from "../types";
import type {UiLocale} from "../i18n";
import type {ControlData, AnalysisView} from "./control";
import {metricValue} from "./analysis";
const views = {
 overall:["全体の状況","Overall activity"], posts:["投稿と返信","Posts and replies"],
 announcements:["お知らせ・リアクション・投票","Announcements, reactions and polls"],
 voice:["ボイス","Voice"], events:["イベント","Events"],
} as const;
const keys:Record<keyof typeof views,string[]>={overall:["observed_posts","observed_replies","new_members"],posts:["observed_posts","observed_replies","first_reply_seconds","waiting_response"],announcements:["announcement_posts","observed_reactions","poll_participants"],voice:["voice_copresence"],events:["event_signups","event_attendance"]};
export async function basicAnalysisPanel(issue:Issue,data:ControlData,locale:UiLocale,view:AnalysisView="overall",detailPage=0){
 const selected=view in views ? view as keyof typeof views : "overall",basic=data.basicAnalysis;
 const children:PanelChild[]=[callout(c(locale,"basicTitle"),c(locale,"basic"))];
 if(data.community?.adaptive?.caveats.some(caveat=>caveat.startsWith("Conflicting administrator-mapped status tags")))children.push(callout(c(locale,"needs"),c(locale,"tagConflict")));
 if(basic){
  children.push(footer(c(locale,"periodWindow",{from:basic.from.toISOString().slice(0,10),through:new Date(basic.to.getTime()-1).toISOString().slice(0,10)})+" · "+c(locale,"placesCount",{count:basic.channelCount})));
  const profile=data.model?.profile??data.community?.adaptive?.profile,channels=data.model?.capabilities?.channels??data.community?.adaptive?.capabilities?.channels??[];
  const overallKeys=channels.filter(channel=>[2,13].includes(channel.type)).length>channels.filter(channel=>[0,5,15,16].includes(channel.type)).length ? ["voice_copresence","event_signups","event_attendance"] : profile?.confirmed&&profile.channels.some(channel=>channel.purpose==="SHOWCASE")&&!profile.channels.some(channel=>channel.purpose==="SUPPORT") ? ["showcase_posts","observed_reactions","observed_comments"] : profile?.confirmed&&profile.channels.some(channel=>channel.purpose==="SUPPORT") ? ["observed_posts","observed_replies","waiting_response"] : keys.overall;
  const metrics=basic.result.metrics.filter(m=>(selected==="overall"?overallKeys:keys[selected]).includes(m.key)&&m.quality!=="NOT_APPLICABLE");
  for(const metric of metrics.slice(detailPage*3,detailPage*3+3))children.push(callout(localized(locale,metricNames[metric.key]??[c(locale,"unknownMetric"),c(locale,"unknownMetric")]),`${metric.evidence.value!==null&&["COMPLETE","PARTIAL"].includes(metric.quality)?metricValue(locale,metric.key,metric.evidence.value):c(locale,"unknown")}\n${localized(locale,qualityNames[metric.quality])}`));
  if(!metrics.length)children.push(callout(c(locale,"unknown"),c(locale,"purposeLater")));
  if(metrics.some(m=>m.key==="first_reply_seconds"))children.push(footer(c(locale,"medianNote")));
  if(metrics.length>3)children.push(await actionRow(issue,[{label:c(locale,"back"),action:"controlAnalysis",data:{analysisView:selected,detailPage:Math.max(0,detailPage-1)},disabled:detailPage===0},{label:c(locale,"details"),action:"controlAnalysis",data:{analysisView:selected,detailPage:detailPage+1},disabled:(detailPage+1)*3>=metrics.length}]));
 }else children.push(callout(c(locale,"unknown"),c(locale,"reviewUnknown")));
 return nexusPanel({title:localized(locale,views[selected]),children,rows:[
  {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:"controlAnalysis"}),placeholder:c(locale,"basicAction"),options:[...Object.entries(views).map(([value,names])=>({label:localized(locale,names),value,default:value===selected})),{label:c(locale,"newMembers"),value:"newMembers"}]}]},
  await actionRow(issue,[{label:c(locale,"detailedAction"),action:"analysisMenu",style:ButtonStyle.Primary},{label:c(locale,"newMembers"),action:"controlNavigate",data:{page:"newMembers"}},{label:c(locale,"home"),action:"controlNavigate",data:{page:"overview"}}]),
 ]});
}
