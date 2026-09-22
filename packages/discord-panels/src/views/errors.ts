import {ButtonStyle} from 'discord-api-types/v10';
import {actionRow,callout,divider,footer,nexusPanel,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
export type ErrorKind='revision'|'permission'|'entitlement'|'generic';
export async function errorPanel(issue:Issue,kind:ErrorKind='generic'):Promise<Panel>{
 const messages:Record<ErrorKind,{title:string;detail:string}>={revision:{title:'Settings changed while you were editing',detail:'Reload the latest panel before trying again.'},permission:{title:'Permission required',detail:'Your Discord permissions or managed role access no longer allow this action.'},entitlement:{title:'Feature not available on this plan',detail:'The current NEXUS plan does not include this feature.'},generic:{title:"Action couldn't be completed",detail:"NEXUS couldn't finish this request."}};
 const message=messages[kind];
 return nexusPanel({title:message.title,subtitle:message.detail,accent:'critical',children:[divider(),callout('Possible causes','• Discord permission changed\n• A role or channel is inaccessible\n• A temporary storage issue occurred'),callout('Configuration safety','No configuration change was committed.'),footer('Sensitive service details are never included in Discord responses.')],rows:[await actionRow(issue,[{label:'Retry',action:'panel',style:ButtonStyle.Primary},{label:'Run Diagnostics',action:'status'},{label:'Back',action:'settings'}])]});
}
