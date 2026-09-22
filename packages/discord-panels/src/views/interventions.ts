import {ButtonStyle,ComponentType,type APIChannelSelectComponent,type APIStringSelectComponent} from 'discord-api-types/v10';
import {shortId} from '../formatting.js';
import {actionRow,callout,divider,emptyState,footer,nexusPanel,section,type ActionRow,type Panel} from '../primitives.js';
import {interventionStateLabels} from '../status.js';
import type {Issue} from '../types.js';

export type InterventionRunView={id:string;state:string};
export async function interventionsPanel(issue:Issue,runs:InterventionRunView[]):Promise<Panel>{
 const pending=runs.filter(r=>r.state==='suggested'||r.state==='approval');
 const rows:ActionRow[]=[];
 if(pending.length)rows.push({type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'interventionApprove'}),placeholder:'Approve a proposed intervention',options:pending.slice(0,25).map(r=>({label:`${interventionStateLabels[r.state]??r.state} · ${shortId(r.id)}`,value:r.id,description:'Helper alert after 24 hours'}))} satisfies APIStringSelectComponent]});
 rows.push({type:ComponentType.ActionRow,components:[{type:ComponentType.ChannelSelect,custom_id:await issue({action:'interventionDraft'}),placeholder:'Choose the staff alert channel',channel_types:[0],min_values:1,max_values:1} satisfies APIChannelSelectComponent]});
 const recent=runs.length?section('Recent activity',runs.slice(0,10).map(r=>`**Helper Alert after 24h**\n${interventionStateLabels[r.state]??r.state}\n-# Reference ${shortId(r.id)}`).join('\n\n')):emptyState('No intervention activity','Create a staff alert rule to support newcomers who have not activated.');
 return nexusPanel({title:'NEXUS · Intervention Studio',subtitle:'Turn diagnoses into controlled community actions',accent:pending.length?'warning':'nexus',children:[divider(),recent,divider(),callout('New intervention','**Mode**\nSuggest\n\n**Trigger**\n24 hours after join\n\n**Action**\nAlert staff\n\n**Safety**\n1 DM/day · 3 automated contacts/week'),footer('Suggest mode sends nothing until a staff member approves it.')],rows:[...rows,await actionRow(issue,[{label:'Experiments',action:'experiments',style:ButtonStyle.Primary},{label:'Diagnose',action:'diagnose'}])]});
}

export async function interventionPreviewPanel(issue:Issue,publishData:Record<string,unknown>):Promise<Panel>{return nexusPanel({title:'Preview Intervention',subtitle:'Helper Alert after 24h',children:[divider(),callout('Mode','Suggest'),callout('Trigger','24 hours after join'),callout('Action','Alert staff in the selected channel'),callout('Safety','Nothing is sent until approved. Eligibility and hard frequency limits are checked again before delivery.')],rows:[await actionRow(issue,[{label:'Publish Intervention',action:'configPublish',data:publishData,style:ButtonStyle.Primary},{label:'Back',action:'interventions'}])]});}
