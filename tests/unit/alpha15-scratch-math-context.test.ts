import {beforeAll,describe,expect,it} from 'vitest';
import {compileFlowDefinition,validateFlowDefinition} from '../../packages/automation/src/definition';
import {evaluateValue} from '../../packages/automation/src/expression';
import {scratchNumericOptions} from '../../packages/automation/src/scratch-math-server';
import {simulateAutomationPlan} from '../../packages/automation/src/simulation';
import {SCRATCH_TRANSCENDENTAL_WORK,type ScratchMathEvaluator} from '../../packages/automation/src/scratch-numeric';
import type {EvaluationContext,FlowDefinition,ValueInput} from '../../packages/automation/src/types';

const guildId='884000000000000001';
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const variable=(variableId:string):ValueInput=>({kind:'variable',type:'Number',variableId});
const math=(operator:'sin'|'ln',input:ValueInput):ValueInput=>({kind:'expression',type:'Number',expression:{operator:'number.math',args:[input],options:{mathFunction:operator}}});
const flow=(value:ValueInput):FlowDefinition=>({schemaVersion:1,semanticProfile:'scratch.v1',id:'math-context',guildId,name:'Synthetic math context',trigger:{kind:'manual',inputs:[]},variables:[],body:[{kind:'declare',id:'answer.declare',variable:{id:'answer',name:'Answer',type:'Number'},value},{kind:'wait',id:'wait',duration:{kind:'literal',type:'Duration',value:1}}]});
let numeric:{numericMath?:ScratchMathEvaluator};
beforeAll(async()=>{numeric=await scratchNumericOptions(flow(number(0)));});
const context=():EvaluationContext=>({guildId,semanticProfile:'scratch.v1',variables:{},...numeric});

describe('server mathematical capability and shared resource boundaries',()=>{
  it('requires the actual engine for constant folding while allowing explicit browser deferral',()=>{
    const definition=flow(math('sin',number(30)));
    expect(validateFlowDefinition(definition).issues.some(issue=>issue.code==='NumericEngineUnavailable')).toBe(true);
    expect(validateFlowDefinition(definition,{deferNumericEngine:true}).valid).toBe(true);
    expect(validateFlowDefinition(definition,numeric).valid).toBe(true);
    const invalid=flow(math('ln',number(0)));
    expect(validateFlowDefinition(invalid,{...numeric,deferNumericEngine:true}).issues.some(issue=>issue.code==='DomainError')).toBe(true);
  });
  it('reserves the shared work before calling an engine, including failed expressions',()=>{
    let calls=0;
    const numericMath:ScratchMathEvaluator=()=>{calls++;return 0.5;};
    const budget={evaluations:0},input=math('sin',number(30));
    expect(()=>evaluateValue(input,{...context(),numericMath,budget,limits:{maxEvaluations:SCRATCH_TRANSCENDENTAL_WORK+1}})).toThrowError(expect.objectContaining({code:'EVALUATION_BUDGET'}));
    expect(calls).toBe(0);
    expect(budget.evaluations).toBe(SCRATCH_TRANSCENDENTAL_WORK+2);
    const accepted={evaluations:0};
    expect(evaluateValue(input,{...context(),numericMath,budget:accepted,limits:{maxEvaluations:SCRATCH_TRANSCENDENTAL_WORK+2}}).value).toBe(0.5);
    expect(calls).toBe(1);
    expect(accepted.evaluations).toBe(SCRATCH_TRANSCENDENTAL_WORK+2);
  });
  it('shares the same capability and budget through a pure definition and list binding',()=>{
    const pure={id:'sine',revision:1,name:'Sine',inputs:[{id:'angle',name:'Angle',type:'Number' as const}],outputType:'Number' as const,value:math('sin',variable('angle'))};
    const input:ValueInput={kind:'expression',type:{kind:'List',element:'Number'},expression:{operator:'list.map',args:[{kind:'literal',type:{kind:'List',element:'Number'},value:[30,90]}],options:{bindingId:'angle.item',body:{kind:'expression',type:'Number',expression:{operator:'pure.call',args:[variable('angle.item')],options:{definitionId:'sine',revision:1}}}}}};
    const budget={evaluations:0};
    expect(evaluateValue(input,{...context(),budget,pureDefinitions:[pure]}).value).toEqual([0.5,1]);
    expect(budget.evaluations).toBeGreaterThanOrEqual(2*SCRATCH_TRANSCENDENTAL_WORK);
  });
  it('keeps an unused invalid mathematical branch lazy',()=>{
    const input:ValueInput={kind:'expression',type:'Number',expression:{operator:'value.choose',args:[{kind:'literal',type:'Boolean',value:true},number(7),math('ln',number(0))]}};
    expect(evaluateValue(input,context()).value).toBe(7);
  });
  it('passes the capability to simulation without serializing it into the plan or changing its hash',()=>{
    const definition=flow(math('sin',number(30))),plan=compileFlowDefinition(definition,numeric);
    expect(compileFlowDefinition(definition,{deferNumericEngine:true}).semanticHash).toBe(plan.semanticHash);
    const result=simulateAutomationPlan(plan,{inspectVariables:['answer']},'2026-10-15T00:00:00.000Z',numeric);
    expect(result.status).toBe('COMPLETED');
    expect(result.inspection?.values).toEqual([{variableId:'answer',type:'Number',value:0.5,blockId:'wait'}]);
    const serialized=JSON.stringify(plan);
    expect(serialized).not.toContain('numericMath');
    expect(serialized).not.toContain('binding');
    expect(JSON.parse(serialized).definition).toEqual(definition);
  });
  it('keeps legacy initialization free of the new capability',async()=>{
    const legacy=flow(number(0));delete legacy.semanticProfile;
    expect(await scratchNumericOptions(legacy)).toEqual({});
    expect(await scratchNumericOptions(null)).toEqual({});
  });
});
