import { describe, expect, it } from 'vitest';
import { compileFlowDefinition, validateFlowDefinition } from '../../packages/automation/src/definition';
import { simulateAutomationPlan } from '../../packages/automation/src/simulation';
import type { FlowDefinition, Statement, ValueInput } from '../../packages/automation/src/types';

const guild='884000000000000001',clock='2026-10-15T00:00:00.000Z';
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const truth=(value:boolean):ValueInput=>({kind:'literal',type:'Boolean',value});
const condition=(value:'true'|'false'|'unknown'):ValueInput=>({kind:'literal',type:'ConditionResult',value});
const variable=(variableId:string):ValueInput=>({kind:'variable',type:'Number',variableId});
const marker=(id:string):Statement=>({kind:'declare',id,variable:{id:id+'.value',name:id,type:'Number'},value:number(1)});
const add=(id:string,value=1):Statement=>({kind:'assign',id,variableId:'counter',value:{kind:'expression',type:'Number',expression:{operator:'number.add',args:[variable('counter'),number(value)]}}});
const flow=(body:Statement[]):FlowDefinition=>({schemaVersion:1,semanticProfile:'scratch.v1',id:'scratch-simulation',guildId:guild,name:'Synthetic Scratch simulation',trigger:{kind:'manual',inputs:[]},variables:[],body});
const loop=(changes:Partial<Extract<Statement,{kind:'boundedLoop'}>>={}):Extract<Statement,{kind:'boundedLoop'}>=>({kind:'boundedLoop',semanticVersion:1,id:'loop',mode:'until',maxBody:number(3),condition:truth(false),until:{kind:'literal',type:'Instant',value:'2026-10-15T01:00:00.000Z'},body:[marker('body')],handlers:{limit:[marker('limit')],conditionUnknown:[marker('unknown')],evaluationError:[marker('evaluation-error')],localDeadline:[marker('deadline')]},...changes});
const plan=(body:Statement[])=>compileFlowDefinition(flow(body));
const simulate=(body:Statement[])=>simulateAutomationPlan(plan(body),{},clock);
const seen=(result:ReturnType<typeof simulate>,id:string)=>result.steps.filter(step=>step.blockId===id&&step.kind==='declare').length;

