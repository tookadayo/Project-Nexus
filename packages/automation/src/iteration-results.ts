import type {EvaluatedValue,JsonValue,RecordSchema,ValueType} from './types';
import type {ResumeState,RuntimeContext,RuntimeFrame} from './store';
import {DEFAULT_AUTOMATION_LIMITS} from './types';

export const ITERATION_RESULT_SCHEMA='nexus.iteration-result.v1';
export const ITERATION_STATES=['SUCCEEDED','FAILED','NOT_STARTED','SKIPPED','CANCELLED','UNKNOWN'] as const;
export type IterationState=typeof ITERATION_STATES[number];
export const iterationResultType=(value:ValueType):ValueType=>({kind:'Record',schemaId:ITERATION_RESULT_SCHEMA,typeArgs:[structuredClone(value)]});
export function iterationResultSchema(type:ValueType):RecordSchema|undefined {
  if(typeof type==='string'||type.kind!=='Record'||type.schemaId!==ITERATION_RESULT_SCHEMA||type.typeArgs?.length!==1)return;
  return {userConstructible:false,fields:{index:{type:'Number'},state:{type:{kind:'Enum',values:[...ITERATION_STATES]}},outcome:{type:{kind:'OperationOutcome',value:type.typeArgs[0]!}}}};
}
export function validIterationResult(type:ValueType,value:JsonValue):boolean {
  if(typeof type==='string'||type.kind!=='Record'||type.schemaId!==ITERATION_RESULT_SCHEMA)return true;
  if(value===null||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.index)||Number(value.index)<1||!ITERATION_STATES.includes(value.state as IterationState))return false;
  const outcome=value.outcome;
  if(outcome===null||typeof outcome!=='object'||Array.isArray(outcome))return false;
  return value.state==='SUCCEEDED'?outcome.state==='SUCCEEDED':value.state==='SKIPPED'||value.state==='CANCELLED'?outcome.state==='NOT_STARTED'&&outcome.reason==='ITERATION_'+value.state:outcome.state===value.state;
}
export function iterationRow(index:number,state:IterationState,value?:EvaluatedValue):JsonValue {
  if(state==='SUCCEEDED'&&!value)throw new Error('AUTOMATION_ITERATION_OUTPUT_MISSING');
  return {index,state,outcome:state==='SUCCEEDED'?{state,value:value!.value}:{state:state==='SKIPPED'||state==='CANCELLED'?'NOT_STARTED':state,reason:'ITERATION_'+state}};
}
export function iterationList(type:ValueType,size:number,guildId:string):EvaluatedValue {
  return {type:{kind:'List',element:iterationResultType(type)},value:Array.from({length:size},(_,index)=>iterationRow(index+1,'NOT_STARTED')),provenance:[{source:'service',guildId,resumable:true,evidence:'operation'}]};
}
function contexts(root:RuntimeContext):RuntimeContext[]{return [root,...(root.parallel?.branches??[]).flatMap(branch=>contexts(branch.context))];}
function environments(context:RuntimeContext):Record<string,EvaluatedValue>[] {return [context.variables,...context.frames.flatMap(frame=>frame.call?[frame.call.parentVariables]:[])];}
/** Snapshot rows are part of the bounded resume state, never diagnostic logs. */
export function markIteration(state:ResumeState,context:RuntimeContext,frame:RuntimeFrame,status:IterationState,values:Record<string,EvaluatedValue>={}):void {
  const loop=frame.loop;
  if(!loop?.resultIds?.length)return;
  const actual=loop.outcome??status;
  for(const id of loop.resultIds){
    const list=environments(context).find(env=>Object.hasOwn(env,id))?.[id];
    if(!list||!Array.isArray(list.value))throw new Error('AUTOMATION_ITERATION_CURSOR_INVALID');
    const old=list.value[loop.iteration];
    if(old===null||typeof old!=='object'||Array.isArray(old))throw new Error('AUTOMATION_ITERATION_CURSOR_INVALID');
    if(old.state==='NOT_STARTED')list.value[loop.iteration]=iterationRow(loop.iteration+1,actual,actual==='SUCCEEDED'?values[id]:undefined);
    if(actual==='SUCCEEDED'&&values[id])list.provenance.push(...values[id]!.provenance);
  }
  const summary=state.iterations?.find(item=>item.identity===loop.resultIdentity);
  if(summary&&summary.states[loop.iteration]==='NOT_STARTED')summary.states[loop.iteration]=actual;
}
/** A known failed operation cannot be relabelled success by a later handler. */
export function noteIterationOperation(context:RuntimeContext,status:'FAILED'|'NOT_STARTED'|'UNKNOWN',root:RuntimeContext=context):void {
  const ancestors=(candidate:RuntimeContext):RuntimeContext[]=>candidate===context?[candidate]:(candidate.parallel?.branches??[]).flatMap(branch=>{const found=ancestors(branch.context);return found.length?[candidate,...found]:[];});
  for(const frame of ancestors(root).flatMap(candidate=>candidate.frames))if(frame.loop){
    const rank={NOT_STARTED:1,FAILED:2,UNKNOWN:3};
    if(!frame.loop.outcome||rank[status]>rank[frame.loop.outcome])frame.loop.outcome=status;
  }
}
export function terminateIterationResults(state:ResumeState,status:string):void {
  const result:IterationState=status==='COMPLETED'?'SKIPPED':'CANCELLED';
  for(const context of contexts(state))for(const frame of context.frames)if(frame.loop)markIteration(state,context,frame,result);
}
/** Terminal runs never resume. If a fence adds metadata at the byte boundary,
 * retain status evidence and discard the now-unneeded execution payload. */
export function boundedTerminalCheckpoint(state:ResumeState,status:string,maxBytes=DEFAULT_AUTOMATION_LIMITS.maxValueBytes):ResumeState {
  terminateIterationResults(state,status);
  const bytes=(value:ResumeState)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if(bytes(state)<=maxBytes)return state;
  const minimal:ResumeState={startedAt:state.startedAt,steps:state.steps,evaluations:state.evaluations,externalActions:state.externalActions,frames:[],variables:{},...(state.iterations?{iterations:state.iterations}:{}),...(state.uncertainty?{uncertainty:state.uncertainty}:{})};
  if(bytes(minimal)>maxBytes)throw new Error('AUTOMATION_STATE_LIMIT');
  return minimal;
}
/** Only identifiers and states; no output payloads, item values or variable contents. */
export function iterationRunStatus(state:ResumeState){return (state.iterations??[]).map(item=>({blockId:item.blockId,identity:item.identity,states:[...item.states],counts:Object.fromEntries(ITERATION_STATES.map(status=>[status,item.states.filter(value=>value===status).length]))}));}
