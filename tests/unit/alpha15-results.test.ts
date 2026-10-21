import {expect,it} from 'vitest';
import {compileFlowDefinition,validateFlowDefinition} from '../../packages/automation/src/definition';
import {evaluateValue,assertValueMatchesType} from '../../packages/automation/src/expression';
import {simulateAutomationPlan} from '../../packages/automation/src/simulation';
import type {FlowDefinition,Statement,ValueInput,ValueType} from '../../packages/automation/src/types';
const guildId='885111111111111111',channel='885222222222222222';
const parse=(text:string,target:ValueType='Number',conversion:'decimal'|'dateSlash'|'enum'='decimal'):ValueInput=>({kind:'expression',type:{kind:'ParseResult',value:target},expression:{operator:'value.parse',args:[{kind:'literal',type:'PlainText',value:text}],options:{conversion}}});
const evaluate=(input:ValueInput)=>evaluateValue(input,{guildId,variables:{}});
const flow=(body:Statement[]):FlowDefinition=>({schemaVersion:1,id:'results',name:'Typed results',guildId,trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[channel],roleIds:[],parentCategoryIds:[]},body});
const handler=(value:ValueInput=parse('10')):Extract<Statement,{kind:'resultBranch'}>=>({id:'handle',kind:'resultBranch',value,output:{id:'success',name:'Success',type:'Number'},reason:{id:'reason',name:'Reason',type:'PlainText'},succeeded:[],failed:[],notStarted:[],unknown:[]});
it.each(['',' ','10abc','NaN','Infinity','1,000','１','1e3','10%','.5','01','1.','0x10','--2'])('strict decimal conversion rejects ambiguous text %j without a fallback',text=>{expect(evaluate(parse(text)).value).toMatchObject({state:'FAILED',reason:'PARSE_NUMBER_FORMAT'});});
it('converts exact finite decimals, real slash dates, and stable enum values only',()=>{
  expect(evaluate(parse('-10.5')).value).toEqual({state:'SUCCEEDED',value:-10.5});expect(evaluate(parse('9007199254740993')).value).toMatchObject({state:'FAILED',reason:'PARSE_NUMBER_RANGE'});
  expect(evaluate(parse('2028/02/29','DateOnly','dateSlash')).value).toEqual({state:'SUCCEEDED',value:'2028-02-29'});
  expect(evaluate(parse('2027/02/29','DateOnly','dateSlash')).value).toMatchObject({state:'FAILED',reason:'PARSE_DATE_INVALID'});
  expect(evaluate(parse('03/04','DateOnly','dateSlash')).value).toMatchObject({state:'FAILED',reason:'PARSE_DATE_FORMAT'});
  const choice:ValueType={kind:'Enum',values:['stable-a','stable-b']};expect(evaluate(parse('stable-a',choice,'enum')).value).toEqual({state:'SUCCEEDED',value:'stable-a'});expect(evaluate(parse('Display A',choice,'enum')).value).toMatchObject({state:'FAILED',reason:'PARSE_ENUM_VALUE'});
});
it('refuses result literals, forged variable provenance, cross-kind casts and failure payloads',()=>{
  for(const kind of ['ParseResult','OperationOutcome'] as const){const result:ValueType={kind,value:'Number'};expect(()=>evaluate({kind:'literal',type:result,value:{state:'SUCCEEDED',value:1}})).toThrow();expect(()=>evaluateValue({kind:'variable',type:result,variableId:'fake'},{guildId,variables:{fake:{type:result,value:{state:'SUCCEEDED',value:1},provenance:[{source:'literal'}]}}})).toThrow('registered producer');expect(()=>assertValueMatchesType(result,{state:'FAILED',value:1,reason:'PARSE_NUMBER_FORMAT'},{guildId})).toThrow();}
  const result=evaluate(parse('1'));expect(()=>evaluateValue({kind:'variable',type:{kind:'OperationOutcome',value:'Number'},variableId:'parse'},{guildId,variables:{parse:result}})).toThrow();
  expect(()=>evaluate(parse('1','MemberRef','decimal'))).toThrow();
});
it('exposes success values only inside the successful read-only branch and safe reasons elsewhere',()=>{
  const branch=handler();branch.succeeded=[{kind:'declare',id:'copy',variable:{id:'copy',name:'Copy',type:'Number'},value:{kind:'variable',type:'Number',variableId:'success'}}];expect(validateFlowDefinition(flow([branch])).valid).toBe(true);
  branch.failed=[{kind:'declare',id:'leak',variable:{id:'leak',name:'Leak',type:'Number'},value:{kind:'variable',type:'Number',variableId:'success'}}];expect(validateFlowDefinition(flow([branch])).valid).toBe(false);
  branch.failed=[];branch.succeeded=[{kind:'assign',id:'overwrite',variableId:'success',value:{kind:'literal',type:'Number',value:0}}];expect(validateFlowDefinition(flow([branch])).issues.some(issue=>issue.code==='VARIABLE_READONLY')).toBe(true);
});
it.each([false,0,''])('keeps a present Optional payload %j distinct from unset',value=>{
  const payload:ValueType=typeof value==='boolean'?'Boolean':typeof value==='number'?'Number':'PlainText';
  const branch:Extract<Statement,{kind:'optionalBranch'}>={kind:'optionalBranch',id:'optional',value:{kind:'literal',type:{kind:'Optional',value:payload},value:{state:'set',value}},output:{id:'present',name:'Present',type:payload},present:[{kind:'end',id:'present-end'}],unset:[{kind:'end',id:'unset-end'}]};
  const result=simulateAutomationPlan(compileFlowDefinition(flow([branch])));expect(result.status).toBe('COMPLETED');expect(result.steps.some(step=>step.blockId==='present-end')).toBe(true);expect(result.steps.some(step=>step.blockId==='unset-end')).toBe(false);
  branch.value={kind:'literal',type:{kind:'Optional',value:payload},value:{state:'unset'}};expect(simulateAutomationPlan(compileFlowDefinition(flow([branch]))).steps.some(step=>step.blockId==='unset-end')).toBe(true);
});
it('requires the dedicated immediate handler and forbids any effect in an UNKNOWN route',()=>{
  const outcome:ValueType={kind:'OperationOutcome',value:'MessageRef'};
  const action:Statement={kind:'action',id:'send',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId}},content:{kind:'literal',type:'PlainText',value:'Synthetic'}},outcome:{id:'operation-result',name:'Result',type:outcome}};
  expect(validateFlowDefinition(flow([action])).issues.some(issue=>issue.code==='ACTION_OUTCOME_HANDLER')).toBe(true);
  const branch=handler({kind:'variable',type:outcome,variableId:'operation-result'});branch.output.type='MessageRef';branch.unknown=[{kind:'wait',id:'forbidden',duration:{kind:'literal',type:'Duration',value:1}}];expect(validateFlowDefinition(flow([action,branch])).issues.some(issue=>issue.code==='UNCERTAINTY_EFFECT')).toBe(true);
  branch.unknown=[{kind:'declare',id:'remember',variable:{id:'handled',name:'Handled',type:'PlainText'},value:{kind:'variable',type:'PlainText',variableId:'reason'}}];const plan=compileFlowDefinition(flow([action,branch,{kind:'end',id:'never-after'}]));
  const result=simulateAutomationPlan(plan,{outcomes:{send:'UNKNOWN'}});expect(result.status).toBe('UNKNOWN');expect(result.steps.some(step=>step.blockId==='remember')).toBe(true);expect(result.steps.some(step=>step.blockId==='never-after')).toBe(false);
});
it('counts generic type arguments toward the shared type nesting budget',()=>{
  let nested:ValueType='Number';for(let i=0;i<10;i++)nested={kind:'Record',schemaId:'nexus.pair.v1',typeArgs:[nested,'Number']};
  expect(validateFlowDefinition(flow([{kind:'declare',id:'deep',variable:{id:'deep',name:'Deep',type:nested},value:{kind:'missing',type:nested}}])).valid).toBe(false);
});