describe('Scratch simulation shares the bounded control contract',()=>{
  it.each([[true,true,'first'],[false,true,'second'],[false,false,'otherwise']] as const)('T033-T035 selects only the first matching clause (%s/%s)',(first,second,selected)=>{
    const result=simulate([{kind:'branch',id:'first-clause',condition:truth(first),then:[marker('first')],unknown:[],otherwise:[{kind:'branch',id:'second-clause',condition:truth(second),then:[marker('second')],unknown:[],otherwise:[marker('otherwise')]}]},marker('after')]);
    expect(result.status).toBe('COMPLETED');for(const id of ['first','second','otherwise'])expect(seen(result,id)).toBe(id===selected?1:0);expect(seen(result,'after')).toBe(1);
    if(first)expect(result.steps.some(step=>step.blockId==='second-clause')).toBe(false);
  });
  it('T036 keeps a false statement branch with no else as an ordinary empty continuation',()=>{
    const result=simulate([{kind:'branch',id:'branch',condition:truth(false),then:[marker('never')],unknown:[],otherwise:[]},marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(seen(result,'never')).toBe(0);expect(seen(result,'after')).toBe(1);
  });
  it('S025 keeps B unknown selected through a Wait and never evaluates C or else',()=>{
    const result=simulate([{kind:'branch',id:'A',condition:condition('false'),then:[marker('A-value')],unknown:[],otherwise:[{kind:'branch',id:'B',condition:condition('unknown'),then:[marker('B-value')],unknown:[{kind:'wait',id:'unknown-wait',duration:{kind:'literal',type:'Duration',value:10}},marker('unknown-value')],otherwise:[{kind:'branch',id:'C',condition:condition('true'),then:[marker('C-value')],unknown:[],otherwise:[marker('else-value')]}]}]},marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(seen(result,'unknown-value')).toBe(1);expect(result.steps.some(step=>step.blockId==='C')).toBe(false);expect(seen(result,'else-value')).toBe(0);expect(seen(result,'after')).toBe(1);
  });
  it('S013 statically rejects external read/write, Wait and random in local-deadline handlers',()=>{
    const effects:Statement[]=[
      {kind:'action',id:'write',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:'884222222222222222',guildId:guild}},content:{kind:'literal',type:'PlainText',value:'Synthetic no send'}}},
      {kind:'action',id:'read',operation:'nexus.readTicket',inputs:{ticket:{kind:'literal',type:'TicketRef',value:{id:'intake:12345678-1234-1234-1234-123456789abc',guildId:guild}}}},
      {kind:'wait',id:'wait',duration:{kind:'literal',type:'Duration',value:1}},
      {kind:'random',id:'draw',mode:'integer',min:number(1),max:number(3),output:{id:'draw-value',name:'Draw',type:'Number'}},
    ];
    for(const effect of effects){const definition=flow([loop({handlers:{localDeadline:[effect]}})]);definition.targets={channelIds:['884222222222222222'],roleIds:[],parentCategoryIds:[]};expect(validateFlowDefinition(definition).issues.some(issue=>issue.code==='LOCAL_DEADLINE_EFFECT')).toBe(true);}
  });
  it('S001 evaluates a zero-bound successful until guard once and continues',()=>{
    const result=simulate([loop({maxBody:number(0),condition:truth(true)}),marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(result.loops).toMatchObject([{guardEvaluations:1,completedIterations:0,reason:'condition_satisfied'}]);
    expect(seen(result,'body')).toBe(0);expect(seen(result,'after')).toBe(1);
  });
  it('S002 makes the zero-bound limit handler a non-success terminal region',()=>{
    const result=simulate([loop({maxBody:number(0)}),marker('after')]);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('limit_reached');expect(result.loops).toMatchObject([{guardEvaluations:1,completedIterations:0,handler:'limit'}]);
    expect(seen(result,'limit')).toBe(1);expect(seen(result,'after')).toBe(0);
  });
  it.each([false,true])('S003 keeps while zero-bound polarity explicit: %s',(value)=>{
    const result=simulate([loop({mode:'while',maxBody:number(0),condition:truth(value)}),marker('after')]);
    expect(result.status).toBe(value?'FAILED':'COMPLETED');expect(seen(result,'after')).toBe(value?0:1);expect(result.loops?.[0]?.guardEvaluations).toBe(1);
  });
  it('S004 runs the final guard after N completed bodies before deciding success',()=>{
    const counter:Statement={kind:'declare',id:'counter.declare',variable:{id:'counter',name:'Counter',type:'Number'},value:number(0)};
    const test:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.greaterOrEqual',args:[variable('counter'),number(3)]}};
    const result=simulate([counter,loop({condition:test,body:[add('increment')]}),marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(result.loops).toMatchObject([{completedIterations:3,guardEvaluations:4,reason:'condition_satisfied'}]);expect(seen(result,'limit')).toBe(0);expect(seen(result,'after')).toBe(1);
  });
  it('S005 uses N bodies and N+1 guards when the condition never completes',()=>{
    const result=simulate([loop(),marker('after')]);
    expect(result.loops).toMatchObject([{completedIterations:3,guardEvaluations:4,reason:'limit_reached'}]);expect(seen(result,'body')).toBe(3);expect(seen(result,'limit')).toBe(1);expect(seen(result,'after')).toBe(0);
  });
  it.each(['literal','variable','expression','pure'] as const)('freezes a %s maximum at entry while the original Run value changes',(kind)=>{
    const maxBody:ValueInput=kind==='literal'?number(3):kind==='variable'?variable('bound'):kind==='expression'?{kind:'expression',type:'Number',expression:{operator:'number.add',args:[variable('bound'),number(0)]}}:{kind:'expression',type:'Number',expression:{operator:'pure.call',args:[variable('bound')],options:{definitionId:'limit-value',revision:1}}};
    const definition=flow([{kind:'declare',id:'bound.declare',variable:{id:'bound',name:'Bound',type:'Number'},value:number(3)},loop({maxBody,body:[{kind:'assign',id:'change-bound',variableId:'bound',value:number(0)},marker('body')]}),marker('after')]);
    definition.pureDefinitions=[{id:'limit-value',revision:1,name:'Limit value',inputs:[{id:'amount',name:'Amount',type:'Number'}],outputType:'Number',value:variable('amount')}];
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{},clock);
    expect(result.status).toBe('FAILED');expect(result.loops).toMatchObject([{completedIterations:3,guardEvaluations:4,reason:'limit_reached'}]);expect(seen(result,'body')).toBe(3);expect(seen(result,'after')).toBe(0);
  });
  it('S006 keeps a condition unknown handler distinct from false and ordinary continuation',()=>{
    const result=simulate([loop({condition:condition('unknown')}),marker('after')]);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('condition_unknown');expect(seen(result,'body')).toBe(0);expect(seen(result,'unknown')).toBe(1);expect(seen(result,'limit')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('S007 selects evaluationError for a dynamic guard division failure',()=>{
    const definition=flow([loop({condition:{kind:'expression',type:'Boolean',expression:{operator:'compare.greater',args:[{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[number(1),variable('divisor')]}},number(0)]}}}),marker('after')]);
    definition.trigger={kind:'manual',inputs:[{id:'divisor',name:'Divisor',type:'Number'}]};
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{values:{divisor:{type:'Number',value:0}}},clock);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('evaluation_failed');expect(seen(result,'evaluation-error')).toBe(1);expect(seen(result,'unknown')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('S008 keeps break normal but counts continue and skips the remaining body',()=>{
    const broken=simulate([loop({body:[{kind:'break',id:'break'}]}),marker('after')]);
    expect(broken.status).toBe('COMPLETED');expect(broken.loops?.[0]?.reason).toBe('broken');expect(seen(broken,'after')).toBe(1);
    const continued=simulate([loop({body:[{kind:'branch',id:'continue-choice',condition:truth(true),then:[{kind:'continue',id:'continue'}],otherwise:[],unknown:[]},marker('never')]}),marker('after')]);
    expect(continued.loops).toMatchObject([{completedIterations:3,guardEvaluations:4,reason:'limit_reached'}]);expect(seen(continued,'never')).toBe(0);expect(seen(continued,'after')).toBe(0);
  });
  it('S009 a legitimate procedure Return skips its loop continuation and returns to the call',()=>{
    const definition=flow([{kind:'call',id:'call',procedureId:'procedure',revision:1,args:{},outputs:{}},marker('after-call')]);
    definition.procedures=[{id:'procedure',revision:1,name:'Synthetic procedure',inputs:[],outputs:[],body:[loop({id:'procedure-loop',body:[{kind:'return',id:'return',values:{}}]}),marker('after-loop'),{kind:'return',id:'fallback-return',values:{}}]}];
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{},clock);
    expect(result.status).toBe('COMPLETED');expect(result.loops?.[0]?.reason).toBe('returned');expect(seen(result,'after-loop')).toBe(0);expect(seen(result,'after-call')).toBe(1);
  });
  it('S014 chooses the outer owner on equal nested local deadlines',()=>{
    const until:ValueInput={kind:'literal',type:'Instant',value:'2026-10-15T00:00:05.000Z'};
    const inner=loop({id:'inner',until,body:[{kind:'wait',id:'pause',duration:{kind:'literal',type:'Duration',value:5}}],handlers:{localDeadline:[marker('inner-deadline')]}});
    const result=simulate([loop({until,body:[inner],handlers:{localDeadline:[marker('outer-deadline')]}}),marker('after')]);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('local_deadline');expect(seen(result,'outer-deadline')).toBe(1);expect(seen(result,'inner-deadline')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('S015 gives the Run deadline priority over local handlers at the same wake time',()=>{
    const until:ValueInput={kind:'literal',type:'Instant',value:'2026-10-22T00:00:00.000Z'};
    const result=simulate([loop({until,body:[{kind:'wait',id:'pause',duration:{kind:'literal',type:'Duration',value:604800}}]}),marker('after')]);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('deadline_expired');expect(seen(result,'deadline')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('keeps a caller loop deadline when a child procedure reaches its wake time',()=>{
    const until:ValueInput={kind:'literal',type:'Instant',value:'2026-10-15T00:00:05.000Z'};
    const definition=flow([loop({until,body:[{kind:'call',id:'call',procedureId:'child',revision:1,args:{},outputs:{}}]}),marker('after')]);
    definition.procedures=[{id:'child',revision:1,name:'Synthetic child',inputs:[],outputs:[],body:[{kind:'wait',id:'child-wait',duration:{kind:'literal',type:'Duration',value:5}},{kind:'return',id:'child-return',values:{}}]}];
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{},clock);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('local_deadline');expect(seen(result,'deadline')).toBe(1);expect(result.steps.some(step=>step.blockId==='child-return')).toBe(false);expect(seen(result,'after')).toBe(0);
  });
  it('T117 rejects a wait past the innermost effective local deadline',()=>{
    const until:ValueInput={kind:'literal',type:'Instant',value:'2026-10-15T00:00:05.000Z'};
    const result=simulate([loop({until,body:[{kind:'wait',id:'invalid-wait',duration:{kind:'literal',type:'Duration',value:6}}]}),marker('after')]);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('evaluation_failed');expect(seen(result,'evaluation-error')).toBe(1);expect(seen(result,'after')).toBe(0);
  });
  it('rejects a local loop deadline after the immutable seven-day Run deadline',()=>{
    const result=simulate([loop({until:{kind:'literal',type:'Instant',value:'2026-10-22T00:00:01.000Z'}})]);
    expect(result.status).toBe('FAILED');expect(result.steps.at(-1)?.code).toBe('SIMULATION_LOOP_DEADLINE');expect(seen(result,'body')).toBe(0);
  });
  it('S016 a global step budget stops the handler rather than invoking another handler',()=>{
    const compiled=structuredClone(plan([loop({maxBody:number(0)}),marker('after')]));compiled.limits.maxExpandedSteps=2;
    const result=simulateAutomationPlan(compiled,{},clock);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('budget_exhausted');expect(seen(result,'limit')).toBe(0);expect(seen(result,'evaluation-error')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('S018 preserves the selected failure when its handler itself fails',()=>{
    const definition=flow([loop({maxBody:number(0),handlers:{limit:[{kind:'assign',id:'failed-handler',variableId:'target',value:{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[number(1),variable('divisor')]}}}],evaluationError:[marker('recursive-handler')]}}),marker('after')]);
    definition.trigger={kind:'manual',inputs:[{id:'divisor',name:'Divisor',type:'Number'}]};definition.body.unshift({kind:'declare',id:'target.declare',variable:{id:'target',name:'Target',type:'Number'},value:number(0)});
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{values:{divisor:{type:'Number',value:0}}},clock);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('limit_reached');expect(result.loops?.[0]?.handlerFailed).toBe(true);expect(seen(result,'recursive-handler')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('propagates the selected semantic profile into the production value evaluator',()=>{
    const length:ValueInput={kind:'expression',type:'Number',expression:{operator:'text.length',args:[{kind:'literal',type:'PlainText',value:'e\u0301'}]}};
    const result=simulate([loop({maxBody:number(0),condition:{kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[length,number(1)]}}}),marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(seen(result,'after')).toBe(1);
  });
  it('rejects unsupported statement kinds instead of silently simulating success',()=>{
    const compiled=structuredClone(plan([]));(compiled.definition.body as unknown[]).push({kind:'futureUnsupported',id:'unsupported'});
    const result=simulateAutomationPlan(compiled,{},clock);
    expect(result.status).toBe('FAILED');expect(result.steps.at(-1)?.code).toBe('SIMULATION_STATEMENT_UNSUPPORTED');
  });
  it('T120 unwraps only a found index and removes the branch binding afterward',()=>{
    const text:ValueInput={kind:'expression',type:{kind:'Record',schemaId:'nexus.index-result.v1'},expression:{operator:'text.find',args:[{kind:'literal',type:'PlainText',value:'abc'},{kind:'literal',type:'PlainText',value:'b'}]}};
    const found:Statement={kind:'searchBranch',id:'search',value:text,index:{id:'position',name:'Position',type:'Number'},found:[{kind:'assign',id:'assign-index',variableId:'counter',value:variable('position')}],notFound:[]};
    const result=simulate([{kind:'declare',id:'counter.declare',variable:{id:'counter',name:'Counter',type:'Number'},value:number(0)},found,loop({maxBody:number(0),condition:{kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[variable('counter'),number(2)]}}}),marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(result.steps.find(step=>step.blockId==='search')?.state).toBe('SEARCH_FOUND');expect(seen(result,'after')).toBe(1);
  });
  it('keeps not_found distinct from a fabricated zero index',()=>{
    const text:ValueInput={kind:'expression',type:{kind:'Record',schemaId:'nexus.index-result.v1'},expression:{operator:'text.find',args:[{kind:'literal',type:'PlainText',value:'abc'},{kind:'literal',type:'PlainText',value:'x'}]}};
    const result=simulate([{kind:'searchBranch',id:'search',value:text,index:{id:'position',name:'Position',type:'Number'},found:[marker('found')],notFound:[marker('not-found')]},marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(result.steps.find(step=>step.blockId==='search')?.state).toBe('SEARCH_NOT_FOUND');expect(seen(result,'found')).toBe(0);expect(seen(result,'not-found')).toBe(1);expect(seen(result,'after')).toBe(1);
  });
  it('shows an explicit deterministic decimal draw without consuming production entropy',()=>{
    const result=simulate([{kind:'random',id:'decimal',mode:'decimal',min:number(-Number.MAX_VALUE),max:number(Number.MAX_VALUE),output:{id:'draw',name:'Draw',type:'Number'}},marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(result.steps.find(step=>step.blockId==='decimal')?.state).toBe('MOCK_DRAW');expect(result.productionDraws).toBe(0);expect(result.externalChanges).toBe(0);
  });
  it('T111 endBranch closes one parallel branch with its declared outputs and joins the others',()=>{
    const result=simulate([{kind:'declare',id:'counter.declare',variable:{id:'counter',name:'Counter',type:'Number'},value:number(0)},{kind:'parallel',id:'parallel',branches:[
      {id:'first',name:'First',body:[{kind:'declare',id:'answer.declare',variable:{id:'answer',name:'Answer',type:'Number'},value:number(7)},{kind:'endBranch',semanticVersion:1,id:'end-branch'}],outputs:{answer:variable('answer')}},
      {id:'second',name:'Second',body:[marker('other-branch')]},
    ],outputs:{counter:{branchId:'first',outputId:'answer'}}},loop({maxBody:number(0),condition:{kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[variable('counter'),number(7)]}}}),marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(seen(result,'other-branch')).toBe(1);expect(seen(result,'after')).toBe(1);
  });
  it('T111 endRun inside a parallel branch stops siblings and the common continuation',()=>{
    const result=simulate([{kind:'parallel',id:'parallel',branches:[{id:'first',name:'First',body:[{kind:'endRun',semanticVersion:1,id:'end-run'}]},{id:'second',name:'Second',body:[marker('other-branch')]}]},marker('after')]);
    expect(result.status).toBe('COMPLETED');expect(seen(result,'other-branch')).toBe(0);expect(seen(result,'after')).toBe(0);
  });
  it('T111 endRun inside a child stops the Run rather than returning a successful procedure result',()=>{
    const definition=flow([{kind:'call',id:'call',procedureId:'child',revision:1,args:{},outputs:{}},marker('after')]);
    definition.procedures=[{id:'child',revision:1,name:'Child',inputs:[],outputs:[],body:[{kind:'endRun',semanticVersion:1,id:'end-run'}]}];
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{},clock);
    expect(result.status).toBe('COMPLETED');expect(seen(result,'after')).toBe(0);
  });
  it('keeps a terminal handler unsuccessful even if it explicitly ends the Run',()=>{
    const result=simulate([loop({maxBody:number(0),handlers:{limit:[{kind:'endRun',semanticVersion:1,id:'handler-end'}]}}),marker('after')]);
    expect(result.status).toBe('FAILED');expect(result.terminalReason).toBe('limit_reached');expect(seen(result,'after')).toBe(0);
  });
  it('T080/T113 returns only explicitly selected response-only trial variables with their types',()=>{
    const definition=flow([{kind:'declare',id:'visible.declare',variable:{id:'visible',name:'Visible',type:{kind:'List',element:'PlainText'}},value:{kind:'literal',type:{kind:'List',element:'PlainText'},value:['A','A','B']}},{kind:'declare',id:'unselected.declare',variable:{id:'unselected',name:'Unselected',type:'PlainText'},value:{kind:'literal',type:'PlainText',value:'synthetic unselected contents'}}]);
    const compiled=compileFlowDefinition(definition),before=JSON.stringify(compiled);
    expect(simulateAutomationPlan(compiled,{},clock)).not.toHaveProperty('inspection');
    expect(simulateAutomationPlan(compiled,{inspectVariables:[]},clock)).not.toHaveProperty('inspection');
    const result=simulateAutomationPlan(compiled,{inspectVariables:['visible','absent','constructor']},clock);
    expect(result.status).toBe('COMPLETED');expect(result.inspection).toEqual({mode:'SIMULATION_ONLY',values:[{variableId:'visible',type:{kind:'List',element:'PlainText'},value:['A','A','B'],blockId:'unselected.declare'}],unavailable:['absent','constructor']});
    expect(JSON.stringify(result)).not.toContain('synthetic unselected contents');expect(JSON.stringify(result.steps)).not.toContain('A","A","B');expect(JSON.stringify(compiled)).toBe(before);
    expect(result).toMatchObject({externalChanges:0,productionRuns:0,productionDraws:0});
  });
  it('inspect response values are detached from the definition and do not leak into the next trial',()=>{
    const compiled=plan([{kind:'declare',id:'value.declare',variable:{id:'value',name:'Value',type:{kind:'List',element:'Number'}},value:{kind:'literal',type:{kind:'List',element:'Number'},value:[1,2]}}]);
    const inspected=simulateAutomationPlan(compiled,{inspectVariables:['value']},clock);
    (inspected.inspection!.values[0]!.value as number[]).push(3);
    expect(simulateAutomationPlan(compiled,{inspectVariables:['value']},clock).inspection?.values[0]?.value).toEqual([1,2]);
    expect(simulateAutomationPlan(compiled,{},clock)).not.toHaveProperty('inspection');
  });
  it('rejects duplicate/oversized inspection requests and bounds the total response before copying',()=>{
    const compiled=plan([{kind:'declare',id:'value.declare',variable:{id:'value',name:'Value',type:'PlainText'},value:{kind:'literal',type:'PlainText',value:'synthetic inspection capacity'}}]);
    expect(simulateAutomationPlan(compiled,{inspectVariables:['value','value']},clock).steps.at(-1)?.code).toBe('SIMULATION_INSPECTION_REQUEST');
    const countBound=structuredClone(compiled);countBound.limits.maxVariables=1;
    expect(simulateAutomationPlan(countBound,{inspectVariables:['value','other']},clock).steps.at(-1)?.code).toBe('SIMULATION_INSPECTION_REQUEST');
    const bytesBound=structuredClone(compiled);bytesBound.limits.maxValueBytes=80;
    const result=simulateAutomationPlan(bytesBound,{inspectVariables:['value']},clock);
    expect(result.status).toBe('FAILED');expect(result.steps.at(-1)?.code).toBe('SIMULATION_INSPECTION_LIMIT');expect(result.inspection?.values).toEqual([]);
  });
});
