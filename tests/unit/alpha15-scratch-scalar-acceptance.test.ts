import { describe, expect, it } from 'vitest';
import { compileFlowDefinition, validateFlowDefinition } from '../../packages/automation/src/definition';
import { evaluateValue } from '../../packages/automation/src/expression';
import { simulateAutomationPlan } from '../../packages/automation/src/simulation';
import { decimalFrom53Bits, evaluateRandomTape, planRandomTape, prepareRandomTape } from '../../packages/automation/src/scratch-random';
import type { EvaluationContext, Expression, FlowDefinition, JsonValue, PureDefinition, Statement, ValueInput, ValueType } from '../../packages/automation/src/types';

const guild='887111111111111111';
const literal=(type:ValueType,value:JsonValue):ValueInput=>({kind:'literal',type,value});
const n=(value:number)=>literal('Number',value);
const text=(value:string)=>literal('PlainText',value);
const variable=(id:string,type:ValueType='Number'):ValueInput=>({kind:'variable',type,variableId:id});
const expression=(type:ValueType,operator:Expression['operator'],args:ValueInput[],options?:Expression['options']):ValueInput=>({kind:'expression',type,expression:{operator,args,...(options?{options}:{})}});
const env:EvaluationContext={guildId:guild,semanticProfile:'scratch.v1',variables:{}};
const evaluate=(input:ValueInput,extra:Partial<EvaluationContext>={})=>evaluateValue(input,{...env,...extra}).value;
const flow=(body:Statement[]):FlowDefinition=>({schemaVersion:1,semanticProfile:'scratch.v1',id:'scalar-acceptance',guildId:guild,name:'Synthetic scalar acceptance',trigger:{kind:'manual',inputs:[]},variables:[],body});
const declare=(id:string,value:ValueInput):Statement=>({kind:'declare',id,variable:{id:id+'.value',name:id,type:value.type},value});
const assign=(id:string,variableId:string,value:ValueInput):Statement=>({kind:'assign',id,variableId,value});
const add=(id:string,variableId:string,value=1):Statement=>assign(id,variableId,expression('Number','number.add',[variable(variableId),n(value)]));
const repeat=(id:string,count:ValueInput,body:Statement[]):Statement=>({kind:'repeat',id,count,itemVariable:{id:id+'.item',name:'Iteration',type:'Number'},body});
const inspected=(definition:FlowDefinition,ids:string[],values?:Record<string,{type:ValueType;value:JsonValue}>)=>simulateAutomationPlan(compileFlowDefinition(definition),{inspectVariables:ids,...(values?{values}:{})},'2026-10-15T00:00:00Z');
const valueOf=(result:ReturnType<typeof inspected>,id:string)=>result.inspection?.values.find(value=>value.variableId===id)?.value;
const pureCall=(id:string,args:ValueInput[]=[],revision=1)=>expression('Number','pure.call',args,{definitionId:id,revision});
const pure=(id:string,value:ValueInput,inputs:PureDefinition['inputs']=[]):PureDefinition=>({id,revision:1,name:id,inputs,outputType:'Number',value});

