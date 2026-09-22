import {ComponentType,ButtonStyle,MessageFlags,type APIMessageTopLevelComponent,type RESTPostAPIChannelMessageJSONBody} from 'discord-api-types/v10';
export type Issue=(intent:Record<string,unknown>,publicEntry?:boolean)=>Promise<string>;
export type Panel=RESTPostAPIChannelMessageJSONBody;
const text=(content:string)=>({type:ComponentType.TextDisplay as const,content});
export function panel(title:string,description:string,rows:APIMessageTopLevelComponent[]=[]):Panel {
 return {flags:MessageFlags.IsComponentsV2,allowed_mentions:{parse:[]},components:[{type:ComponentType.Container,components:[text(`## ${title}`),text(description)]},...rows]};
}
async function buttons(issue:Issue,entries:[string,string][],publicEntry=false){
 return {type:ComponentType.ActionRow as const,components:await Promise.all(entries.map(async([label,action])=>({type:ComponentType.Button as const,style:ButtonStyle.Secondary as const,label,custom_id:await issue({action},publicEntry)})))};
}
export async function rootPanel(issue:Issue):Promise<Panel>{
 return panel('NEXUS Control Center','Observe → Measure → Diagnose → Intervene → Experiment. Administration opens privately.',[
  await buttons(issue,[['Overview','overview'],['Native Setup','setup'],['Lifecycle','lifecycle'],['Activation','activation']],true),
  await buttons(issue,[['Cohorts','cohorts'],['Diagnoses','diagnose'],['Interventions','interventions'],['Experiments','experiments']],true),
  await buttons(issue,[['Reports','reports'],['Privacy','privacy'],['Billing','billing'],['Advanced','advanced']],true)
 ]);
}
export async function settingsPanel(issue:Issue,settings:{enabled:boolean,onboardingEnabled:boolean,template:string,startChannelId:string|null,revision:number}){
 const revision=settings.revision;
 return panel('Community Settings',`Revision ${revision} · NEXUS ${settings.enabled?'enabled':'disabled'} · Onboarding ${settings.onboardingEnabled?'enabled':'disabled'}\nTemplate: ${settings.template}\nStart channel: ${settings.startChannelId?`<#${settings.startChannelId}>`:'Not configured'}\nAutomation: SUGGEST`,[
  {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'template',revision}),placeholder:'Choose community template',options:['Gaming','Creator','Developer / OSS','Product / SaaS','Education','General Community'].map(label=>({label,value:label}))}]},
  {type:ComponentType.ActionRow,components:[{type:ComponentType.ChannelSelect,custom_id:await issue({action:'startChannel',revision}),channel_types:[0],placeholder:'Choose a start channel',min_values:1,max_values:1}]},
  {type:ComponentType.ActionRow,components:[{type:ComponentType.Button,style:ButtonStyle.Primary,label:settings.enabled?'Disable NEXUS':'Enable NEXUS',custom_id:await issue({action:'enabled',revision,value:!settings.enabled})},
   {type:ComponentType.Button,style:ButtonStyle.Secondary,label:settings.onboardingEnabled?'Disable onboarding':'Enable onboarding',custom_id:await issue({action:'onboardingEnabled',revision,value:!settings.onboardingEnabled})}]},
  await buttons(issue,[['Role mappings','flows'],['Preview','preview'],['Privacy / Delete','privacy']])
 ]);
}
export async function privacyPanel(issue:Issue,admin=false){
 return panel('NEXUS Privacy','We do not store message contents, attachments or DMs. We process observable lifecycle metadata. Detailed retention defaults to 30 days (7 / 14 / 30 configurable); queued metadata: at most 24 hours. Production analytics exclude tests and previews.',[
  await buttons(issue,admin?[['Request my data deletion','deleteMemberConfirm'],['Delete guild data','deleteGuildConfirm']]:[['Request my data deletion','deleteMemberConfirm']])
 ]);
}
export async function confirmation(issue:Issue,action:string){
 return panel('Confirm deletion','This deletes the selected NEXUS data. Existing Discord roles are left in place.',[
  await buttons(issue,[['Confirm deletion',action],['Cancel','privacy']])
 ]);
}
export async function questionPanel(issue:Issue,input:{sessionId:string,revision:number,nodeId:string,question:string,options:{id:string,label:string}[],context:string,type?:string}){
 const customId=await issue({action:'answer',sessionId:input.sessionId,revision:input.revision,nodeId:input.nodeId});
 if(input.type==='role_select'||input.type==='channel_select')return panel('Your Community Setup',input.question,[{type:ComponentType.ActionRow,components:[{type:input.type==='role_select'?ComponentType.RoleSelect:ComponentType.ChannelSelect,custom_id:customId,min_values:1,max_values:Math.min(25,input.options.length)}]}]);
 return panel('Your Community Setup',`${input.context==='PRODUCTION'?'':`**${input.context} — excluded from production metrics**\n`}${input.question}`,[
  {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:customId,min_values:1,max_values:input.type==='multi_choice'?input.options.length:1,
   options:input.options.map(o=>({label:o.label,value:o.id}))}]}
 ]);
}

