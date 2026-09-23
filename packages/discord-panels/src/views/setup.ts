import {ButtonStyle} from 'discord-api-types/v10';
import type {SetupState} from '../../../presentation/src/types.js';
import {discordLabel,t,type UiLocale} from '../i18n/index.js';
import {actionRow,divider,footer,nexusPanel,section,type ButtonSpec,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
export async function guidedSetupPanel(issue:Issue,setup:SetupState,locale:UiLocale='en'):Promise<Panel>{
 const status=(complete:boolean)=>complete?t(locale,'common.ready'):t(locale,'common.needsAttention'),labels={connect:'setup.connect',activation:'setup.activation',onboarding:'setup.onboarding',measuring:'setup.measuring'} as const,next=setup.steps.find(step=>!step.complete),actions:ButtonSpec[]=[];
 if(next?.key==='connect')actions.push({label:discordLabel(locale,'common.refresh'),action:'setup',style:ButtonStyle.Primary});
 if(next?.key==='activation')actions.push({label:discordLabel(locale,'setup.defineSuccess'),action:'activation',style:ButtonStyle.Primary});
 if(next?.key==='onboarding')actions.push(setup.recommendedMode?{label:discordLabel(locale,'setup.recommended'),action:'recommendedSetup',style:ButtonStyle.Primary}:{label:discordLabel(locale,'common.settings'),action:'advanced',style:ButtonStyle.Primary});
 if(next?.key==='measuring')actions.push({label:discordLabel(locale,'common.overview'),action:'overview',style:ButtonStyle.Primary});
 actions.push({label:discordLabel(locale,'common.settings'),action:'advanced'});
 return nexusPanel({title:t(locale,'setup.title'),subtitle:t(locale,'setup.subtitle'),accent:setup.required?'collecting':'healthy',children:[divider(),...setup.steps.map((step,index)=>section(`${index+1}. ${t(locale,labels[step.key])}`,`**${status(step.complete)}**\n-# ${t(locale,`setup.reason.${step.reason}`)}`)),divider(),footer(t(locale,'setup.footer'))],rows:[await actionRow(issue,actions)]});
}
