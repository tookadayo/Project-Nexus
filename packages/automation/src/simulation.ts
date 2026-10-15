import {evaluateValue,assertCount,typeEquals} from './expression';
import type {EvaluatedValue,ExecutionPlan,JsonValue,Statement,ValueInput,TicketState} from './types';
import {ACTION_DEFINITIONS} from './catalog';
import {runBuiltinValues} from './builtins';
import {fixedPollBounds} from './poll';
import {MAX_RUN_SECONDS} from './types';
import {isUncertaintySafe} from './results';
import {iterationList,iterationRow,type IterationState} from './iteration-results';

export interface AutomationSimulationInput {
  values?:Record<string,{type:EvaluatedValue['type'];value:JsonValue}>;
  outputs?:Record<string,{type:EvaluatedValue['type'];value:JsonValue}>;
  outcomes?:Record<string,'SUCCEEDED'|'FAILED'|'NOT_STARTED'|'UNKNOWN'>;
  /** Optional explicit snapshots per read attempt. Ordinary mocks may use one
   * output/outcome keyed by the poll block for every bounded attempt. */
  pollReads?:Record<string,{outcome?:'SUCCEEDED'|'FAILED'|'NOT_STARTED'|'UNKNOWN';output?:{type:EvaluatedValue['type'];value:JsonValue}}[]>;
  awaitEvents?:Record<string,{state:'MATCHED';value:{state:TicketState;version:number};occurredAt:string}|{state:'TIMED_OUT'}>;
  approvals?:Record<string,'APPROVED'|'REJECTED'|'EXPIRED'>;
  clock?:string;
}
export interface SimulationStep {blockId:string;kind:string;state:string;code?:string;operation?:string;}
type Control={state:'continue'|'break'|'next'|'end'|'return'|'stopped';values?:Record<string,EvaluatedValue>};
/** Uses the production expression evaluator over an in-memory frame. No DB,
 * connectors, production random generator, approval service or run is used. */
