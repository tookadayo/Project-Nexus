import {expect,it} from 'vitest';
import {compileFlowDefinition} from '../../packages/automation/src/definition';
import {simulateAutomationPlan} from '../../packages/automation/src/simulation';
import type {FlowDefinition,JsonValue,Statement,ValueInput,ValueType} from '../../packages/automation/src/types';

const guildId='887111111111111111',member='887222222222222222',role='887333333333333333';
const clock='2026-01-01T00:00:00.000Z',shortDeadline='2026-01-01T00:00:10.000Z',longDeadline='2026-01-01T00:01:40.000Z';
const members:ValueType={kind:'List',element:'MemberRef'};
const literal=(type:ValueType,value:JsonValue):ValueInput=>({kind:'literal',type,value});
const variable=(variableId:string,type:ValueType):ValueInput=>({kind:'variable',type,variableId});
const initialMembers=literal(members,[{id:member,guildId}]);
const target:Statement={kind:'action',id:'role',operation:'discord.addRole',approvalRequired:true,inputs:{
  member:{kind:'expression',type:'MemberRef',expression:{operator:'list.item',args:[variable('members',members),literal('Number',1)]}},
  role:literal('RoleRef',{id:role,guildId}),
}};
const declare:Statement={kind:'declare',id:'members-declaration',variable:{id:'members',name:'Members',type:members},value:initialMembers};
const clear:Statement={kind:'assign',id:'clear-members',variableId:'members',value:literal(members,[])};
const approval=(approved:Statement[],until:ValueInput=literal('Instant',shortDeadline)):Statement=>({kind:'approval',id:'approval',actionId:'role',until,approved,rejected:[],expired:[]});
const flow=(body:Statement[],procedures?:FlowDefinition['procedures']):FlowDefinition=>({schemaVersion:1,id:'approval-simulation',name:'Approval simulation',guildId,trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[],roleIds:[role],parentCategoryIds:[]},body,...(procedures?{procedures}:{})});
const simulate=(definition:FlowDefinition)=>simulateAutomationPlan(compileFlowDefinition(definition),{approvals:{approval:'APPROVED'},outcomes:{role:'SUCCEEDED'}},clock);

it('uses the role inputs fixed before the approved branch changes their source variables',()=>{
  const definition=flow([declare,approval([clear]),target]),before=structuredClone(definition);
  const input={approvals:{approval:'APPROVED' as const},outcomes:{role:'SUCCEEDED' as const}},inputBefore=structuredClone(input);
  const result=simulateAutomationPlan(compileFlowDefinition(definition),input,clock);
  expect(result.status).toBe('COMPLETED');expect(result.plannedActions).toBe(1);
  expect(result.steps.find(step=>step.blockId==='role')?.state).toBe('MOCK_SUCCEEDED');
  expect(definition).toEqual(before);
  expect(input).toEqual(inputBefore);
  expect(result.approvalConsumption).toBe(0);
});

it('preserves the explicit outcome mock for an ordinary role action without an approval card',()=>{
  const result=simulate(flow([declare,target]));
  expect(result.status).toBe('COMPLETED');expect(result.plannedActions).toBe(1);
  expect(result.steps.find(step=>step.blockId==='role')?.state).toBe('MOCK_SUCCEEDED');
  expect(result.approvalConsumption).toBe(0);
});

it('rejects the bound role after its fixed receipt expires before charging or mocking the action',()=>{
  const result=simulate(flow([declare,approval([{kind:'wait',id:'after-approval-wait',duration:literal('Duration',20)}]),target]));
  expect(result.status).toBe('FAILED');expect(result.plannedActions).toBe(0);
  expect(result.steps.some(step=>step.blockId==='role'&&step.state==='MOCK_SUCCEEDED')).toBe(false);
  expect(result.steps.at(-1)?.code).toBe('SIMULATION_APPROVAL_EXPIRED');
});

it('keeps fixed receipt inputs and deadlines local to each invocation of the same procedure',()=>{
  const result=simulate(flow([
    {kind:'call',id:'first-call',procedureId:'role-procedure',revision:1,args:{deadline:literal('Instant',longDeadline),delay:literal('Duration',0)},outputs:{}},
    {kind:'call',id:'second-call',procedureId:'role-procedure',revision:1,args:{deadline:literal('Instant',shortDeadline),delay:literal('Duration',20)},outputs:{}},
  ],[{id:'role-procedure',name:'Role procedure',revision:1,inputs:[{id:'deadline',name:'Deadline',type:'Instant'},{id:'delay',name:'Delay',type:'Duration'}],outputs:[],body:[
    declare,approval([clear,{kind:'wait',id:'procedure-wait',duration:variable('delay','Duration')}],variable('deadline','Instant')),target,{kind:'return',id:'procedure-return',values:{}},
  ]}]));
  expect(result.status).toBe('FAILED');expect(result.plannedActions).toBe(1);
  expect(result.steps.filter(step=>step.blockId==='role'&&step.state==='MOCK_SUCCEEDED')).toHaveLength(1);
  expect(result.steps.at(-1)?.code).toBe('SIMULATION_APPROVAL_EXPIRED');
});

it('rebinds the same role action to a fresh receipt in each repeat iteration',()=>{
  const result=simulate(flow([
    {kind:'declare',id:'deadline-declaration',variable:{id:'deadline',name:'Deadline',type:'Instant'},value:literal('Instant',longDeadline)},
    {kind:'repeat',id:'repeat',count:literal('Number',2),itemVariable:{id:'item',name:'Item',type:'Number'},body:[declare,approval([
      clear,
      {kind:'assign',id:'change-deadline',variableId:'deadline',value:literal('Instant',shortDeadline)},
      {kind:'branch',id:'second-delay',condition:{kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[variable('item','Number'),literal('Number',2)]}},then:[{kind:'wait',id:'repeat-wait',duration:literal('Duration',20)}],otherwise:[],unknown:[]},
    ],variable('deadline','Instant')),target]},
  ]));
  expect(result.status).toBe('FAILED');expect(result.plannedActions).toBe(1);
  expect(result.steps.filter(step=>step.blockId==='role'&&step.state==='MOCK_SUCCEEDED')).toHaveLength(1);
  expect(result.steps.at(-1)?.code).toBe('SIMULATION_APPROVAL_EXPIRED');
});
