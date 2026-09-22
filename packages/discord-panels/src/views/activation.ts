import {ButtonStyle,ComponentType,type APIStringSelectComponent} from 'discord-api-types/v10';
import {actionRow,callout,divider,nexusPanel,type ActionRow,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';

export async function activationPanel(issue:Issue):Promise<Panel>{
 const select:ActionRow={type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'activationDraft'}),placeholder:'Choose a first-value signal',options:[{label:'Receive a direct reply',value:'reply.received',description:'A community member replies directly'},{label:'Subscribe to a scheduled event',value:'scheduled_event.subscribed',description:'A newcomer joins an upcoming event'},{label:'Send a message',value:'message.sent',description:'A newcomer contributes in the community'}]} satisfies APIStringSelectComponent]};
 return nexusPanel({title:'NEXUS · Activation',subtitle:'Define an observable first-value signal',children:[divider(),callout('Activation window','The selected signal must occur within 7 days after joining.'),callout('Versioning','The published definition applies to future newcomers. Existing cohorts keep the definition they joined under.')],rows:[select,await actionRow(issue,[{label:'Lifecycle',action:'lifecycle',style:ButtonStyle.Secondary},{label:'Settings',action:'settings'}])]});
}

export async function activationPreviewPanel(issue:Issue,view:{signal:string;publishData:Record<string,unknown>}):Promise<Panel>{
 const labels:Record<string,string>={'reply.received':'Receive a direct reply','scheduled_event.subscribed':'Subscribe to a scheduled event','message.sent':'Send a message'};
 return nexusPanel({title:'Preview Activation',subtitle:'Review before publishing',children:[divider(),callout('First-value signal',labels[view.signal]??view.signal),callout('Observation window','Within 7 days after joining.'),callout('Cohort safety','Publishing creates an immutable version. Historical cohorts remain pinned to their original definition.')],rows:[await actionRow(issue,[{label:'Publish Activation',action:'configPublish',data:view.publishData,style:ButtonStyle.Primary},{label:'Back',action:'activation'}])]});
}