export function simulateAutomationPlan(plan:ExecutionPlan,input:AutomationSimulationInput={},clock='2026-01-01T00:00:00.000Z') {
  const steps:SimulationStep[]=[],budget={evaluations:0},env:Record<string,EvaluatedValue>={};
  const iterations:{blockId:string;identity:string;states:IterationState[];counts:Record<string,number>}[]=[];
  let transitions=0,actions=0,status:'COMPLETED'|'FAILED'|'UNDETERMINED'|'UNKNOWN'='COMPLETED';
  let uncertainty:'CAPTURED'|'HANDLING'|null=null;
  const fixedRunValues=runBuiltinValues(plan.definition.guildId,clock);
  const virtualClocks=new WeakMap<object,number>();
  const simulatedNow=(variables:Record<string,EvaluatedValue>)=>virtualClocks.get(variables)??Date.parse(clock);
  const evaluate=(value:ValueInput,variables:Record<string,EvaluatedValue>)=>evaluateValue(value,{guildId:plan.definition.guildId,variables:{...variables,...fixedRunValues},limits:plan.limits,budget,pureDefinitions:plan.definition.pureDefinitions});
  const mock=(value:{type:EvaluatedValue['type'];value:JsonValue},serviceOutput=false)=>{
    if(serviceOutput){
      if(new TextEncoder().encode(JSON.stringify(value.value)).byteLength>plan.limits.maxValueBytes)throw new Error('SIMULATION_VALUE_SIZE');
      const slot='simulation.service-output';
      return evaluate({kind:'variable',type:value.type,variableId:slot},{[slot]:{...structuredClone(value),provenance:[{source:'service',guildId:plan.definition.guildId,resumable:false}]}});
    }
    const checked=evaluate({kind:'literal',...value},{});return {...checked,provenance:[...checked.provenance,{source:'input' as const,guildId:plan.definition.guildId}]};
  };
  function scoped(body:Statement[],variables:Record<string,EvaluatedValue>,depth:number,complete?:(result:Control)=>void):Control {
    const existing=new Set(Object.keys(variables));
    try{const result=walk(body,variables,depth);complete?.(result);return result;}finally{for(const id of Object.keys(variables))if(!existing.has(id))delete variables[id];}
  }
  function walk(body:Statement[],variables:Record<string,EvaluatedValue>,depth:number):Control {
    if(depth>plan.limits.maxNesting)throw new Error('SIMULATION_DEPTH_LIMIT');
    // A direct sequence invocation owns its receipts. Reusing an AST in a
    // procedure or repeat must never reuse another invocation's approval.
    const approvalReceipts=new Map<Statement,{inputs:Record<string,EvaluatedValue>;deadline:number}>();
    for(const statement of body){
      if(statement.enabled===false)continue;
      if(uncertainty&&(uncertainty==='CAPTURED'?statement.kind!=='resultBranch':!isUncertaintySafe(statement)))throw new Error('SIMULATION_UNCERTAINTY_EFFECT');
      if(++transitions>plan.limits.maxExpandedSteps)throw new Error('SIMULATION_STEP_LIMIT');
      const record:SimulationStep={blockId:statement.id,kind:statement.kind,state:'SIMULATED'};steps.push(record);
      switch(statement.kind){
        case 'declare':variables[statement.variable.id]=evaluate(statement.value,variables);break;
        case 'assign':variables[statement.variableId]=evaluate(statement.value,variables);break;
        case 'branch':{
          const value=evaluate(statement.condition,variables).value;const branch=value===true||value==='true'?'then':value===false||value==='false'?'otherwise':'unknown';
          record.code=branch==='unknown'?'CONDITION_UNKNOWN':branch==='then'?'CONDITION_TRUE':'CONDITION_FALSE';const result=scoped(statement[branch],variables,depth+1);if(result.state!=='continue')return result;break;
        }
        case 'switch':{const value=evaluate(statement.value,variables).value,choice=statement.cases.find(item=>item.value===value);if(!choice)throw new Error('SIMULATION_CHOICE_UNHANDLED');const result=scoped(choice.body,variables,depth+1);if(result.state!=='continue')return result;break;}
        case 'optionalBranch':{
          const value=evaluate(statement.value,variables);if(typeof value.type!=='object'||value.type.kind!=='Optional'||!value.value||typeof value.value!=='object'||Array.isArray(value.value))throw new Error('SIMULATION_OPTIONAL_TYPE');
          const present=value.value.state==='set';if(present)variables[statement.output.id]={type:value.type.value,value:value.value.value!,provenance:value.provenance};
          let result:Control;try{result=scoped(present?statement.present:statement.unset,variables,depth+1);}finally{delete variables[statement.output.id];}
          record.state=present?'OPTIONAL_PRESENT':'OPTIONAL_UNSET';if(result.state!=='continue')return result;break;
        }
        case 'resultBranch':{
          const value=evaluate(statement.value,variables);if(typeof value.type!=='object'||!['ParseResult','OperationOutcome'].includes(value.type.kind)||!('value' in value.type)||!value.value||typeof value.value!=='object'||Array.isArray(value.value))throw new Error('SIMULATION_RESULT_TYPE');
          const branch=value.value.state==='SUCCEEDED'?'succeeded':value.value.state==='FAILED'?'failed':value.value.state==='NOT_STARTED'?'notStarted':'unknown';
          if(branch==='unknown'){if(!uncertainty)throw new Error('SIMULATION_UNCERTAINTY_MISSING');uncertainty='HANDLING';}
          if(branch==='succeeded')variables[statement.output.id]={type:value.type.value,value:value.value.value!,provenance:value.provenance};
          else if(statement.reason)variables[statement.reason.id]={type:'PlainText',value:value.value.reason!,provenance:value.provenance};
          let result:Control;try{result=scoped(statement[branch],variables,depth+1);}finally{delete variables[statement.output.id];if(statement.reason)delete variables[statement.reason.id];}
          record.state='RESULT_'+branch.toUpperCase();if(branch==='unknown')return {state:'stopped'};if(result.state!=='continue')return result;break;
        }
        case 'repeat':{
          let items:EvaluatedValue[];
          if(statement.count){const count=assertCount(evaluate(statement.count,variables).value,plan.limits.maxListItems);items=Array.from({length:count},(_,index)=>({type:'Number',value:index+1,provenance:[]}));}
          else {const list=evaluate(statement.list!,variables);if(typeof list.type!=='object'||list.type.kind!=='List'||!Array.isArray(list.value))throw new Error('SIMULATION_LIST_REQUIRED');const type=list.type.element;items=list.value.map(value=>({type,value,provenance:list.provenance}));}
          const summary={blockId:statement.id,identity:'mock-'+transitions,states:items.map(()=>'NOT_STARTED' as IterationState),counts:{}};
          const initial=Object.fromEntries((statement.results??[]).map(result=>[result.output.id,iterationList(result.value.type,items.length,plan.definition.guildId)]));
          const bounded=()=>{if(new TextEncoder().encode(JSON.stringify({variables,items,iterations})).byteLength>plan.limits.maxValueBytes)throw new Error('SIMULATION_STATE_LIMIT');};
          if(new TextEncoder().encode(JSON.stringify({variables:{...variables,...initial},items,iterations:[...iterations,...(statement.results?.length?[summary]:[])]})).byteLength>plan.limits.maxValueBytes)throw new Error('SIMULATION_STATE_LIMIT');
          Object.assign(variables,initial);
          if(statement.results?.length)iterations.push(summary);
          for(let index=0;index<items.length;index++){
            variables[statement.itemVariable.id]=items[index]!;if(statement.indexVariable)variables[statement.indexVariable.id]={type:'Number',value:index+1,provenance:[]};
            const stepStart=steps.length;let itemState:IterationState='NOT_STARTED';
            const finish=(control:Control)=>{
              const operationStates=steps.slice(stepStart).map(step=>step.state);
              itemState=operationStates.includes('MOCK_UNKNOWN')?'UNKNOWN':operationStates.includes('MOCK_FAILED')?'FAILED':operationStates.includes('MOCK_NOT_STARTED')||operationStates.includes('UNDETERMINED')?'NOT_STARTED':control.state==='continue'?'SUCCEEDED':control.state==='stopped'?'FAILED':'SKIPPED';
              summary.states[index]=itemState;
              for(const result of statement.results??[]){const list=variables[result.output.id]!;const value=itemState==='SUCCEEDED'?evaluate(result.value,variables):undefined;(list.value as JsonValue[])[index]=iterationRow(index+1,itemState,value);if(value)list.provenance.push(...value.provenance);}
              bounded();
            };
            let result:Control;
            try{result=scoped(statement.body,variables,depth+1,finish);}catch(error){finish({state:'stopped'});throw error;}
            if(String(status)==='UNDETERMINED')return {state:'stopped'};
            if(['FAILED','UNKNOWN','NOT_STARTED'].includes(itemState)){status=String(itemState)==='UNKNOWN'?'UNKNOWN':'FAILED';return {state:'stopped'};}
            if(result.state==='break')break;if(['end','return','stopped'].includes(result.state))return result;
          }
          delete variables[statement.itemVariable.id];if(statement.indexVariable)delete variables[statement.indexVariable.id];break;
        }
        case 'wait':{
          const now=simulatedNow(variables),value=evaluate(statement.duration??statement.until!,variables),next=statement.duration?now+Number(value.value)*1000:Date.parse(String(value.value));
          if(!Number.isFinite(next)||next<now||next-now>MAX_RUN_SECONDS*1000||next>Date.parse(clock)+MAX_RUN_SECONDS*1000)throw new Error('SIMULATION_WAIT_LIMIT');
          virtualClocks.set(variables,next);
          record.state='SIMULATED_WAIT';break;
        }
        case 'poll':{
          evaluate(statement.ticket,variables);
          const start=simulatedNow(variables),bounds=fixedPollBounds({maxAttempts:evaluate(statement.maxAttempts,variables),interval:evaluate(statement.interval,variables),until:evaluate(statement.until,variables)},new Date(Date.parse(clock)+MAX_RUN_SECONDS*1000),plan.limits.maxListItems);
          let selected:'matched'|'exhausted'|'timedOut'='timedOut',last:EvaluatedValue|undefined;
          for(let attempt=0;attempt<bounds.maxAttempts;attempt++){
            if(start+attempt*bounds.intervalSeconds*1000>=Date.parse(bounds.deadline))break;
            virtualClocks.set(variables,start+attempt*bounds.intervalSeconds*1000);
            if(attempt>0&&++transitions>plan.limits.maxExpandedSteps)throw new Error('SIMULATION_STEP_LIMIT');
            const explicit=input.pollReads&&Object.hasOwn(input.pollReads,statement.id)?input.pollReads[statement.id]?.[attempt]:undefined;
            const outcome=explicit?.outcome??(input.outcomes&&Object.hasOwn(input.outcomes,statement.id)?input.outcomes[statement.id]:undefined);
            const step:SimulationStep={blockId:statement.id,kind:'pollRead',state:outcome?'MOCK_'+outcome:'UNDETERMINED',operation:'nexus.readTicket'};steps.push(step);
            if(!outcome){step.code='MOCK_OUTCOME_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}
            if(outcome!=='SUCCEEDED'){status=outcome==='UNKNOWN'?'UNKNOWN':'FAILED';return {state:'stopped'};}
            const output=explicit?.output??(input.outputs&&Object.hasOwn(input.outputs,statement.id)?input.outputs[statement.id]:undefined);
            if(!output){step.state='UNDETERMINED';step.code='MOCK_OUTPUT_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}
            if(!typeEquals(output.type,statement.output.type))throw new Error('SIMULATION_OUTPUT_TYPE');
            last=mock(output,true);
            const result=evaluate(statement.condition,{...variables,[statement.output.id]:last});
            if(result.type!=='Boolean'||typeof result.value!=='boolean')throw new Error('SIMULATION_CONDITION_TYPE');
            if(result.value){selected='matched';break;}
            if(attempt+1===bounds.maxAttempts)selected='exhausted';
          }
          record.state='SIMULATED_'+(selected==='timedOut'?'TIMED_OUT':selected.toUpperCase());
          if(selected==='timedOut')virtualClocks.set(variables,Math.max(start,Date.parse(bounds.deadline)));
          const existing=variables[statement.output.id];
          if(selected!=='timedOut'&&last)variables[statement.output.id]=last;
          let result:Control;
          try{result=scoped(statement[selected],variables,depth+1);}
          finally{if(existing)variables[statement.output.id]=existing;else delete variables[statement.output.id];}
          if(result.state!=='continue')return result;
          break;
        }
        case 'awaitEvent':{
          const ticket=evaluate(statement.ticket,variables);
          if(typeof ticket.value!=='object'||ticket.value===null||Array.isArray(ticket.value)||typeof ticket.value.id!=='string'||!/^intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ticket.value.id))throw new Error('SIMULATION_EVENT_TICKET');
          const until=evaluate(statement.until,variables),deadline=Date.parse(String(until.value)),now=simulatedNow(variables);
          if(until.type!=='Instant'||!Number.isFinite(deadline)||deadline>Date.parse(clock)+MAX_RUN_SECONDS*1000)throw new Error('SIMULATION_WAIT_LIMIT');
          const event=input.awaitEvents&&Object.hasOwn(input.awaitEvents,statement.id)?input.awaitEvents[statement.id]:undefined;
          if(!event){record.state='UNDETERMINED';record.code='MOCK_EVENT_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}
          const selected=event.state==='MATCHED'?'matched':'timedOut';
          let value:EvaluatedValue|undefined;
          if(event.state==='MATCHED'){
            const at=Date.parse(event.occurredAt);
            if(!Number.isFinite(at)||at<=now||at>=deadline||!statement.states.includes(event.value.state))throw new Error('SIMULATION_EVENT_MISMATCH');
            value=mock({type:statement.output.type,value:event.value},true);virtualClocks.set(variables,at);
          }else virtualClocks.set(variables,Math.max(now,deadline));
          record.state=event.state==='MATCHED'?'MOCK_EVENT_MATCHED':'MOCK_EVENT_TIMED_OUT';
          if(value)variables[statement.output.id]=value;
          let result:Control;
          try{result=scoped(statement[selected],variables,depth+1);}finally{delete variables[statement.output.id];}
          if(result.state!=='continue')return result;break;
        }
        case 'readClock':variables[statement.output.id]=mock({type:'Instant',value:input.clock??new Date(simulatedNow(variables)).toISOString()});record.state='MOCK_CLOCK';break;
        case 'approval':{
          const until=evaluate(statement.until,variables),deadline=Date.parse(String(until.value));
          if(until.type!=='Instant'||!Number.isFinite(deadline)||deadline>Date.parse(clock)+MAX_RUN_SECONDS*1000)throw new Error('SIMULATION_WAIT_LIMIT');
          const target=body.find(candidate=>candidate.id===statement.actionId);
          if(!target||target.kind!=='action'||!['discord.addRole','discord.removeRole'].includes(target.operation))throw new Error('SIMULATION_APPROVAL_TARGET');
          const inputs=Object.fromEntries(Object.entries(target.inputs).map(([key,value])=>[key,evaluate(value,variables)]));
          approvalReceipts.set(target,{inputs:structuredClone(inputs),deadline});
          const choice=input.approvals?.[statement.id];
          if(!choice){record.state='UNDETERMINED';record.code='MOCK_APPROVAL_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}
          const branch=deadline<=simulatedNow(variables)||choice==='EXPIRED'?'expired':choice==='APPROVED'?'approved':'rejected';
          record.state='MOCK_APPROVAL_'+branch.toUpperCase();
          const result=scoped(statement[branch],variables,depth+1);
          if(branch!=='approved'){status='FAILED';return {state:'stopped'};}
          if(result.state!=='continue')return result;break;
        }
        case 'random':{
          // Deliberately deterministic, visibly mocked, and never committed as
          // the production result for this flow or block.
          let value:JsonValue;
          if(statement.mode==='integer'){
            const min=evaluate(statement.min!,variables).value,max=evaluate(statement.max!,variables).value;
            if(typeof min!=='number'||typeof max!=='number'||!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min>max)throw new Error('SIMULATION_RANDOM_RANGE');value=min;
          }else{
            const candidates=evaluate(statement.list!,variables).value;if(!Array.isArray(candidates))throw new Error('SIMULATION_LIST_REQUIRED');
            const size=statement.mode==='shuffle'?candidates.length:assertCount(evaluate(statement.count!,variables).value,plan.limits.maxListItems);if(size>candidates.length)throw new Error('SIMULATION_RANDOM_CANDIDATES');value=candidates.slice(0,size);
          }
          variables[statement.output.id]=mock({type:statement.output.type,value});record.state='MOCK_DRAW';break;
        }
        case 'action':{
          const approved=approvalReceipts.get(statement);approvalReceipts.delete(statement);
          if(approved&&approved.deadline<=simulatedNow(variables))throw new Error('SIMULATION_APPROVAL_EXPIRED');
          if(!approved)for(const value of Object.values(statement.inputs))evaluate(value,variables);
          if(ACTION_DEFINITIONS[statement.operation].externalChange&&++actions>plan.limits.maxExternalActions)throw new Error('SIMULATION_ACTION_LIMIT');
          record.operation=statement.operation;
          const outcome=input.outcomes&&Object.hasOwn(input.outcomes,statement.id)?input.outcomes[statement.id]:undefined;
          if(!outcome){record.state='UNDETERMINED';record.code='MOCK_OUTCOME_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}
          record.state='MOCK_'+outcome;
          if(statement.outcome){
            const target=ACTION_DEFINITIONS[statement.operation].outputType??'Boolean';let payload:EvaluatedValue|undefined;
            if(outcome==='SUCCEEDED'&&ACTION_DEFINITIONS[statement.operation].outputType){const output=input.outputs?.[statement.id];if(!output){record.state='UNDETERMINED';record.code='MOCK_OUTPUT_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}if(!typeEquals(output.type,target))throw new Error('SIMULATION_OUTPUT_TYPE');payload=mock(output,true);}
            const issued:EvaluatedValue={type:{kind:'OperationOutcome',value:target},value:outcome==='SUCCEEDED'?{state:outcome,value:payload?.value??true}:{state:outcome,reason:'MOCK_'+outcome},provenance:[...(payload?.provenance??[]),{source:'service',guildId:plan.definition.guildId,resumable:false,evidence:'operation'}]};
            variables[statement.outcome.id]=issued;if(outcome==='UNKNOWN'){uncertainty='CAPTURED';status='UNKNOWN';}break;
          }
          if(outcome!=='SUCCEEDED'){status=outcome==='UNKNOWN'?'UNKNOWN':'FAILED';return {state:'stopped'};}
          if(statement.output){const output=input.outputs?.[statement.id];if(!output){record.state='UNDETERMINED';record.code='MOCK_OUTPUT_REQUIRED';status='UNDETERMINED';return {state:'stopped'};}if(!typeEquals(output.type,statement.output.type))throw new Error('SIMULATION_OUTPUT_TYPE');variables[statement.output.id]=mock({type:statement.output.type,value:output.value},true);}
          break;
        }
        case 'call':{
          const procedure=plan.definition.procedures?.find(item=>item.id===statement.procedureId&&item.revision===statement.revision);if(!procedure)throw new Error('SIMULATION_PROCEDURE_REQUIRED');
          const args=Object.fromEntries(Object.entries(statement.args).map(([id,value])=>[id,evaluate(value,variables)]));virtualClocks.set(args,simulatedNow(variables));const result=walk(procedure.body,args,depth+1);virtualClocks.set(variables,simulatedNow(args));
          if(result.state!=='return'){if(result.state==='stopped')return result;throw new Error('SIMULATION_RETURN_REQUIRED');}
          for(const [id,declaration] of Object.entries(statement.outputs)){const value=result.values?.[id];if(!value)throw new Error('SIMULATION_RETURN_REQUIRED');variables[declaration.id]=value;}break;
        }
        case 'return':return {state:'return',values:Object.fromEntries(Object.entries(statement.values).map(([id,value])=>[id,evaluate(value,variables)]))};
        case 'break':return {state:'break'};
        case 'continue':return {state:'next'};
        case 'end':return {state:uncertainty?'stopped':'end'};
        case 'parallel':{
          const results:Record<string,Record<string,EvaluatedValue>>={};
          const start=simulatedNow(variables);let finish=start;
          for(const branch of statement.branches){
            const isolated=structuredClone(variables);virtualClocks.set(isolated,start);const result=walk(branch.body,isolated,depth+1);finish=Math.max(finish,simulatedNow(isolated));
            if(result.state==='stopped')return result;
            results[branch.id]=Object.fromEntries(Object.entries(branch.outputs??{}).map(([key,value])=>[key,evaluate(value,isolated)]));
          }
          virtualClocks.set(variables,finish);
          for(const [variableId,binding] of Object.entries(statement.outputs??{})){
            const value=results[binding.branchId]?.[binding.outputId];if(!value)throw new Error('SIMULATION_PARALLEL_OUTPUT_MISSING');variables[variableId]=value;
          }
          record.state='SIMULATED_ISOLATED_BRANCHES';break;
        }
      }
    }
    return {state:'continue'};
  }
  try {
    const declarations=plan.definition.trigger.kind==='manual'||plan.definition.trigger.kind==='internal'||plan.definition.trigger.kind==='interaction'||plan.definition.trigger.kind==='messageMetadata'?plan.definition.trigger.inputs:[];
    for(const declaration of declarations){const value=input.values?.[declaration.id];if(!value){status='UNDETERMINED';steps.push({blockId:declaration.id,kind:'input',state:'UNDETERMINED',code:'MOCK_INPUT_REQUIRED'});return result();}env[declaration.id]=mock({type:declaration.type,value:value.value});}
    walk(plan.definition.body,env,0);
  }catch(error){status=uncertainty?'UNKNOWN':'FAILED';steps.push({blockId:'simulation',kind:'error',state:status,code:error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error&&/^SIMULATION_[A-Z_]+$/.test(error.message)?error.message:'SIMULATION_INPUT_INVALID'});}
  return result();
  function result(){for(const item of iterations)item.counts=Object.fromEntries(['SUCCEEDED','FAILED','NOT_STARTED','SKIPPED','CANCELLED','UNKNOWN'].map(state=>[state,item.states.filter(value=>value===state).length]));return {mode:'SIMULATION' as const,status,externalChanges:0,productionRuns:0,approvalConsumption:0,productionDraws:0,steps,evaluations:budget.evaluations,plannedActions:actions,transitions,mocked:true,...(iterations.length?{iterations}:{})};}
}
