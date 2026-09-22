import {ButtonStyle,ComponentType,type APIButtonComponent} from 'discord-api-types/v10';
import {formatPercentage} from '../formatting.js';
import {coverageLabel} from '../status.js';
import {discordLabel,t,type UiLocale} from '../i18n/index.js';
import {callout,divider,footer,metricGrid,nexusPanel,type ActionRow,type Panel} from '../primitives.js';
import type {Issue,MetricLike} from '../types.js';

export type CommunityQuickStatus={activation?:MetricLike;connection?:MetricLike;retention?:MetricLike;attention?:string|null;dashboardUrl?:string};
export async function rootPanel(issue:Issue,locale:UiLocale='en',status:CommunityQuickStatus={}):Promise<Panel>{
 const metrics=[status.activation,status.connection,status.retention],coverage=metrics.find(m=>m&&m.dataCoverage.status!=='healthy')?.dataCoverage.status??(metrics.some(Boolean)?'healthy':'unavailable');
 const value=(m?:MetricLike)=>m?formatPercentage(m.value,0,locale):t(locale,'common.notAvailable');
 const health=coverage==='healthy'?t(locale,'root.healthHealthy'):coverage==='unavailable'?t(locale,'common.notAvailableYet'):t(locale,'root.healthPartial');
 const buttons:APIButtonComponent[]=[];
 try{if(status.dashboardUrl&&/^https?:\/\//.test(new URL(status.dashboardUrl).href))buttons.push({type:ComponentType.Button,style:ButtonStyle.Link,label:discordLabel(locale,'root.openDashboard'),url:status.dashboardUrl});}catch{/* Invalid URLs fall back to an interaction button. */}
 if(!buttons.length)buttons.push({type:ComponentType.Button,style:ButtonStyle.Primary,label:discordLabel(locale,'root.openDashboard'),custom_id:await issue({action:'dashboard'},true)});
 buttons.push({type:ComponentType.Button,style:ButtonStyle.Secondary,label:discordLabel(locale,'root.viewOpportunity'),custom_id:await issue({action:'diagnose'},true)},{type:ComponentType.Button,style:ButtonStyle.Secondary,label:discordLabel(locale,'root.actions'),custom_id:await issue({action:'interventions'},true)},{type:ComponentType.Button,style:ButtonStyle.Secondary,label:discordLabel(locale,'common.settings'),custom_id:await issue({action:'advanced'},true)});
 const row:ActionRow={type:ComponentType.ActionRow,components:buttons};
 const observed=metrics.find(Boolean),ratio=observed?.dataCoverage.expected&&observed.dataCoverage.observed!==null?observed.dataCoverage.observed/observed.dataCoverage.expected:undefined;
 return nexusPanel({title:t(locale,'root.title'),subtitle:t(locale,'root.subtitle'),accent:coverage==='healthy'?'healthy':coverage==='unavailable'?'neutral':'warning',children:[divider(),metricGrid([{label:t(locale,'root.communityHealth'),value:health,note:observed?coverageLabel(observed.dataCoverage.status,ratio,locale):undefined},{label:t(locale,'common.activation'),value:value(status.activation)},{label:t(locale,'root.firstConnection'),value:value(status.connection)},{label:t(locale,'common.d7Retention'),value:value(status.retention)}]),divider(),callout(t(locale,'root.attention'),status.attention??t(locale,'root.noAttention')),footer(t(locale,'root.footer'))],rows:[row]});
}
