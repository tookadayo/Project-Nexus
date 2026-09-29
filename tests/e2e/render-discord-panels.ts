// Visual QA approximation from actual Components V2 payloads; no Discord client is emulated.
import {controlPanel,type ControlData} from '../../packages/discord-panels/src/views/control.js';
import {ComponentType} from 'discord-api-types/v10';
const now=new Date('2026-09-30T09:00:00Z');
const weekly={reply:{state:'READY',value:18,previous:24,sample:17,needed:0,from:'2026-09-20T00:00:00Z',through:'2026-09-27T00:00:00Z',observationDays:3},connection:{state:'READY',value:72,previous:64,sample:25,needed:0,from:'2026-09-20T00:00:00Z',through:'2026-09-27T00:00:00Z',observationDays:3},retention:{state:'READY',value:48,previous:48,sample:25,needed:0,from:'2026-09-15T00:00:00Z',through:'2026-09-22T00:00:00Z',observationDays:8}};
const settings={analysisScope:{mode:'all',channelIds:[]},managerRoleIds:['111111111111111111'],helperRoleIds:['111111111111111112'],weeklySummaryEnabled:true,weeklySummaryChannelId:'111111111111111113',weeklySummaryDay:1,weeklySummaryHour:9,timezone:'Asia/Tokyo',helperEnabled:true,helperChannelId:'111111111111111113',firstResponseMinutes:20,goalPreset:null,newMemberGoals:['reply','voice','event'],importantChannels:[],uiLanguage:'ja',detailedRetentionDays:30,revision:2,setupVersion:2,setupSteps:{scope:true,team:true,notifications:true,goals:true}} satisfies NonNullable<ControlData['settings']>;
const community={weekly,daily:{ready:true,todayJoined:4,todayConnected:3,attentionCount:2,timezone:'Asia/Tokyo'},attention:[{channelId:'111111111111111114',messageId:'111111111111111115',waitingMinutes:42,status:'OPEN',url:'https://discord.com/channels/111111111111111116/111111111111111114/111111111111111115'}],suggestion:{key:'reply_rescue',basis:{newcomerMinutes:32,continuingMinutes:18}},compare:{available:true,newcomers:{members:17,replyMinutes:32},continuing:{members:17,replyMinutes:18}},outcomes:{retained:12,notRetained:13,pending:4},arrivalCount:29,eligibleMembers:25,stages:[{key:'joined',count:25},{key:'activated',count:22},{key:'connected',count:18},{key:'retained',count:12}],dataReady:true,channels:[],cohortWindow:{joinedFrom:'2026-08-23T00:00:00Z',joinedThrough:'2026-09-22T00:00:00Z',observedThroughDays:8},classification:{continuing:40,inactive:12,exited:3,staffExcluded:4},reactionsReceived:4,range:30} as unknown as ControlData['community'];
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function markdown(value:string){return escape(value.replace(/<#111111111111111114>/g,'#general').replace(/<#111111111111111113>/g,'#staff-alerts').replace(/<@&111111111111111111>/g,'@Managers').replace(/<@&111111111111111112>/g,'@Helpers').replace(/<t:\d+:R>/g,'3 seconds ago')).split('\n').map(line=>line.startsWith('## ')?`<h2>${line.slice(3)}</h2>`:line.startsWith('-# ')?`<small>${line.slice(3)}</small>`:line.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')).join('<br/>');}
function component(node:Record<string,unknown>):string{
 if(node.type===ComponentType.Container)return `<article class="panel">${(node.components as Record<string,unknown>[]).map(component).join('')}</article>`;
 if(node.type===ComponentType.TextDisplay)return `<div class="text">${markdown(String(node.content))}</div>`;
 if(node.type===ComponentType.Separator)return '<hr/>';
 if(node.type===ComponentType.ActionRow)return `<div class="row">${(node.components as Record<string,unknown>[]).map(component).join('')}</div>`;
 if(node.type===ComponentType.Button)return `<button class="style-${node.style}" ${node.disabled?'disabled':''}>${(node.emoji as {name?:string}|undefined)?.name??''} ${escape(String(node.label))}${node.style===5?' ↗':''}</button>`;
 return `<div class="select">${escape(String(node.placeholder??'Select'))}<span>⌄</span></div>`;
}
const output:Record<string,{html:string;count:number;characters:number}>={};
function count(node:unknown):number{return Array.isArray(node)?node.reduce((sum,item)=>sum+count(item),0):node&&typeof node==='object'?('type' in node?1:0)+count((node as {components?:unknown}).components):0;}
for(const locale of ['ja','en'] as const)for(const name of ['home','no-data','attention','new-members','analysis','settings','notifications'] as const){
 const page=name==='home'||name==='no-data'?'overview':name==='new-members'?'newMembers':name==='notifications'?'settings':name;
 const data:ControlData={community:name==='no-data'?{...community,daily:{ready:true,todayJoined:0,todayConnected:0,attentionCount:0,timezone:'Asia/Tokyo'},attention:[],suggestion:null,weekly:Object.fromEntries(Object.entries(weekly).map(([key,item])=>[key,{...item,value:null,previous:null,state:'NO_ELIGIBLE_MEMBERS',sample:0,needed:5}]))} as unknown as ControlData['community']:community,settings,dashboardUrl:'https://nexus.example/dashboard/111111111111111116',updatedAt:now};
 const panel=await controlPanel(async()=> 'preview',page,data,locale,name==='notifications'?'notifications':'main');
 output[`${locale}-${name}`]={html:(panel.components??[]).map(node=>component(node as unknown as Record<string,unknown>)).join(''),count:count(panel.components),characters:JSON.stringify(panel).length};
}
process.stdout.write(JSON.stringify(output));