describe('Exact scalar, initialization and control acceptance',()=>{
  it('T002 rejects direct PlainText 12 in a Number socket and converts only through EX11',()=>{
    expect(()=>evaluate(expression('Number','number.add',[text('12'),n(0)]))).toThrow();
    const parsed=expression({kind:'ParseResult',value:'Number'},'value.parse',[text('12')],{conversion:'decimal'});
    expect(evaluate(parsed)).toEqual({state:'SUCCEEDED',value:12});
    expect(validateFlowDefinition(flow([{...declare('number',text('12')),variable:{id:'number.value',name:'Number',type:'Number'}} as Statement])).valid).toBe(false);
  });
  it.each(['',' ','12abc','NaN','Infinity'])('T003 keeps invalid EX11 decimal %j a failed ParseResult rather than zero',source=>{
    expect(evaluate(expression({kind:'ParseResult',value:'Number'},'value.parse',[text(source)],{conversion:'decimal'}))).toEqual({state:'FAILED',reason:'PARSE_NUMBER_FORMAT'});
  });
  it('T005 rejects 1/0, 0/0 and dynamic d=0 before applying a later mutation',()=>{
    for(const numerator of [1,0])expect(()=>evaluate(expression('Number','number.divide',[n(numerator),n(0)]))).toThrowError(expect.objectContaining({code:'DIVIDE_BY_ZERO'}));
    const definition=flow([declare('counter',n(5)),assign('failed','counter.value',expression('Number','number.divide',[n(1),variable('d')])),assign('never','counter.value',n(99))]);
    definition.trigger={kind:'manual',inputs:[{id:'d',name:'Divisor',type:'Number'}]};
    const result=inspected(definition,['counter.value'],{d:{type:'Number',value:0}});
    expect(result.status).toBe('FAILED');expect(valueOf(result,'counter.value')).toBe(5);expect(result.steps.some(step=>step.blockId==='never')).toBe(false);
  });
  it('T006 reports maximum-finite multiplication overflow and reaches no external send',()=>{
    expect(()=>evaluate(expression('Number','number.multiply',[n(Number.MAX_VALUE),n(2)]))).toThrowError(expect.objectContaining({code:'NumericOverflow'}));
    const definition=flow([declare('overflow',expression('Number','number.multiply',[variable('amount'),n(2)])),{kind:'action',id:'never-send',operation:'discord.sendMessage',inputs:{channel:literal('ChannelRef',{id:'887222222222222222',guildId:guild}),content:text('Synthetic no send')}}]);
    definition.trigger={kind:'manual',inputs:[{id:'amount',name:'Amount',type:'Number'}]};
    definition.targets={channelIds:['887222222222222222'],roleIds:[],parentCategoryIds:[]};
    const result=simulateAutomationPlan(compileFlowDefinition(definition),{outcomes:{'never-send':'SUCCEEDED'},values:{amount:{type:'Number',value:Number.MAX_VALUE}}});
    expect(result.status).toBe('FAILED');expect(result.plannedActions).toBe(0);expect(result.externalChanges).toBe(0);expect(result.steps.some(step=>step.blockId==='never-send')).toBe(false);
  });
  it.each([2.5,-1,2**53])('T007 refuses count %s as a nonnegative safe integer without rounding',count=>{
    const result=validateFlowDefinition(flow([repeat('repeat',n(count),[])]));
    expect(result.valid).toBe(false);expect(result.issues.some(issue=>issue.code==='COUNT')).toBe(true);expect(result.plan).toBeUndefined();
  });
  it('T009 computes 3<4, 3=3 and 4>3 as strict true Boolean values',()=>{
    for(const [op,a,b] of [['compare.less',3,4],['compare.equal',3,3],['compare.greater',4,3]] as const)expect(evaluate(expression('Boolean',op,[n(a),n(b)]))).toBe(true);
  });
  it('T011 compares different ChannelRef IDs independently of identical declaration display names',()=>{
    const definition=flow([declare('first',literal('ChannelRef',{id:'887222222222222222',guildId:guild})),declare('second',literal('ChannelRef',{id:'887333333333333333',guildId:guild})),declare('same',expression('Boolean','compare.equal',[variable('first.value','ChannelRef'),variable('second.value','ChannelRef')]))]);
    for(const statement of definition.body.slice(0,2))if(statement.kind==='declare')statement.variable.name='Same display name';
    const result=inspected(definition,['same.value','first.value','second.value']);
    expect(result.status).toBe('COMPLETED');expect(valueOf(result,'same.value')).toBe(false);
    expect(valueOf(result,'first.value')).toEqual({id:'887222222222222222',guildId:guild});expect(valueOf(result,'second.value')).toEqual({id:'887333333333333333',guildId:guild});
  });
  it('T029 rejects unknown opcode and math selection in saved JSON rather than executing zero',()=>{
    for(const value of [expression('Number','unregistered.operator' as Expression['operator'],[]),expression('Number','number.math',[n(1)],{mathFunction:'unregistered.math' as NonNullable<Expression['options']>['mathFunction']})]){
      const result=validateFlowDefinition(JSON.parse(JSON.stringify(flow([declare('bad',value)]))))
      expect(result.valid).toBe(false);expect(result.plan).toBeUndefined();expect(result.issues.some(issue=>issue.severity==='error')).toBe(true);
    }
  });
  it('T030 explicitly clamps 5 to [0,3] and rejects reversed [3,0]',()=>{
    expect(evaluate(expression('Number','number.clamp',[n(5),n(0),n(3)]))).toBe(3);
    expect(()=>evaluate(expression('Number','number.clamp',[n(5),n(3),n(0)]))).toThrowError(expect.objectContaining({code:'CLAMP_RANGE'}));
  });
  it('T013 rejects the exact 7 mod 0 input without returning zero or nonfinite values',()=>{
    expect(()=>evaluate(expression('Number','number.modulo',[n(7),n(0)]))).toThrow();
  });
  it('T014/T130 distinguish all three signed half cases for both explicit integer rounding modes',()=>{
    for(const [input,scratch,away] of [[1.5,2,2],[-1.5,-1,-2],[-0.5,0,-1]] as const){
      expect(evaluate(expression('Number','number.roundInteger',[n(input)],{roundingMode:'tiesTowardPositiveInfinity'}))).toBe(scratch);
      expect(evaluate(expression('Number','number.roundInteger',[n(input)],{roundingMode:'tiesAwayFromZero'}))).toBe(away);
    }
    expect(Object.is(evaluate(expression('Number','number.roundInteger',[n(-0.5)],{roundingMode:'tiesTowardPositiveInfinity'})),0)).toBe(true);
  });
  it('T016 computes floor(-1.2), ceiling(-1.2) and truncate(-1.2) as distinct typed operations',()=>{
    expect(evaluate(expression('Number','number.floor',[n(-1.2)]))).toBe(-2);
    expect(evaluate(expression('Number','number.ceil',[n(-1.2)]))).toBe(-1);
    expect(evaluate(expression('Number','number.truncate',[n(-1.2)]))).toBe(-1);
  });
  it('T017 evaluates abs(-4) as four through both registered absolute-value forms',()=>{
    expect(evaluate(expression('Number','number.abs',[n(-4)]))).toBe(4);
    expect(evaluate(expression('Number','number.math',[n(-4)],{mathFunction:'abs'}))).toBe(4);
  });
  it('T103 covers integer one-through-three, an equal endpoint and reversed endpoint rejection',()=>{
    const reservation={id:'synthetic-scalar-range',maxMaterialBytes:10000,maxCandidateTrials:100};
    for(const [candidate,expected] of [[0,1],[1,2],[2,3]] as const){
      const plan=planRandomTape({mode:'integer',lower:1,upper:3},1);
      expect(evaluateRandomTape(prepareRandomTape(plan,reservation,()=>Uint8Array.of(candidate<<6)))).toMatchObject({state:'SUCCEEDED',value:expected});
    }
    const same=planRandomTape({mode:'integer',lower:2,upper:2},1);
    expect(evaluateRandomTape(prepareRandomTape(same,reservation,()=>{throw Error('Equal endpoints must not consume entropy');}))).toMatchObject({state:'SUCCEEDED',value:2});
    expect(()=>planRandomTape({mode:'integer',lower:3,upper:1},1)).toThrow();
  });
  it('T104 uses an explicit 53-bit lattice and keeps all mock decimal samples below one',()=>{
    const maximum=(1n<<53n)-1n;
    for(let sample=0n;sample<=1024n;sample++){
      const candidate=maximum*sample/1024n;
      const value=decimalFrom53Bits(0,1,candidate);
      expect(value).toBe(Number(candidate)/2**53);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThan(1);
    }
    expect(decimalFrom53Bits(0,1,1n)).toBe(2**-53);
    expect(decimalFrom53Bits(0,1,maximum)).toBe(1-2**-53);
  });
  it('T121 uses the explicit Scratch decimal mode for 1234 at -2 digits and rejects both digit limits',()=>{
    expect(evaluate(expression('Number','number.roundDecimal',[n(1234),n(-2)],{roundingMode:'tiesTowardPositiveInfinity'}))).toBe(1200);
    for(const digits of [-309,309])expect(()=>evaluate(expression('Number','number.roundDecimal',[n(1234),n(digits)],{roundingMode:'tiesTowardPositiveInfinity'}))).toThrowError(expect.objectContaining({code:'PrecisionRangeError'}));
  });
  it('S050 preserves original e37fd32 legacy half-neighbour fixtures and requires explicit new rounding modes',()=>{
    // Frozen from e37fd32 expression.ts's original sign*floor(abs+0.5),
    // including its binary64 addition near +/-0.5. New modes use exact rounding.
    const cases=[[-1.5000000000000002,-2,-2,-2],[-1.5,-2,-1,-2],[-1.4999999999999998,-1,-1,-1],[-0.5000000000000001,-1,-1,-1],[-0.5,-1,0,-1],[-0.49999999999999994,-1,0,0],[0.49999999999999994,1,0,0],[0.5,1,1,1],[0.5000000000000001,1,1,1],[1.4999999999999998,1,1,1],[1.5,2,2,2],[1.5000000000000002,2,2,2]] as const;
    for(const [input,legacy,scratch,away] of cases){
      expect(evaluate(expression('Number','number.round',[n(input)]),{semanticProfile:undefined})).toBe(legacy);
      expect(evaluate(expression('Number','number.roundInteger',[n(input)],{roundingMode:'tiesTowardPositiveInfinity'}))).toBe(scratch);
      expect(evaluate(expression('Number','number.roundInteger',[n(input)],{roundingMode:'tiesAwayFromZero'}))).toBe(away);
    }
    expect(()=>evaluate(expression('Number','number.roundInteger',[n(1.5)]))).toThrow();
    expect(()=>evaluate(expression('Number','number.roundInteger',[n(1.5)],{roundingMode:'tiesAwayFromZero'}),{semanticProfile:undefined})).toThrow();
  });
  it('T031 includes both endpoints for forward, reverse and one-item integer ranges',()=>{
    for(const [start,end,step,expected] of [[1,5,2,[1,3,5]],[5,1,-2,[5,3,1]],[2,2,1,[2]]] as const)
      expect(evaluate(expression({kind:'List',element:'Number'},'list.range',[n(start),n(end),n(step)]))).toEqual(expected);
  });
  it('T032 rejects zero or backwards range steps and Q+1 before generating a list',()=>{
    for(const step of [0,-1])expect(()=>evaluate(expression({kind:'List',element:'Number'},'list.range',[n(1),n(5),n(step)]))).toThrowError(expect.objectContaining({code:'INTEGER_RANGE'}));
    const budget={evaluations:0};
    expect(()=>evaluate(expression({kind:'List',element:'Number'},'list.range',[n(1),n(4),n(1)]),{limits:{maxListItems:3},budget})).toThrowError(expect.objectContaining({code:'LIST_SIZE'}));
    expect(budget.evaluations).toBeLessThan(5);
    expect(evaluate(expression({kind:'List',element:'Number'},'list.range',[n(1),n(3),n(1)]),{limits:{maxListItems:3}})).toEqual([1,2,3]);
  });
  it('T067 refuses reading or increasing a required uninitialized value and never fabricates zero',()=>{
    const definition=flow([declare('required',{kind:'missing',type:'Number'}),add('increase','required.value'),declare('read',variable('required.value'))]);
    const result=validateFlowDefinition(definition);
    expect(result.complete).toBe(false);expect(result.plan).toBeUndefined();expect(result.issues.some(issue=>issue.code==='MISSING_INPUT')).toBe(true);expect(()=>compileFlowDefinition(definition)).toThrow();
    expect(()=>evaluate(variable('required.value'))).toThrow();
  });
  it('T070 refuses reading a value declared only in a different branch scope',()=>{
    const definition=flow([{kind:'branch',id:'scope',condition:literal('Boolean',true),then:[declare('inside',n(7))],otherwise:[],unknown:[]},declare('outside',variable('inside.value'))]);
    const checked=validateFlowDefinition(definition);expect(checked.valid).toBe(false);expect(checked.plan).toBeUndefined();expect(checked.issues.some(issue=>issue.path==='body.1.value')).toBe(true);
  });
  it('T071 allows explicit sequential additions but rejects child and parallel parent writes',()=>{
    const result=inspected(flow([declare('sum',n(0)),repeat('three',n(3),[add('add','sum.value',2)]),declare('after',variable('sum.value'))]),['sum.value','after.value']);
    expect(result.status).toBe('COMPLETED');expect(valueOf(result,'sum.value')).toBe(6);expect(valueOf(result,'after.value')).toBe(6);
    const parallel=flow([declare('sum',n(0)),{kind:'parallel',id:'parallel',branches:[{id:'child',name:'Child',body:[add('illegal','sum.value')]}]}]);
    expect(validateFlowDefinition(parallel).issues.some(issue=>issue.code==='VARIABLE_READONLY')).toBe(true);
    const child=flow([declare('sum',n(0)),{kind:'call',id:'call',procedureId:'child',revision:1,args:{},outputs:{}}]);
    child.procedures=[{id:'child',revision:1,name:'Child',inputs:[],outputs:[],body:[add('illegal','sum.value'),{kind:'return',id:'return',values:{}}]}];
    expect(validateFlowDefinition(child).valid).toBe(false);
  });
  it('T085 rejects direct and transitive pure definitions containing send/read/random/Wait/assignment',()=>{
    const effects=[{kind:'action',operation:'discord.sendMessage',inputs:{}},{kind:'action',operation:'nexus.readTicket',inputs:{}},{kind:'random',mode:'integer',min:n(1),max:n(3)},{kind:'wait',duration:literal('Duration',1)},{kind:'assign',variableId:'outside',value:n(1)}];
    for(const effect of effects){
      const forbidden={...effect,id:'effect',type:'Number'} as unknown as ValueInput;
      for(const transitive of [false,true]){
        const definition=flow([declare('answer',pureCall('outer'))]);
        definition.pureDefinitions=transitive?[pure('outer',pureCall('inner')),pure('inner',forbidden)]:[pure('outer',forbidden)];
        const checked=validateFlowDefinition(definition);expect(checked.valid).toBe(false);expect(checked.plan).toBeUndefined();
      }
    }
  });
  it('T088 refuses a missing normal branch return inside a pure value instead of returning zero or empty',()=>{
    const value=expression('Number','value.choose',[literal('Boolean',false),n(7),{kind:'missing',type:'Number'}]);
    const definition=flow([declare('answer',pureCall('choose'))]);definition.pureDefinitions=[pure('choose',value)];
    const checked=validateFlowDefinition(definition);expect(checked.complete).toBe(false);expect(checked.plan).toBeUndefined();expect(()=>evaluate(pureCall('choose'),{pureDefinitions:definition.pureDefinitions})).toThrow();
    definition.pureDefinitions[0]!.value=expression('Number','value.choose',[literal('Boolean',false),n(7),n(19)]);
    expect(valueOf(inspected(definition,['answer.value']),'answer.value')).toBe(19);
  });
  it.each([0,3])('T089 executes a finite repeat count %s times and continues even after zero',count=>{
    const definition=flow([repeat('repeat',n(count),[declare('body',n(1))]),declare('after',n(1))]);
    const result=inspected(definition,[]);expect(result.status).toBe('COMPLETED');expect(result.steps.filter(step=>step.blockId==='body')).toHaveLength(count);expect(result.steps.filter(step=>step.blockId==='after')).toHaveLength(1);
  });
  it('T095 break and continue affect only the nearest loop and consume each entered iteration',()=>{
    const results=[];
    for(const exit of ['break','continue'] as const){
      const inner=repeat('inner',n(3),[add('visit','visits.value'),{kind:'branch',id:'exit-choice',condition:literal('Boolean',true),then:[{kind:exit,id:'exit'}],otherwise:[],unknown:[]},add('never-add','never.value')]);
      const definition=flow([declare('visits',n(0)),declare('outer-count',n(0)),declare('never',n(0)),repeat('outer',n(2),[inner,add('outer-after','outer-count.value')]),declare('after',n(1))]);
      const result=inspected(definition,['visits.value','outer-count.value','never.value']);
      expect(result.status).toBe('COMPLETED');expect(valueOf(result,'visits.value')).toBe(exit==='break'?2:6);expect(valueOf(result,'outer-count.value')).toBe(2);expect(valueOf(result,'never.value')).toBe(0);expect(result.steps.filter(step=>step.blockId==='after')).toHaveLength(1);results.push(result);
    }
    expect(results[1]!.transitions).toBeGreaterThan(results[0]!.transitions);expect(results[1]!.evaluations).toBeGreaterThan(results[0]!.evaluations);
  });
  it('T096 rejects breaking a caller loop from a child and continuing it from a parallel branch',()=>{
    const called=flow([repeat('parent',n(2),[{kind:'call',id:'call',procedureId:'child',revision:1,args:{},outputs:{}}])]);
    called.procedures=[{id:'child',revision:1,name:'Child',inputs:[],outputs:[],body:[{kind:'break',id:'escape'},{kind:'return',id:'return',values:{}}]}];
    const parallel=flow([repeat('parent',n(2),[{kind:'parallel',id:'parallel',branches:[{id:'branch',name:'Branch',body:[{kind:'continue',id:'escape'}]}]}])]);
    for(const definition of [called,parallel]){const checked=validateFlowDefinition(definition);expect(checked.valid).toBe(false);expect(checked.plan).toBeUndefined();expect(checked.issues.some(issue=>issue.code==='LOOP_BOUNDARY')).toBe(true);}
  });
});
