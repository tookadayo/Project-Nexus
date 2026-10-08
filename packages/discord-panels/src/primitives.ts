import {ButtonStyle,ComponentType,MessageFlags,SeparatorSpacingSize,type APIActionRowComponent,type APIButtonComponent,type APIComponentInMessageActionRow,type APIComponentInContainer,type APIMessageTopLevelComponent,type APISectionAccessoryComponent,type APISectionComponent,type RESTPostAPIChannelMessageJSONBody} from 'discord-api-types/v10';
import {colors,type Accent} from './theme.js';
import type {Issue} from './types.js';

export type Panel=RESTPostAPIChannelMessageJSONBody;
export type PanelChild=APIComponentInContainer;
export type ActionRow=APIActionRowComponent<APIComponentInMessageActionRow>;
export type InteractiveButtonStyle=ButtonStyle.Primary|ButtonStyle.Secondary|ButtonStyle.Success|ButtonStyle.Danger;
export type ButtonSpec={label:string;action:string;emoji?:string;style?:InteractiveButtonStyle;data?:Record<string,unknown>;publicEntry?:boolean;disabled?:boolean};

export const text=(content:string):PanelChild=>({type:ComponentType.TextDisplay,content});
export const componentCount=(value:unknown):number=>{
 if(!value||typeof value!=='object')return 0;
 const c=value as {type?:number;components?:unknown[];component?:unknown;accessory?:unknown};
 return (typeof c.type==='number'?1:0)+(c.components??[]).reduce<number>((n,child)=>n+componentCount(child),0)+componentCount(c.component)+componentCount(c.accessory);
};
export const sectionWithAccessory=(title:string,body:string,accessory:APISectionAccessoryComponent):APISectionComponent=>({type:ComponentType.Section,components:[{type:ComponentType.TextDisplay,content:`### ${title}\n${body}`}],accessory});
export const thumbnail=(url:string,description:string)=>({type:ComponentType.Thumbnail as const,media:{url},description});
export async function actionButton(issue:Issue,spec:ButtonSpec):Promise<APIButtonComponent>{
 const customId=await issue({action:spec.action,...spec.data},spec.publicEntry);
 if(customId.length>100||!customId.length||spec.label.length>80||!spec.label.length)throw new Error('DISCORD_BUTTON_LIMIT');
 return {type:ComponentType.Button,style:spec.style??ButtonStyle.Secondary,label:spec.label,emoji:spec.emoji?{name:spec.emoji}:undefined,custom_id:customId,disabled:spec.disabled};
}
export const divider=(large=false):PanelChild=>({type:ComponentType.Separator,divider:true,spacing:large?SeparatorSpacingSize.Large:SeparatorSpacingSize.Small});
export const panelHeader=(title:string,subtitle?:string):PanelChild[]=>[text(`## ${title}${subtitle?`\n-# ${subtitle}`:''}`)];
export const section=(title:string,body:string):PanelChild=>text(`### ${title}\n${body}`);
export const callout=(title:string,body:string):PanelChild=>text(`**${title}**\n${body}`);
export const emptyState=(title:string,body:string):PanelChild=>text(`### ${title}\n${body}`);
export const footer=(content:string):PanelChild=>text(`-# ${content}`);
export const metric=(label:string,value:string,note?:string)=>`**${label}**\n${value}${note?`\n-# ${note}`:''}`;
export const metricGrid=(items:Array<{label:string;value:string;note?:string}>):PanelChild=>text(items.map(item=>metric(item.label,item.value,item.note)).join('\n\n'));
export const statusBanner=(label:string,detail:string):PanelChild=>text(`### ${label}\n${detail}`);
export const recommendedAction=(title:string,detail:string,heading='Recommended next action'):PanelChild=>text(`### ${heading}\n**${title}**\n${detail}`);

export async function actionRow(issue:Issue,specs:ButtonSpec[]):Promise<ActionRow>{
 if(specs.length>5||specs.filter(s=>s.style===ButtonStyle.Primary).length>1)throw new Error('DISCORD_ACTION_GROUP_LIMIT');
 const buttons=await Promise.all(specs.map(spec=>actionButton(issue,spec)));
 return {type:ComponentType.ActionRow,components:buttons};
}

export function nexusPanel(options:{title:string;subtitle?:string;accent?:Accent;children?:PanelChild[];rows?:ActionRow[];topLevel?:APIMessageTopLevelComponent[]}):Panel{
 const children=[...panelHeader(options.title,options.subtitle),...(options.children??[]),...(options.rows??[])];
 const count=1+children.reduce((n,c)=>n+componentCount(c),0)+(options.topLevel??[]).reduce((n,c)=>n+componentCount(c),0);
 if(count>40)throw new Error('DISCORD_COMPONENT_LIMIT');
 return {flags:MessageFlags.IsComponentsV2,allowed_mentions:{parse:[]},components:[{type:ComponentType.Container,accent_color:colors[options.accent??'nexus'],components:children},...(options.topLevel??[])]};
}
