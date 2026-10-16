import {AutomationValueError,evaluateValue,assertCount,typeEquals} from './expression';
import type {EvaluatedValue,ExecutionPlan,JsonValue,Statement,ValueInput,TicketState} from './types';
import {ACTION_DEFINITIONS} from './catalog';
import {runBuiltinValues} from './builtins';
import {fixedPollBounds} from './poll';
import {MAX_RUN_SECONDS} from './types';
import {isUncertaintySafe} from './results';
import {iterationList,iterationRow,type IterationState} from './iteration-results';
import {boundedLoopDecision,isLocalDeadlineSafe,LOOP_HANDLER_KEYS,type BoundedLoop,type LoopFailureReason} from './bounded-loop';

export interface AutomationSimulationInput {
  /** Explicit response-only inspection. No values are returned without opt-in. */
  inspectVariables?:string[];
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
export interface SimulationInspectionValue {variableId:string;type:EvaluatedValue['type'];value:JsonValue;blockId:string;}
type Control={state:'continue'|'break'|'next'|'end'|'endBranch'|'endRun'|'return'|'stopped';values?:Record<string,EvaluatedValue>};
interface SimulationLoopSummary {blockId:string;mode:BoundedLoop['mode'];completedIterations:number;guardEvaluations:number;reason?:string;handler?:string;handlerFailed?:boolean;}
interface SimulationLoopFrame {statement:BoundedLoop;variables:Record<string,EvaluatedValue>;deadline?:number;handling:boolean;summary:SimulationLoopSummary;}
class SimulationLoopExpiry extends Error {constructor(readonly owner:SimulationLoopFrame){super('SIMULATION_LOCAL_DEADLINE');}}
/** Uses the production expression evaluator over an in-memory frame. No DB,
 * connectors, production random generator, approval service or run is used. */
export function simulateAutomationPlan(plan:ExecutionPlan,input:AutomationSimulationInput={},clock='2026-01-01T00:00:00.000Z',capabilities:Pick<import('./types').EvaluationContext,'numericMath'|'temporalResolution'|'fixedTemporalValues'>={}) {
  const steps:SimulationStep[]=[],budget={evaluations:0},env:Record<string,EvaluatedValue>={};
  const iterations:{blockId:string;identity:string;states:IterationState[];counts:Record<string,number>}[]=[];
  const loops:SimulationLoopSummary[]=[],activeLoops:SimulationLoopFrame[]=[];
  let inspectVariables:string[]=[];
  const inspected=new Map<string,SimulationInspectionValue>();
  let transitions=0,actions=0,status:'COMPLETED'|'FAILED'|'UNDETERMINED'|'UNKNOWN'='COMPLETED';
  let terminalReason:string|undefined,terminalHandler:{reason:LoopFailureReason;pure:boolean}|undefined;
  let uncertainty:'CAPTURED'|'HANDLING'|null=null;
  const fixedRunValues=runBuiltinValues(plan.definition.guildId,clock);
  const virtualClocks=new WeakMap<object,number>();
  const runDeadline=Date.parse(clock)+MAX_RUN_SECONDS*1000;
  const simulatedNow=(variables:Record<string,EvaluatedValue>)=>virtualClocks.get(variables)??Date.parse(clock);
  const effectiveDeadline=()=>Math.min(runDeadline,...activeLoops.flatMap(frame=>frame.deadline===undefined?[]:[frame.deadline]));
  const evaluate=(value:ValueInput,variables:Record<string,EvaluatedValue>,trusted=true)=>evaluateValue(value,{guildId:plan.definition.guildId,semanticProfile:plan.definition.semanticProfile,numericMath:capabilities.numericMath,temporalResolution:trusted?capabilities.temporalResolution:'resolve',fixedTemporalValues:trusted?capabilities.fixedTemporalValues:undefined,variables:{...variables,...fixedRunValues},limits:plan.limits,budget,pureDefinitions:plan.definition.pureDefinitions});
  function captureInspection(variables:Record<string,EvaluatedValue>,blockId:string) {
    if(!inspectVariables.length)return;
    for(const variableId of inspectVariables){
      const source=Object.hasOwn(variables,variableId)?variables:Object.hasOwn(fixedRunValues,variableId)?fixedRunValues:undefined;
      if(!source)continue;
      const value=source[variableId]!;
      if(value.provenance.some(item=>item.sensitive)){inspected.delete(variableId);continue;}
      const next={variableId,type:value.type,value:value.value,blockId};
      const values=[...inspected.entries()].filter(([id])=>id!==variableId).map(([,entry])=>entry);values.push(next);
      const present=new Set(values.map(entry=>entry.variableId));
      if(new TextEncoder().encode(JSON.stringify({mode:'SIMULATION_ONLY',values,unavailable:inspectVariables.filter(id=>!present.has(id))})).byteLength>plan.limits.maxValueBytes){inspected.clear();throw new Error('SIMULATION_INSPECTION_LIMIT');}
      inspected.set(variableId,structuredClone(next));
    }
  }
  function checkStops(variables:Record<string,EvaluatedValue>) {
    const now=simulatedNow(variables);
    if(!Number.isFinite(now)||now>=runDeadline){terminalReason='deadline_expired';throw new Error('SIMULATION_RUN_DEADLINE');}
    const owner=activeLoops.map((frame,index)=>({frame,index})).filter(({frame})=>frame.deadline!==undefined&&frame.deadline<=now).sort((a,b)=>a.frame.deadline!-b.frame.deadline!||a.index-b.index)[0];
    if(owner)throw new SimulationLoopExpiry(owner.frame);
  }
  function chargeTransition() {
    if(++transitions>plan.limits.maxExpandedSteps){terminalReason='budget_exhausted';throw new Error('SIMULATION_STEP_LIMIT');}
  }
  function enterLoopHandler(frame:SimulationLoopFrame,reason:LoopFailureReason,depth:number):Control {
    frame.handling=true;frame.summary.reason=reason;
    const key=LOOP_HANDLER_KEYS[reason],handler=frame.statement.handlers[key];
    steps.push({blockId:frame.statement.id,kind:'loopExit',state:'SIMULATED_LOOP_FAILURE',code:'LOOP_'+reason.toUpperCase()});
    if(terminalHandler){frame.summary.handlerFailed=true;throw new Error('SIMULATION_LOOP_HANDLER_FAILED');}
    const position=activeLoops.indexOf(frame);if(position>=0)activeLoops.splice(position,1);
    terminalReason=reason;
    if(!handler){status='FAILED';return {state:'stopped'};}
    frame.summary.handler=key;terminalHandler={reason,pure:reason==='local_deadline'};
    const declaration=frame.statement.reason,prior=declaration?frame.variables[declaration.id]:undefined;
    if(declaration)frame.variables[declaration.id]={type:declaration.type,value:reason,provenance:[{source:'service',guildId:plan.definition.guildId,resumable:true}]};
    try {
      checkStops(frame.variables);
      const control=scoped(handler,frame.variables,depth+1);
      if(['return','break','next'].includes(control.state))throw new Error('SIMULATION_LOOP_HANDLER_CONTROL');
      if(status!=='UNKNOWN'&&status!=='UNDETERMINED')status='FAILED';
      if(status==='UNKNOWN')terminalReason='unresolved_external_result';
      return {state:'stopped'};
    }catch(error){
      frame.summary.handlerFailed=true;
      if(!(error instanceof SimulationLoopExpiry)&&terminalReason===reason)steps.push({blockId:frame.statement.id,kind:'loopHandler',state:'FAILED',code:'LOOP_HANDLER_FAILED'});
      throw error;
    }finally{
      terminalHandler=undefined;
      if(declaration){if(prior)frame.variables[declaration.id]=prior;else delete frame.variables[declaration.id];}
    }
  }
  const mock=(value:{type:EvaluatedValue['type'];value:JsonValue},serviceOutput=false,internal=false)=>{
    if(serviceOutput){
      if(new TextEncoder().encode(JSON.stringify(value.value)).byteLength>plan.limits.maxValueBytes)throw new Error('SIMULATION_VALUE_SIZE');
      const slot='simulation.service-output';
      return evaluate({kind:'variable',type:value.type,variableId:slot},{[slot]:{...structuredClone(value),provenance:[{source:'service',guildId:plan.definition.guildId,resumable:false}]}});
    }
    const checked=evaluate({kind:'literal',...value},{},internal);return {...checked,provenance:[...checked.provenance,{source:internal?'expression' as const:'input' as const,guildId:plan.definition.guildId}]};
  };
  function scoped(body:Statement[],variables:Record<string,EvaluatedValue>,depth:number,complete?:(result:Control)=>void):Control {
    const existing=new Set(Object.keys(variables));
    try{const result=walk(body,variables,depth);complete?.(result);return result;}finally{for(const id of Object.keys(variables))if(!existing.has(id))delete variables[id];}
  }
  function walk(body:Statement[],variables:Record<string,EvaluatedValue>,depth:number):Control {
    if(depth>plan.limits.maxNesting)throw new Error('SIMULATION_DEPTH_LIMIT');
    captureInspection(variables,body[0]?.id??'simulation');
    // A direct sequence invocation owns its receipts. Reusing an AST in a
    // procedure or repeat must never reuse another invocation's approval.
    const approvalReceipts=new Map<Statement,{inputs:Record<string,EvaluatedValue>;deadline:number}>();
    for(const statement of body){
      if(statement.enabled===false)continue;
      checkStops(variables);
      if(terminalHandler?.pure&&!isLocalDeadlineSafe(statement))throw new Error('SIMULATION_LOCAL_DEADLINE_EFFECT');
      if(uncertainty&&(uncertainty==='CAPTURED'?statement.kind!=='resultBranch':!isUncertaintySafe(statement)))throw new Error('SIMULATION_UNCERTAINTY_EFFECT');
      chargeTransition();
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
        case 'searchBranch':{
          const value=evaluate(statement.value,variables);
          if(typeof value.type!=='object'||value.type.kind!=='Record'||!['nexus.index-result.v1','nexus.search-result.v1'].includes(value.type.schemaId)||value.value===null||typeof value.value!=='object'||Array.isArray(value.value))throw new Error('SIMULATION_SEARCH_RESULT_TYPE');
          const found=value.value.state==='found';if(!found&&value.value.state!=='not_found')throw new Error('SIMULATION_SEARCH_RESULT_TYPE');
          if(found){
            if(typeof value.value.index!=='number'||!Number.isSafeInteger(value.value.index)||value.value.index<=0)throw new Error('SIMULATION_SEARCH_RESULT_TYPE');
            variables[statement.index.id]={type:'Number',value:value.value.index,provenance:value.provenance};
            if(statement.output){if(value.type.schemaId!=='nexus.search-result.v1'||!value.type.typeArgs?.[0]||value.value.value===undefined)throw new Error('SIMULATION_SEARCH_RESULT_TYPE');variables[statement.output.id]={type:value.type.typeArgs[0],value:value.value.value,provenance:value.provenance};}
          }
          let result:Control;try{result=scoped(found?statement.found:statement.notFound,variables,depth+1);}finally{delete variables[statement.index.id];if(statement.output)delete variables[statement.output.id];}
          record.state=found?'SEARCH_FOUND':'SEARCH_NOT_FOUND';if(result.state!=='continue')return result;break;
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
            if(result.state==='break')break;if(['end','endBranch','endRun','return','stopped'].includes(result.state))return result;
          }
          delete variables[statement.itemVariable.id];if(statement.indexVariable)delete variables[statement.indexVariable.id];break;
        }
        case 'boundedLoop':{
          if(plan.definition.semanticProfile!=='scratch.v1'||statement.semanticVersion!==1)throw new Error('SIMULATION_SEMANTIC_PROFILE');
          const maxBody=assertCount(evaluate(statement.maxBody,variables).value,plan.limits.maxExpandedSteps);
          const until=evaluate(statement.until,variables),deadline=Date.parse(String(until.value));
          if(until.type!=='Instant'||!Number.isFinite(deadline)||deadline>runDeadline)throw new Error('SIMULATION_LOOP_DEADLINE');
          const summary:SimulationLoopSummary={blockId:statement.id,mode:statement.mode,completedIterations:0,guardEvaluations:0};loops.push(summary);
          const frame:SimulationLoopFrame={statement,variables,summary,handling:false,deadline};activeLoops.push(frame);
          try{
            for(;;){
              checkStops(variables);chargeTransition();summary.guardEvaluations++;
              const guard:SimulationStep={blockId:statement.id,kind:'loopGuard',state:'SIMULATED'};steps.push(guard);
              const condition=evaluate(statement.condition,variables);
              if(condition.type!=='Boolean'&&condition.type!=='ConditionResult')throw new Error('SIMULATION_CONDITION_TYPE');
              const decision=boundedLoopDecision(statement.mode,summary.completedIterations,maxBody,condition.value as boolean|'true'|'false'|'unknown');
              guard.code=decision==='complete'?'CONDITION_SATISFIED':decision==='body'?'CONTINUE':decision.toUpperCase();
              if(decision==='complete'){summary.reason='condition_satisfied';record.state='SIMULATED_LOOP_COMPLETED';break;}
              if(decision!=='body'){record.state='SIMULATED_LOOP_FAILURE';record.code='LOOP_'+decision.toUpperCase();return enterLoopHandler(frame,decision,depth);}
              const control=scoped(statement.body,variables,depth+1);
              if(control.state==='break'){summary.reason='broken';record.code='LOOP_BROKEN';break;}
              if(control.state==='return'){summary.reason='returned';return control;}
              if(['end','endBranch','endRun','stopped'].includes(control.state))return control;
              summary.completedIterations++;
            }
          }catch(error){
            if(frame.handling)throw error;
            if(error instanceof SimulationLoopExpiry){if(error.owner!==frame)throw error;return enterLoopHandler(frame,'local_deadline',depth);}
            if(error instanceof AutomationValueError&&!/LIMIT|BUDGET/.test(error.code)||error instanceof Error&&['SIMULATION_CONDITION_TYPE','SIMULATION_DEADLINE_EXCEEDED'].includes(error.message))return enterLoopHandler(frame,'evaluation_failed',depth);
            throw error;
          }finally{const index=activeLoops.indexOf(frame);if(index>=0)activeLoops.splice(index,1);}
          break;
        }
        case 'wait':{
          const now=simulatedNow(variables),value=evaluate(statement.duration??statement.until!,variables),next=statement.duration?now+Number(value.value)*1000:Date.parse(String(value.value));
          if(!Number.isFinite(next)||next<now||next-now>MAX_RUN_SECONDS*1000)throw new Error('SIMULATION_WAIT_LIMIT');
          if(next>effectiveDeadline())throw new Error('SIMULATION_DEADLINE_EXCEEDED');
          virtualClocks.set(variables,next);
          record.state='SIMULATED_WAIT';break;
        }
        case 'poll':{
          evaluate(statement.ticket,variables);
          const start=simulatedNow(variables),bounds=fixedPollBounds({maxAttempts:evaluate(statement.maxAttempts,variables),interval:evaluate(statement.interval,variables),until:evaluate(statement.until,variables)},new Date(effectiveDeadline()),plan.limits.maxListItems);
          let selected:'matched'|'exhausted'|'timedOut'='timedOut',last:EvaluatedValue|undefined;
          for(let attempt=0;attempt<bounds.maxAttempts;attempt++){
            if(start+attempt*bounds.intervalSeconds*1000>=Date.parse(bounds.deadline))break;
            virtualClocks.set(variables,start+attempt*bounds.intervalSeconds*1000);
            if(attempt>0)chargeTransition();
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
          if(until.type!=='Instant'||!Number.isFinite(deadline))throw new Error('SIMULATION_WAIT_LIMIT');
          if(deadline>effectiveDeadline())throw new Error('SIMULATION_DEADLINE_EXCEEDED');
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
          if(until.type!=='Instant'||!Number.isFinite(deadline))throw new Error('SIMULATION_WAIT_LIMIT');
          if(deadline>effectiveDeadline())throw new Error('SIMULATION_DEADLINE_EXCEEDED');
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
          if(statement.mode==='integer'||statement.mode==='decimal'){
            const min=evaluate(statement.min!,variables).value,max=evaluate(statement.max!,variables).value;
            if(typeof min!=='number'||typeof max!=='number'||!Number.isFinite(min)||!Number.isFinite(max)||statement.mode==='integer'&&(!Number.isSafeInteger(min)||!Number.isSafeInteger(max))||min>max)throw new Error('SIMULATION_RANDOM_RANGE');value=min;
          }else{
            const candidates=evaluate(statement.list!,variables).value;if(!Array.isArray(candidates))throw new Error('SIMULATION_LIST_REQUIRED');
            const size=statement.mode==='shuffle'?candidates.length:assertCount(evaluate(statement.count!,variables).value,plan.limits.maxListItems);if(size>candidates.length)throw new Error('SIMULATION_RANDOM_CANDIDATES');value=candidates.slice(0,size);
          }
          variables[statement.output.id]=mock({type:statement.output.type,value},false,true);record.state='MOCK_DRAW';break;
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
          const args=Object.fromEntries(Object.entries(statement.args).map(([id,value])=>[id,evaluate(value,variables)]));virtualClocks.set(args,simulatedNow(variables));let result:Control;
          try{result=walk(procedure.body,args,depth+1);}finally{virtualClocks.set(variables,simulatedNow(args));}
          if(result.state!=='return'){if(result.state==='stopped'||result.state==='endRun')return result;throw new Error('SIMULATION_RETURN_REQUIRED');}
          for(const [id,declaration] of Object.entries(statement.outputs)){const value=result.values?.[id];if(!value)throw new Error('SIMULATION_RETURN_REQUIRED');variables[declaration.id]=value;}break;
        }
        case 'return':return {state:'return',values:Object.fromEntries(Object.entries(statement.values).map(([id,value])=>[id,evaluate(value,variables)]))};
        case 'break':return {state:'break'};
        case 'continue':return {state:'next'};
        case 'end':return {state:uncertainty?'stopped':'end'};
        case 'endBranch':return {state:uncertainty?'stopped':'endBranch'};
        case 'endRun':return {state:uncertainty?'stopped':'endRun'};
        case 'parallel':{
          const results:Record<string,Record<string,EvaluatedValue>>={};
          const start=simulatedNow(variables);let finish=start;
          for(const branch of statement.branches){
            const isolated=structuredClone(variables);virtualClocks.set(isolated,start);let result:Control;
            try{result=walk(branch.body,isolated,depth+1);}finally{finish=Math.max(finish,simulatedNow(isolated));virtualClocks.set(variables,finish);}
            if(result.state==='stopped'||result.state==='endRun')return result;
            results[branch.id]=Object.fromEntries(Object.entries(branch.outputs??{}).map(([key,value])=>[key,evaluate(value,isolated)]));
          }
          virtualClocks.set(variables,finish);
          for(const [variableId,binding] of Object.entries(statement.outputs??{})){
            const value=results[binding.branchId]?.[binding.outputId];if(!value)throw new Error('SIMULATION_PARALLEL_OUTPUT_MISSING');variables[variableId]=value;
          }
          record.state='SIMULATED_ISOLATED_BRANCHES';break;
        }
        default:throw new Error('SIMULATION_STATEMENT_UNSUPPORTED');
      }
      captureInspection(variables,statement.id);
    }
    checkStops(variables);
    return {state:'continue'};
  }
  try {
    if(input.inspectVariables!==undefined){
      if(!Array.isArray(input.inspectVariables)||input.inspectVariables.length>plan.limits.maxVariables||input.inspectVariables.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))||new Set(input.inspectVariables).size!==input.inspectVariables.length)throw new Error('SIMULATION_INSPECTION_REQUEST');
      inspectVariables=[...input.inspectVariables];
      if(new TextEncoder().encode(JSON.stringify({mode:'SIMULATION_ONLY',values:[],unavailable:inspectVariables})).byteLength>plan.limits.maxValueBytes){inspectVariables=[];throw new Error('SIMULATION_INSPECTION_LIMIT');}
    }
    const declarations=plan.definition.trigger.kind==='manual'||plan.definition.trigger.kind==='internal'||plan.definition.trigger.kind==='interaction'||plan.definition.trigger.kind==='messageMetadata'?plan.definition.trigger.inputs:[];
    for(const declaration of declarations){const value=input.values?.[declaration.id];if(!value){status='UNDETERMINED';steps.push({blockId:declaration.id,kind:'input',state:'UNDETERMINED',code:'MOCK_INPUT_REQUIRED'});return result();}env[declaration.id]=mock({type:declaration.type,value:value.value});}
    walk(plan.definition.body,env,0);
  }catch(error){status=uncertainty?'UNKNOWN':'FAILED';steps.push({blockId:'simulation',kind:'error',state:status,code:error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error&&/^SIMULATION_[A-Z_]+$/.test(error.message)?error.message:'SIMULATION_INPUT_INVALID'});}
  return result();
  function result(){for(const item of iterations)item.counts=Object.fromEntries(['SUCCEEDED','FAILED','NOT_STARTED','SKIPPED','CANCELLED','UNKNOWN'].map(state=>[state,item.states.filter(value=>value===state).length]));return {mode:'SIMULATION' as const,status,externalChanges:0,productionRuns:0,approvalConsumption:0,productionDraws:0,steps,evaluations:budget.evaluations,plannedActions:actions,transitions,mocked:true,...(iterations.length?{iterations}:{}),...(loops.length?{loops}:{}),...(terminalReason?{terminalReason}:{}),...(inspectVariables.length?{inspection:{mode:'SIMULATION_ONLY' as const,values:inspectVariables.flatMap(id=>inspected.has(id)?[inspected.get(id)!]:[]),unavailable:inspectVariables.filter(id=>!inspected.has(id))}}:{})};}
}
