import {ButtonStyle,ComponentType,type APIChannelSelectComponent,type APIRoleSelectComponent,type APIStringSelectComponent} from 'discord-api-types/v10';
import {actionRow,callout,divider,nexusPanel,type ActionRow,type Panel} from './primitives.js';
import type {Issue} from './types.js';

export * from './formatting.js';
export * from './primitives.js';
export * from './status.js';
export * from './theme.js';
export * from './types.js';
export * from './views/activation.js';
export * from './views/billing.js';
export * from './views/cohorts.js';
export * from './views/diagnostics.js';
export * from './views/errors.js';
export * from './views/experiments.js';
export * from './views/health.js';
export * from './views/interventions.js';
export * from './views/lifecycle.js';
export * from './views/onboarding.js';
export * from './views/overview.js';
export * from './views/privacy.js';
export * from './views/readiness.js';
export * from './views/reports.js';
export * from './views/root.js';
export * from './views/settings.js';
export * from './views/success.js';

/** Transitional builder for compact secondary flows. Major product views use typed builders. */
export function panel(title:string,description:string,rows:ActionRow[]=[]):Panel{return nexusPanel({title:`NEXUS · ${title}`,children:[divider(),callout('Details',description)],rows});}

export async function confirmation(issue:Issue,action:string){
 const {deletionConfirmationPanel}=await import('./views/privacy.js');return deletionConfirmationPanel(issue,action);
}

export async function questionPanel(issue:Issue,input:{sessionId:string;revision:number;nodeId:string;question:string;options:{id:string;label:string}[];context:string;type?:string}){
 const customId=await issue({action:'answer',sessionId:input.sessionId,revision:input.revision,nodeId:input.nodeId});let row:ActionRow;
 if(input.type==='role_select')row={type:ComponentType.ActionRow,components:[{type:ComponentType.RoleSelect,custom_id:customId,min_values:1,max_values:Math.min(25,input.options.length)} satisfies APIRoleSelectComponent]};
 else if(input.type==='channel_select')row={type:ComponentType.ActionRow,components:[{type:ComponentType.ChannelSelect,custom_id:customId,min_values:1,max_values:Math.min(25,input.options.length)} satisfies APIChannelSelectComponent]};
 else row={type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:customId,min_values:1,max_values:input.type==='multi_choice'?input.options.length:1,options:input.options.map(option=>({label:option.label,value:option.id}))} satisfies APIStringSelectComponent]};
 return nexusPanel({title:'NEXUS · Your Community Setup',subtitle:input.context==='PRODUCTION'?'Personalize your experience':`${input.context} · excluded from production metrics`,children:[divider(),callout('Question',input.question)],rows:[row,await actionRow(issue,[{label:'Privacy',action:'privacy',style:ButtonStyle.Secondary}])]});
}
