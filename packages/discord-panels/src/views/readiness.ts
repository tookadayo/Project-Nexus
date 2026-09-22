import {ButtonStyle,ComponentType,type APIStringSelectComponent} from 'discord-api-types/v10';
import {actionRow,callout,divider,footer,metricGrid,nexusPanel,type ActionRow,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';

export type ReadinessView={communityEnabled:boolean;nativeOnboardingAvailable:boolean;nativeOnboardingEnabled:boolean;membershipScreeningEnabled:boolean;recommendedMode:'native'|'fallback';configuredMode:'auto'|'native'|'fallback'|'hybrid'};
const yesNo=(value:boolean,yes='Enabled',no='Not enabled')=>value?yes:no;
export async function readinessPanel(issue:Issue,view:ReadinessView):Promise<Panel>{
 const select:ActionRow={type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'modePreview'}),placeholder:'Choose NEXUS mode',options:['auto','native','fallback','hybrid'].map(value=>({label:value==='auto'?'Auto':value[0]!.toUpperCase()+value.slice(1),value}))} satisfies APIStringSelectComponent]};
 return nexusPanel({title:'NEXUS · Native Readiness',subtitle:'Discord capability and onboarding mode',accent:view.communityEnabled?'nexus':'warning',children:[divider(),
  metricGrid([{label:'Community',value:yesNo(view.communityEnabled)},{label:'Native Onboarding',value:view.nativeOnboardingAvailable?yesNo(view.nativeOnboardingEnabled):'Not available'},{label:'Rules Screening',value:yesNo(view.membershipScreeningEnabled)}]),divider(),
  metricGrid([{label:'Configured',value:view.configuredMode[0]!.toUpperCase()+view.configuredMode.slice(1)},{label:'Selected automatically',value:view.recommendedMode[0]!.toUpperCase()+view.recommendedMode.slice(1)}]),
  callout('Discord configuration remains yours',"NEXUS will not modify Discord's Native Onboarding configuration."),footer('Server Guide signals are measured separately when Discord exposes them.')
 ],rows:[select,await actionRow(issue,[{label:'Preview rollout',action:'rolloutPreview',style:ButtonStyle.Primary},{label:'Settings',action:'settings'}])]});
}
