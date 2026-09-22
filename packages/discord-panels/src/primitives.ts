import {ButtonStyle,ComponentType,MessageFlags,SeparatorSpacingSize,type APIActionRowComponent,type APIButtonComponent,type APIComponentInMessageActionRow,type APIComponentInContainer,type APIMessageTopLevelComponent,type RESTPostAPIChannelMessageJSONBody} from 'discord-api-types/v10';
import {colors,type Accent} from './theme.js';
import type {Issue} from './types.js';

export type Panel=RESTPostAPIChannelMessageJSONBody;
export type PanelChild=APIComponentInContainer;
export type ActionRow=APIActionRowComponent<APIComponentInMessageActionRow>;
export type InteractiveButtonStyle=ButtonStyle.Primary|ButtonStyle.Secondary|ButtonStyle.Success|ButtonStyle.Danger;
export type ButtonSpec={label:string;action:string;style?:InteractiveButtonStyle;data?:Record<string,unknown>;publicEntry?:boolean;disabled?:boolean};

export const text=(content:string):PanelChild=>({type:ComponentType.TextDisplay,content});
export const divider=(large=false):PanelChild=>({type:ComponentType.Separator,divider:true,spacing:large?SeparatorSpacingSize.Large:SeparatorSpacingSize.Small});
export const panelHeader=(title:string,subtitle?:string):PanelChild[]=>[text(`## ${title}${subtitle?`\n-# ${subtitle}`:''}`)];
export const section=(title:string,body:string):PanelChild=>text(`### ${title}\n${body}`);
export const callout=(title:string,body:string):PanelChild=>text(`**${title}**\n${body}`);
export const emptyState=(title:string,body:string):PanelChild=>text(`### ${title}\n${body}`);
export const footer=(content:string):PanelChild=>text(`-# ${content}`);
export const metric=(label:string,value:string,note?:string)=>`**${label}**\n${value}${note?`\n-# ${note}`:''}`;
export const metricGrid=(items:Array<{label:string;value:string;note?:string}>):PanelChild=>text(items.map(item=>metric(item.label,item.value,item.note)).join('\n\n'));
export const statusBanner=(label:string,detail:string):PanelChild=>text(`### ${label}\n${detail}`);
export const recommendedAction=(title:string,detail:string):PanelChild=>text(`### Recommended next action\n**${title}**\n${detail}`);

export async function actionRow(issue:Issue,specs:ButtonSpec[]):Promise<ActionRow>{
 const buttons=await Promise.all(specs.slice(0,5).map(async spec=>({type:ComponentType.Button,style:spec.style??ButtonStyle.Secondary,label:spec.label,custom_id:await issue({action:spec.action,...spec.data},spec.publicEntry),disabled:spec.disabled} satisfies APIButtonComponent)));
 return {type:ComponentType.ActionRow,components:buttons};
}

export function nexusPanel(options:{title:string;subtitle?:string;accent?:Accent;children?:PanelChild[];rows?:ActionRow[];topLevel?:APIMessageTopLevelComponent[]}):Panel{
 const children=[...panelHeader(options.title,options.subtitle),...(options.children??[]),...(options.rows??[])];
 if(children.length>40)throw new Error('DISCORD_COMPONENT_LIMIT');
 return {flags:MessageFlags.IsComponentsV2,allowed_mentions:{parse:[]},components:[{type:ComponentType.Container,accent_color:colors[options.accent??'nexus'],components:children},...(options.topLevel??[])]};
}
