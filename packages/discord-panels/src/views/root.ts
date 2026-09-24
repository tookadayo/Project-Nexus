import {ButtonStyle,ComponentType,type APIButtonComponent} from 'discord-api-types/v10';
import {formatPercentage} from '../formatting.js';
import {coverageLabel} from '../status.js';
import {divider,footer,metricGrid,nexusPanel,callout,type ActionRow,type InteractiveButtonStyle,type Panel} from '../primitives.js';
import type {Issue,MetricLike} from '../types.js';
import type {UiLocale} from '../i18n/index.js';

export type CommunityPanelState='SETUP_REQUIRED'|'COLLECTING_DATA'|'HEALTHY'|'NEEDS_ATTENTION'|'EXPERIMENT_RUNNING';
export type CommunityQuickStatus={state?:CommunityPanelState;activation?:MetricLike;connection?:MetricLike;retention?:MetricLike;newMembers?:number|null;attention?:string|null;suggestedAction?:string|null;setupRemaining?:number;updatedAt?:Date;dashboardUrl?:string};
export async function rootPanel(issue:Issue,locale:UiLocale='en',status:CommunityQuickStatus={}):Promise<Panel>{
 const ja=locale!=='en',state=status.state??'SETUP_REQUIRED',metrics=[status.activation,status.connection,status.retention],coverage=metrics.find(m=>m&&m.dataCoverage.status!=='healthy')?.dataCoverage.status??(metrics.some(Boolean)?'healthy':'unavailable');
 const label=(en:string,jp:string)=>ja?jp:en;
 const value=(metric?:MetricLike)=>metric?formatPercentage(metric.value,0,locale):'—';
 const health=coverage==='healthy'?label('Healthy','正常'):coverage==='unavailable'?label('Not enough verified data yet','まだ利用できるデータがありません'):label('Some data could not be collected','一部取得できていません');
 const children=[divider(),callout(label('Community status','コミュニティの状態'),state==='SETUP_REQUIRED'?label('Choose what a successful newcomer should do first. Other activity can already be collected.','新規メンバーの最初の成功を選んでください。他の活動はすでに収集できます。'):state==='COLLECTING_DATA'?label('Collecting newcomer activity. Results will appear when enough data is ready.','新規メンバーの活動を集計中です。データがそろうと結果を表示します。'):state==='NEEDS_ATTENTION'?label('An improvement may help newcomers.','新規メンバーを支援する改善策があります。'):state==='EXPERIMENT_RUNNING'?label('Checking whether an improvement helped.','改善策の効果を確認中です。'):label('Data is being collected normally.','データを正常に収集しています.'))];
 if(metrics.some(Boolean)||status.newMembers!==undefined){
  const observed=metrics.find(Boolean),ratio=observed?.dataCoverage.expected&&observed.dataCoverage.observed!==null?observed.dataCoverage.observed/observed.dataCoverage.expected:undefined;
  children.push(metricGrid([{label:label('Data collection status','データ取得状況'),value:health,note:observed?coverageLabel(observed.dataCoverage.status,ratio,locale):undefined},{label:label('New members','新規メンバー'),value:status.newMembers===null||status.newMembers===undefined?'—':String(status.newMembers)},{label:label('Successful newcomers','成功した新規メンバー'),value:value(status.activation)},{label:label('Received a reply','返信を受けた'),value:value(status.connection)},{label:label('Active after 7 days','7日後も活動'),value:value(status.retention)}]));
 }
 if(state==='NEEDS_ATTENTION')children.push(divider(),callout(label('Needs attention','今見るべきこと'),status.attention??label('A newcomer signal needs review.','新規メンバーの状況を確認してください。')));
 const button=async(name:string,action:string,style:InteractiveButtonStyle=ButtonStyle.Secondary):Promise<APIButtonComponent>=>({type:ComponentType.Button,style,label:name.slice(0,80),custom_id:await issue({action},true)});
 let dashboard:APIButtonComponent|null=null;try{if(status.dashboardUrl&&/^https?:\/\//.test(new URL(status.dashboardUrl).href))dashboard={type:ComponentType.Button,style:ButtonStyle.Link,label:label('Dashboard','ダッシュボード'),url:status.dashboardUrl};}catch{/* no dashboard */}
 const navigation:APIButtonComponent[]=[];if(dashboard)navigation.push(dashboard);
 navigation.push(await button(label('Newcomers','新規メンバー'),'lifecycle'),await button(label('Improve','改善'),'improve',state==='NEEDS_ATTENTION'?ButtonStyle.Primary:ButtonStyle.Secondary),await button(label('Results','結果'),'experiments'));
 const management:APIButtonComponent[]=[await button(label('Refresh','更新'),'panelRefresh'),await button(label('Settings','設定'),'settings')];
 if(state==='SETUP_REQUIRED')management.unshift(await button(label('Start setup','セットアップを開始'),'setup',ButtonStyle.Primary));
 const updated=Math.floor((status.updatedAt??new Date()).getTime()/1000);children.push(footer(label(`Updated <t:${updated}:R>`,`更新 <t:${updated}:R>`)));
 return nexusPanel({title:'NEXUS',subtitle:label('Understand newcomers and choose improvements','新規メンバーの状況を見て改善策を選ぶ'),accent:state==='HEALTHY'?'healthy':state==='NEEDS_ATTENTION'?'warning':state==='SETUP_REQUIRED'?'collecting':'nexus',children,rows:[{type:ComponentType.ActionRow,components:navigation.slice(0,5)} as ActionRow,{type:ComponentType.ActionRow,components:management} as ActionRow]});
}
