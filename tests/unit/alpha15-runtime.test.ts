import {expect,it} from 'vitest';
import {dynamicExecutionIdentity} from '../../packages/automation/src/runtime';
import {utcUsageMonth,validateAdmissionLimits} from '../../packages/automation/src/quota';
import {measureAutomationRuntime} from '../../packages/automation/src/measurement';
import {nextScheduleAt} from '../../packages/automation/src/scheduler';
import {compileFlowDefinition} from '../../packages/automation/src/definition';
import {simulateAutomationPlan} from '../../packages/automation/src/simulation';
import type {FlowDefinition,Statement,ValueType} from '../../packages/automation/src/types';

it('keeps dynamic random identities stable across resume and distinct by iteration, call, and run',()=>{
  const run={id:'run1',revision:2,semantic_hash:'fixed'},frame={path:'body/0/body',index:3,locals:[],loop:{nodePath:'body/0',items:[],iteration:0}};
  const value=dynamicExecutionIdentity(run,[frame],'random');
  expect(dynamicExecutionIdentity({...run},[structuredClone(frame)],'random')).toBe(value);
  expect(dynamicExecutionIdentity(run,[{...frame,loop:{...frame.loop,iteration:1}}],'random')===value).toBe(false);
  expect(dynamicExecutionIdentity({...run,id:'run2'},[frame],'random')===value).toBe(false);
  expect(dynamicExecutionIdentity(run,[{...frame,path:'procedures/0/body'}],'random')===value).toBe(false);
});
it('uses UTC calendar accounting and rejects unbounded host policies',()=>{
  expect(utcUsageMonth(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
  expect(()=>validateAdmissionLimits({activeFlows:1,monthlyRuns:Infinity,guildConcurrent:1,globalConcurrent:1,guildPending:1,globalPending:1,measurementId:'test'})).toThrow('AUTOMATION_POLICY_INVALID');
});
it('never backfills a past one-shot schedule',()=>{
  const definition:FlowDefinition={schemaVersion:1,id:'scheduled',guildId:'884000000000000001',name:'Synthetic',trigger:{kind:'schedule',schedule:{kind:'once',at:{date:'2026-10-15',time:'09:00',timeZone:'UTC'}}},variables:[],body:[]};
  expect(nextScheduleAt(definition,new Date('2026-10-15T09:00:01Z'))).toBe(null);
  expect(nextScheduleAt(definition,new Date('2026-10-15T08:59:59Z'))?.toISOString()).toBe('2026-10-15T09:00:00.000Z');
});
it('runs a small finite probe with no external requests or claimed production capacity',()=>{
  const result=measureAutomationRuntime(10);expect(result.samples).toBe(10);expect(result.externalRequests).toBe(0);expect(result.productionCapacityVerified).toBe(false);expect(result.maxSerializedBytes>0).toBe(true);
  expect(()=>measureAutomationRuntime(1001)).toThrow('AUTOMATION_MEASUREMENT_LIMIT');
});
it('simulates the production expression evaluator, fixed count and branches without any external changes',()=>{
  const flow:FlowDefinition={schemaVersion:1,id:'simulation',guildId:'884000000000000001',name:'Synthetic',trigger:{kind:'manual',inputs:[]},variables:[],body:[{kind:'repeat',id:'repeat',count:{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[{kind:'literal',type:'Number',value:30},{kind:'literal',type:'Number',value:10}]}},itemVariable:{id:'index',name:'Index',type:'Number'},body:[{kind:'declare',id:'declare',variable:{id:'value',name:'Value',type:'Number'},value:{kind:'literal',type:'Number',value:1}}]}]};
  const result=simulateAutomationPlan(compileFlowDefinition(flow));expect(result.status).toBe('COMPLETED');expect(result.steps.filter(step=>step.blockId==='declare').length).toBe(3);expect(result).toMatchObject({externalChanges:0,productionRuns:0,approvalConsumption:0,productionDraws:0,mocked:true});
});
it('labels missing mock input undetermined instead of inventing a success value',()=>{
  const flow:FlowDefinition={schemaVersion:1,id:'simulation-input',guildId:'884000000000000001',name:'Synthetic',trigger:{kind:'manual',inputs:[{id:'number',name:'Number',type:'Number'}]},variables:[],body:[{kind:'end',id:'end'}]};
  expect(simulateAutomationPlan(compileFlowDefinition(flow)).status).toBe('UNDETERMINED');expect(simulateAutomationPlan(compileFlowDefinition(flow),{values:{number:{type:'Number',value:0}}}).status).toBe('COMPLETED');
});
const simulationGuild='884000000000000001',simulationChannel='884222222222222222';
const simulationFlow=(body:Statement[]):FlowDefinition=>({schemaVersion:1,id:'explicit-outcomes',guildId:simulationGuild,name:'Synthetic explicit outcomes',trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[simulationChannel],roleIds:[],parentCategoryIds:[]},body});
const simulatedSend=(id='send'):Statement=>({kind:'action',id,operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:simulationChannel,guildId:simulationGuild}},content:{kind:'literal',type:'PlainText',value:'Synthetic'}}});
const ticketRecord:ValueType={kind:'Record',schemaId:'nexus.ticket.status.v1'};
const simulatedRead=(withOutput=true):Statement=>({kind:'action',id:'read',operation:'nexus.readTicket',inputs:{ticket:{kind:'literal',type:'TicketRef',value:{id:'intake:12345678-1234-1234-1234-123456789abc',guildId:simulationGuild}}},...(withOutput?{output:{id:'status',name:'Ticket status',type:ticketRecord}}:{})});
it('requires an explicit own outcome for every mock action before following later blocks',()=>{
  const plan=compileFlowDefinition(simulationFlow([simulatedSend(),simulatedSend('later')]));
  const result=simulateAutomationPlan(plan);expect(result.status).toBe('UNDETERMINED');expect(result.steps).toEqual([{blockId:'send',kind:'action',state:'UNDETERMINED',operation:'discord.sendMessage',code:'MOCK_OUTCOME_REQUIRED'}]);
  expect(result).toMatchObject({externalChanges:0,productionRuns:0,approvalConsumption:0});
  const inherited=Object.create({send:'SUCCEEDED'}) as Record<string,'SUCCEEDED'>;expect(simulateAutomationPlan(plan,{outcomes:inherited}).status).toBe('UNDETERMINED');
  expect(simulateAutomationPlan(plan,{outcomes:{send:'SUCCEEDED',later:'SUCCEEDED'}}).status).toBe('COMPLETED');
});
it.each([['FAILED','FAILED'],['NOT_STARTED','FAILED'],['UNKNOWN','UNKNOWN']] as const)('preserves the explicit %s mock result and stops later actions', (outcome,status)=>{
  const plan=compileFlowDefinition(simulationFlow([simulatedSend(),simulatedSend('later')])),result=simulateAutomationPlan(plan,{outcomes:{send:outcome,later:'SUCCEEDED'}});
  expect(result.status).toBe(status);expect(result.steps).toHaveLength(1);expect(result.steps[0]!.state).toBe('MOCK_'+outcome);
});
it('does not infer successful reads from the presence of a typed mock output',()=>{
  const plan=compileFlowDefinition(simulationFlow([simulatedRead()])),outputs={read:{type:ticketRecord,value:{state:'OPEN',version:1}}};
  expect(simulateAutomationPlan(plan,{outputs})).toMatchObject({status:'UNDETERMINED',plannedActions:0,steps:[{blockId:'read',code:'MOCK_OUTCOME_REQUIRED'}]});
  expect(simulateAutomationPlan(plan,{outputs,outcomes:{read:'SUCCEEDED'}})).toMatchObject({status:'COMPLETED',plannedActions:0});
});
it('charges bounded repeated reads to steps and evaluations while reserving the action budget for changes',()=>{
  const plan=compileFlowDefinition(simulationFlow([{kind:'repeat',id:'repeat',count:{kind:'literal',type:'Number',value:30},itemVariable:{id:'index',name:'Index',type:'Number'},body:[simulatedRead(false)]},simulatedSend()]),{limits:{maxExternalActions:1}});
  expect(simulateAutomationPlan(plan,{outcomes:{read:'SUCCEEDED',send:'SUCCEEDED'}})).toMatchObject({status:'COMPLETED',plannedActions:1,transitions:32,evaluations:33,externalChanges:0});
});
