import {ButtonStyle,ComponentType,MessageFlags,SeparatorSpacingSize,type APIActionRowComponent,type APIButtonComponent,type APIComponentInMessageActionRow,type APIComponentInContainer,type APIMessageTopLevelComponent,type APISectionAccessoryComponent,type APISectionComponent,type RESTPostAPIChannelMessageJSONBody} from 'discord-api-types/v10';
import {componentEmoji,readApplicationEmojiConfig,withEmojiText,type ApplicationEmojiKey} from '../../shared/src/application-emoji.js';
import {colors,type Accent} from './theme.js';
import type {Issue} from './types.js';

export type Panel=RESTPostAPIChannelMessageJSONBody;
export type PanelChild=APIComponentInContainer;
export type ActionRow=APIActionRowComponent<APIComponentInMessageActionRow>;
export type InteractiveButtonStyle=ButtonStyle.Primary|ButtonStyle.Secondary|ButtonStyle.Success|ButtonStyle.Danger;
export type ButtonSpec={label:string;action:string;emoji?:string;emojiKey?:ApplicationEmojiKey;style?:InteractiveButtonStyle;data?:Record<string,unknown>;publicEntry?:boolean;disabled?:boolean};

// Body text stays Unicode: retry safety identifies dedicated component emoji fields only.
export const panelIconText=(key:ApplicationEmojiKey,label:string)=>withEmojiText(key,label,{mode:readApplicationEmojiConfig().mode==='text'?'text':'unicode'});

// Escape only user supplied names; product copy intentionally uses Discord markdown.
export const escapeUserText=(value:string)=>value.replaceAll(/([\\`*_~|>[\]()])/g,'\\$1').replaceAll('@','@\u200b').replaceAll('<','\\<');
export function validatePanel(panel:Panel):void{
 const components=panel.components??[];
 if(componentCount({components})>40)throw new Error('DISCORD_COMPONENT_LIMIT');
 const bounded=(value:unknown,min:number,max:number,code:string)=>{if(typeof value!=='string'||value.length<min||value.length>max)throw new Error(code);};
 let textLength=0;
 const inspect=(value:unknown):void=>{
  if(!value||typeof value!=='object')return;
  const c=value as Record<string,unknown>,children=c.components as unknown[]|undefined;
  if(c.custom_id!==undefined)bounded(c.custom_id,1,100,'DISCORD_CUSTOM_ID_LIMIT');
  if(c.type===ComponentType.TextDisplay){bounded(c.content,1,4000,'DISCORD_TEXT_LIMIT');textLength+=String(c.content).length;}
  if(c.type===ComponentType.Button){if(c.label!==undefined)bounded(c.label,1,80,'DISCORD_BUTTON_LIMIT');if(c.url!==undefined)bounded(c.url,1,512,'DISCORD_LINK_LIMIT');}
  if(c.type===ComponentType.Section){if(!children||children.length<1||children.length>3||children.some(v=>(v as {type:number}).type!==ComponentType.TextDisplay)||![ComponentType.Button,ComponentType.Thumbnail].includes((c.accessory as {type:number}|undefined)?.type as ComponentType.Button))throw new Error('DISCORD_SECTION_LIMIT');}
  if(c.type===ComponentType.ActionRow){if(!children||!children.length||children.length>5||children.filter(v=>(v as {style?:number}).style===ButtonStyle.Primary).length>1||children.length>1&&children.some(v=>(v as {type:number}).type!==ComponentType.Button))throw new Error('DISCORD_ACTION_GROUP_LIMIT');}
  if(c.placeholder!==undefined)bounded(c.placeholder,0,150,'DISCORD_SELECT_LIMIT');
  if(c.type===ComponentType.StringSelect){const options=c.options as Record<string,unknown>[];if(!options?.length||options.length>25)throw new Error('DISCORD_SELECT_LIMIT');for(const o of options){bounded(o.label,1,100,'DISCORD_SELECT_LIMIT');bounded(o.value,1,100,'DISCORD_SELECT_LIMIT');if(o.description!==undefined)bounded(o.description,0,100,'DISCORD_SELECT_LIMIT');}}
  if([ComponentType.StringSelect,ComponentType.ChannelSelect,ComponentType.RoleSelect,ComponentType.UserSelect,ComponentType.MentionableSelect].includes(c.type as ComponentType.StringSelect)){for(const key of ['min_values','max_values'])if(c[key]!==undefined&&(!Number.isInteger(c[key])||Number(c[key])<0||Number(c[key])>25))throw new Error('DISCORD_SELECT_LIMIT');}
  for(const child of children??[])inspect(child);
  if(c.accessory)inspect(c.accessory);
 };
 for(const c of components)inspect(c);
 if(textLength>4000)throw new Error('DISCORD_MESSAGE_TEXT_LIMIT');
}

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
 return {type:ComponentType.Button,style:spec.style??ButtonStyle.Secondary,label:spec.label,emoji:spec.emojiKey?componentEmoji(spec.emojiKey):spec.emoji&&readApplicationEmojiConfig().mode!=='text'?{name:spec.emoji}:undefined,custom_id:customId,disabled:spec.disabled};
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
 const result:Panel={flags:MessageFlags.IsComponentsV2,allowed_mentions:{parse:[]},components:[{type:ComponentType.Container,accent_color:colors[options.accent??'nexus'],components:children},...(options.topLevel??[])]};
 validatePanel(result);
 return result;
}
