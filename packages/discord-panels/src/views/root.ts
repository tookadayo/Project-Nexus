import {ButtonStyle,ComponentType,type APIButtonComponent} from 'discord-api-types/v10';
import {formatPercentage} from '../formatting.js';
import {coverageLabel} from '../status.js';
import {discordLabel,t,type UiLocale} from '../i18n/index.js';
import {callout,divider,footer,metricGrid,nexusPanel,type ActionRow,type InteractiveButtonStyle,type Panel} from '../primitives.js';
import type {Issue,MetricLike} from '../types.js';

export type CommunityPanelState='SETUP_REQUIRED'|'COLLECTING_DATA'|'HEALTHY'|'NEEDS_ATTENTION'|'EXPERIMENT_RUNNING';
export type CommunityQuickStatus={state?:CommunityPanelState;activation?:MetricLike;connection?:MetricLike;retention?:MetricLike;attention?:string|null;suggestedAction?:string|null;setupRemaining?:number;updatedAt?:Date;dashboardUrl?:string};
export async function rootPanel(issue:Issue,locale:UiLocale='en',status:CommunityQuickStatus={}):Promise<Panel>{
 const state=status.state??'SETUP_REQUIRED',metrics=[status.activation,status.connection,status.retention],coverage=metrics.find(m=>m&&m.dataCoverage.status!=='healthy')?.dataCoverage.status??(metrics.some(Boolean)?'healthy':'unavailable'),value=(m?:MetricLike)=>m?formatPercentage(m.value,0,locale):t(locale,'common.notAvailable'),health=coverage==='healthy'?t(locale,'root.healthHealthy'):coverage==='unavailable'?t(locale,'common.notAvailableYet'):t(locale,'root.healthPartial'),children=[];
 const stateKey:Record<CommunityPanelState,Parameters<typeof t>[1]>={SETUP_REQUIRED:'root.stateSetup',COLLECTING_DATA:'root.stateCollecting',HEALTHY:'root.stateHealthy',NEEDS_ATTENTION:'root.stateAttention',EXPERIMENT_RUNNING:'root.stateExperiment'};
 const detailKey:Record<CommunityPanelState,Parameters<typeof t>[1]>={SETUP_REQUIRED:'root.setupDetail',COLLECTING_DATA:'root.collectingDetail',HEALTHY:'root.healthyDetail',NEEDS_ATTENTION:'root.attentionDetail',EXPERIMENT_RUNNING:'root.experimentDetail'};
 children.push(divider(),callout(t(locale,stateKey[state]),t(locale,detailKey[state],{count:status.setupRemaining??0})));
 if(state!=='SETUP_REQUIRED'){
  const observed=metrics.find(Boolean),ratio=observed?.dataCoverage.expected&&observed.dataCoverage.observed!==null?observed.dataCoverage.observed/observed.dataCoverage.expected:undefined;
  children.push(metricGrid([{label:t(locale,'root.communityHealth'),value:health,note:observed?coverageLabel(observed.dataCoverage.status,ratio,locale):undefined},{label:t(locale,'common.activation'),value:value(status.activation)},{label:t(locale,'root.firstConnection'),value:value(status.connection)},{label:t(locale,'common.d7Retention'),value:value(status.retention)}]));
 }
 if(state==='NEEDS_ATTENTION')children.push(divider(),callout(t(locale,'root.attention'),status.attention??t(locale,'root.noAttention')),callout(t(locale,'root.recommended'),status.suggestedAction??t(locale,'root.noAttention')));
 children.push(divider(),callout(t(locale,'root.destinations'),t(locale,'root.destinationDetail')));
 let dashboard:APIButtonComponent|null=null;try{if(status.dashboardUrl&&/^https?:\/\//.test(new URL(status.dashboardUrl).href))dashboard={type:ComponentType.Button,style:ButtonStyle.Link,label:discordLabel(locale,'root.openDashboard'),url:status.dashboardUrl};}catch{/* The unavailable state below is explicit. */}
 if(!dashboard)children.push(callout(t(locale,'root.dashboardUnavailable'),t(locale,'root.dashboardUnavailableDetail')));
 const custom=async(label:Parameters<typeof t>[1],action:string,style:InteractiveButtonStyle=ButtonStyle.Secondary):Promise<APIButtonComponent>=>({type:ComponentType.Button,style,label:discordLabel(locale,label),custom_id:await issue({action},true)});
 const primary:APIButtonComponent[]=[];
 if(state==='SETUP_REQUIRED')primary.push(await custom('root.continueSetup','setup',ButtonStyle.Primary));
 if(state==='COLLECTING_DATA'||state==='HEALTHY')primary.push(await custom('root.viewJourney','lifecycle',ButtonStyle.Primary));
 if(state==='NEEDS_ATTENTION')primary.push(await custom('root.viewOpportunity','diagnose',ButtonStyle.Primary),await custom('root.actions','interventions'));
 if(state==='EXPERIMENT_RUNNING')primary.push(await custom('root.viewResults','experiments',ButtonStyle.Primary));
 if(dashboard)primary.unshift(dashboard);primary.push(await custom('common.refresh','panelRefresh'));
 const rows:ActionRow[]=[{type:ComponentType.ActionRow,components:primary.slice(0,5)},{type:ComponentType.ActionRow,components:[await custom('common.settings','advanced'),await custom('common.privacy','privacy')]}];
 const updated=Math.floor((status.updatedAt??new Date()).getTime()/1000);children.push(footer(t(locale,'root.updated',{time:`<t:${updated}:R>`})),footer(t(locale,'root.footer')));
 return nexusPanel({title:'NEXUS',subtitle:t(locale,'root.subtitle'),accent:state==='HEALTHY'?'healthy':state==='NEEDS_ATTENTION'?'warning':state==='SETUP_REQUIRED'?'critical':state==='EXPERIMENT_RUNNING'?'nexus':'collecting',children,rows});
}
