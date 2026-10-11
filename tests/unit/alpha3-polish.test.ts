import {expect,it} from 'vitest';
import {ComponentType,ButtonStyle} from 'discord-api-types/v10';
import {controlPanel,type ControlData} from '../../packages/discord-panels/src/views/control.js';
import {measurementLabel} from '../../packages/discord-panels/src/views/home.js';
import {measurementState,weeklyMeasurements,type Measurement} from '../../packages/presentation/src/measurement.js';
import {canOperatePanel,Components} from '../../packages/security/src/index.js';
import {signalRegistry,validateSignal} from '../../packages/events/src/registry.js';
import {notificationModal} from '../../apps/interaction/src/settings-modal.js';
import {run,result} from "../fixtures/analysis-panels";
import {pricingMetadata} from '../../packages/settings/src/plan-registry.js';

const now=new Date('2026-09-30T09:00:00Z'),day=86400000;
const measured=(value:number|null,previous:number|null=null,state:Measurement['state']='READY'):Measurement=>({state,value,previous,sample:10,numerator:7,eligible:12,responded:10,activityFromDay:7,needed:0,from:'2026-09-20T09:00:00Z',through:'2026-09-27T09:00:00Z',observationDays:3});
const community=(overrides:Record<string,unknown>={})=>({arrivalCount:0,daily:{ready:true,todayJoined:0,todayConnected:0,attentionCount:0,timezone:'Asia/Tokyo'},attention:[],suggestion:null,...overrides}) as unknown as ControlData['community'];
const settings={analysisScope:{mode:'all',channelIds:[]},managerRoleIds:[],helperRoleIds:[],weeklySummaryEnabled:true,weeklySummaryChannelId:'111111111111111111',weeklySummaryDay:1,weeklySummaryHour:9,timezone:'Asia/Tokyo',helperEnabled:true,helperChannelId:'111111111111111111',firstResponseMinutes:20,goalPreset:null,newMemberGoals:['reply'],importantChannels:[],uiLanguage:'ja',detailedRetentionDays:30,revision:2,setupVersion:2,setupSteps:{scope:true,team:true,notifications:true,goals:true}} satisfies NonNullable<ControlData['settings']>;
async function render(page:'overview'|'settings'|'analysis'|'community',data:ControlData,locale:'ja'|'en',section:'main'|'notifications'|'team'|'goals'='main'){
 const intents:Record<string,unknown>[]=[];
 const panel=await controlPanel(async intent=>{intents.push(intent);return `test-${intents.length-1}`;},page,{updatedAt:now,...data},locale,section);
 const container=panel.components?.[0];if(container?.type!==ComponentType.Container)throw new Error('Missing container');
 const rows=container.components.filter(item=>item.type===ComponentType.ActionRow);
 return {panel,json:JSON.stringify(panel),intents,children:container.components,rows,buttons:rows.flatMap(row=>row.components).filter(component=>component.type===ComponentType.Button)};
}
it.each(['ja','en'] as const)('keeps confirmed zero and unavailable observations distinct across Home and activity (%s)',async locale=>{
 const noMembers=await render('overview',{community:community()},locale);
 expect(noMembers.json).toContain(locale==='ja'?'現在の条件で、追加された要確認の記録はありません。':'No review records are listed under the current conditions.');
 expect(noMembers.json).toContain(locale==='ja'?'基本の分析':'Basic analysis');
 const metric={...result.metrics[0]!,quality:'COMPLETE' as const,evidence:{...result.metrics[0]!.evidence,value:0,observationState:'OBSERVED' as const,coverageState:'COMPLETE' as const}};
 const zero=await render('analysis',{basicAnalysis:{result:{...result,metrics:[metric]},from:run.period_start,to:run.period_end,channelCount:1}},locale);
 expect(zero.json).toContain(locale==='ja'?'0件':'0 items');
 const unavailable=await render('overview',{community:community({daily:{ready:false,todayJoined:null,todayConnected:null,attentionCount:null}})},locale);
 expect(unavailable.json).toContain(locale==='ja'?'現在の状態を確認できません。時間をおいて更新してください。':'We cannot determine the current status. Refresh again later.');
 expect(unavailable.json).not.toContain(locale==='ja'?'現在の条件で、追加された要確認の記録はありません。':'No review records are listed under the current conditions.');
});
it.each(['ja','en'] as const)('keeps activity, review and detailed analysis in stable positions (%s)',async locale=>{
 const home=await render('overview',{community:community({daily:{ready:true,todayJoined:4,todayConnected:3,attentionCount:2},attention:[{channelId:'111111111111111111',waitingMinutes:42}]})},locale);
 const sections=home.children.filter(item=>item.type===ComponentType.Section);
 expect(sections).toHaveLength(3);
 expect(sections[0]!.components[0]).toMatchObject({content:expect.stringContaining(locale==='ja'?'基本の分析':'Basic analysis')});
 expect(sections[1]!.components[0]).toMatchObject({content:expect.stringContaining(locale==='ja'?'要確認':'Needs review')});
 expect(sections[2]!.accessory).toMatchObject({style:ButtonStyle.Primary,custom_id:expect.any(String)});
 expect(home.intents.find(item=>item.page==='attention')).toMatchObject({action:'controlNavigate'});
});
it('offers exactly six Home actions and three Section destinations',async()=>{
 const home=await render('overview',{community:community(),dashboardUrl:'https://nexus.example/dashboard/111111111111111111'},'en');
 expect(home.intents).toContainEqual({action:'analysisMenu'});
 for(const page of ['attention','analysis'])expect(home.intents).toContainEqual({action:'controlNavigate',page});
 expect(home.intents).toContainEqual({action:'analysisHistory'});
 expect(home.buttons).toHaveLength(3);
 expect(home.children.filter(item=>item.type===ComponentType.Section)).toHaveLength(3);
 expect(home.rows.flatMap(row=>row.components).filter(item=>item.type===ComponentType.StringSelect)).toHaveLength(0);
 expect(home.json).toContain('More');
 expect(home.buttons.every(button=>button.style===ButtonStyle.Secondary)).toBe(true);
});
it.each(['ja','en'] as const)('only shows supported weekly comparisons and suggestions in measurement details (%s)',async locale=>{
 const weekly={reply:measured(18,24),connection:measured(72,64),retention:measured(48,null)};
 const home=await render('community',{community:community({weekly})},locale);
 expect(home.json).toContain(locale==='ja'?'前の比較期間より6分早い':'6 minutes faster than the previous comparison period');
 expect(home.json).toContain('+8pt');
 expect(home.json).not.toContain(locale==='ja'?'分析結果':'What NEXUS noticed');
 const suggested=await render('community',{community:community({weekly,suggestion:{key:'reply_rescue',basis:{newcomerMinutes:32,continuingMinutes:18}},compare:{newcomers:{members:10},continuing:{members:10}}})},locale);
 expect(suggested.intents.some(item=>item.action==='controlTryImprove')).toBe(true);
 expect(suggested.json).toContain(locale==='ja'?'詳しく分析する':'Start detailed analysis');
 const collecting=await render('community',{community:community({weekly:{reply:measured(null,null,'COLLECTING'),connection:measured(null,null,'NO_ELIGIBLE_MEMBERS'),retention:measured(null,null,'UNAVAILABLE')}})},locale);
 expect(collecting.json).not.toContain('+8pt');
 expect(collecting.json).toContain(locale==='ja'?'まだ比較できる':'Not enough data to compare');
});
it.each(['ja','en'] as const)('keeps main settings as a summary with private detail entry points (%s)',async locale=>{
 const main=await render('settings',{settings,dashboardUrl:'https://nexus.example/dashboard/111111111111111111'},locale);
 for(const section of ['scope','notifications','team','goals'])expect(main.intents).toContainEqual({action:'controlSettings',section,privateSettings:true});
 expect(main.intents).toContainEqual({action:'controlNavigate',page:'overview'});
 expect(main.rows.flatMap(row=>row.components).filter(item=>[ComponentType.ChannelSelect,ComponentType.RoleSelect].includes(item.type))).toHaveLength(0);
 expect(main.json).not.toMatch(/Redis|Gateway|Build SHA|Transport/);
 expect(main.intents.some(item=>item.action==='setupWizard')).toBe(true);
 const notifications=await render('settings',{settings},locale,'notifications');
 expect(notifications.intents.some(item=>item.action==='controlNotificationEdit')).toBe(true);
 expect(notifications.intents.some(item=>item.action==='controlAlertDelay')).toBe(false);
 const team=await render('settings',{settings},locale,'team');expect(team.intents.some(item=>item.action==='controlManagers')).toBe(true);
 const goals=await render('settings',{settings},locale,'goals');expect(goals.intents.some(item=>item.action==='controlGoal')).toBe(true);
});
it('uses observation coverage, sample thresholds and genuine denominators for weekly measurements',()=>{
 const members=Array.from({length:10},(_,i)=>({joinedAt:new Date(now.getTime()-(i<5?5:12)*day),firstReplyMinutes:i<5?18:24,connected:i<5,retained:false}));
 const results=weeklyMeasurements(members,now,8,30,()=>true);
 expect(results.reply).toMatchObject({value:18,previous:24,sample:5});
 expect(results.connection).toMatchObject({value:100,previous:0});
 expect(results.retention).toMatchObject({value:0,state:'ZERO',previous:null});
 expect(weeklyMeasurements(members,now,8,7,()=>true).retention.value).toBeNull();
 expect(weeklyMeasurements(members,now,8,30,()=>false).connection.state).toBe('UNAVAILABLE');
 expect(weeklyMeasurements(members,now,8,30,()=>true,false).reply.state).toBe('UNAVAILABLE');
 expect(weeklyMeasurements(members.slice(0,2),now,8,30,()=>true).connection).toMatchObject({state:'INSUFFICIENT_SAMPLE',needed:3,value:null});
 expect(weeklyMeasurements([{...members[0]!,joinedAt:now}],now,8,30,()=>true).connection.state).toBe('COLLECTING');
});
it('represents all no-data states without manufacturing a value',()=>{
 expect(measurementState(false,10,10)).toBe('UNAVAILABLE');
 expect(measurementState(true,0,0)).toBe('NO_ELIGIBLE_MEMBERS');
 expect(measurementState(true,10,0)).toBe('COLLECTING');
 expect(measurementState(true,10,2)).toBe('INSUFFICIENT_SAMPLE');
 expect(measurementLabel(measured(0,null,'ZERO'),'en')).toBe('0%');
});
it.each([['8',[],true],['32',[],true],['0',['111111111111111111'],true],['0',[],false]] as const)('authorizes staff permissions and roles on the server (%s)',(permissions,roles,expected)=>{
 expect(canOperatePanel(permissions,[...roles],['111111111111111111'])).toBe(expected);
});
it('treats received reactions as weak, private, detailed observations',()=>{
 expect(signalRegistry['reaction.received']).toMatchObject({active:false,retentionCategory:'detailed',source:'projector'});
 expect(()=>validateSignal('reaction.received',{messageId:'111111111111111111',channelId:'222222222222222222',content:'forbidden'})).toThrow();
 expect(Components.kind('private:opaque')).toBe('ephemeral');
 expect(notificationModal('modal','en',20,true).components).toHaveLength(1);
 expect(pricingMetadata).toMatchObject({currency:'USD',classification:'INTERNAL_PROVISIONAL'});
 expect(pricingMetadata).not.toHaveProperty('publishPrices');
});
