import {randomInt,randomBytes} from 'node:crypto';
import {sql,tenant,privacyReadLock,type Database,type Tx} from '../../db/src/index';
import {assert,isDomainError,type Scope} from '../../shared/src/index';
import {betaWork,betaAccess} from '../../security/src/hosted-beta';
import {compileFlowDefinition} from './definition';
import {scratchNumericOptions} from './scratch-math-server';
import {evaluateValue,assertValueMatchesType,AutomationValueError} from './expression';
import type {ActionOperation,EvaluatedValue,ExecutionPlan,FlowDefinition,JsonValue,Statement,ValueInput,VariableDeclaration} from './types';
import {MAX_WAIT_SECONDS} from './types';
import {AutomationStore,automationDispatchCheckpoint,fingerprint,type OperationOutcome,type ResumeState,type RunRecord,type RuntimeFrame,type RuntimeContext} from './store';
import {automationLock,consumeAutomationQuota,type AutomationAdmissionLimits} from './quota';
import {assertParallelCheckpoint,forkParallel,nextRuntimeContext,parallelPause,runtimeContexts} from './parallel';
import {ACTION_DEFINITIONS} from './catalog';
import {runBuiltinValues} from './builtins';
import {fixedPollBounds} from './poll';
import {AutomationAwaits} from './await';
import {iterationList,markIteration,noteIterationOperation} from './iteration-results';
import {isUncertaintySafe,safeResultReason} from './results';
import {boundedLoopDecision,effectiveLoopDeadline,expiredLoopOwner,isLocalDeadlineSafe,isAutomationBudgetStop,LOOP_HANDLER_KEYS,nearestBoundedLoopOwner,LoopDeadlineConflict,type BoundedLoop,type LoopFailureReason} from './bounded-loop';
import {RandomTapeStore,type StoredRandomTapeInput,type RandomTapeRecord} from './random-tape-store';
import {planRandomTape,prepareRandomTape,evaluateRandomTape,type RandomTapeInput} from './scratch-random';

export interface AutomationOperationContext {scope:Scope;runId:string;identity:string;operation:ActionOperation;inputs:Record<string,EvaluatedValue>;targets:NonNullable<FlowDefinition['targets']>;approvalRequired:boolean;approval?:{id:string;fingerprint:string;expiresAt:string};}
export interface AutomationRuntimeAdapter {
  /** Re-fetch the encrypted activating user's current membership and permissions.
   * This must never treat the stored actor hash as an enduring grant. */
  authorize(scope:Scope,run:RunRecord):Promise<void>;
  /** Current ticket entitlement, logical retention and native channel visibility,
   * in the caller's privacy-fenced transaction. Used by CT05 and cached CT11 reads. */
  authorizeAwait?(tx:Tx,scope:Scope,run:RunRecord,ticketId:string):Promise<{allowedChannelIds:string[]}>;
  execute(context:AutomationOperationContext):Promise<OperationOutcome>;
}
export interface AutomationRuntimeOptions {admission:AutomationAdmissionLimits;adapter:AutomationRuntimeAdapter;now?:()=>Date;scratchRandomAttempts?:number;}
function valueAtPath(definition:FlowDefinition,path:string):unknown {
  let value:unknown=definition;
  for(const part of path.split('/')){
    assert(value!==null&&typeof value==='object'&&Object.hasOwn(value,part),'AUTOMATION_CURSOR_INVALID');
    value=(value as Record<string,unknown>)[part];
  }
  return value;
}
function statements(definition:FlowDefinition,path:string):Statement[] {
  const value=valueAtPath(definition,path);assert(Array.isArray(value),'AUTOMATION_CURSOR_INVALID');return value as Statement[];
}
export function dynamicExecutionIdentity(run:Pick<RunRecord,'id'|'revision'|'semantic_hash'>,frames:RuntimeFrame[],blockId:string,branchIdentity?:string) {
  return fingerprint({runId:run.id,revision:run.revision,hash:run.semantic_hash,blockId,...(branchIdentity?{branchIdentity}:{}),path:frames.map(frame=>({path:frame.path,index:frame.index,iteration:frame.loop?.iteration??frame.boundedLoop?.completed??null}))});
}
function count(value:EvaluatedValue,max:number) {assert(value.type==='Number'&&typeof value.value==='number'&&Number.isSafeInteger(value.value)&&value.value>=0&&value.value<=max,'AUTOMATION_COUNT_INVALID');return value.value;}
function clearLocals(state:RuntimeContext,frame:RuntimeFrame) {for(const id of frame.locals)delete state.variables[id];if(state.readonlyVariables)state.readonlyVariables=state.readonlyVariables.filter(id=>!frame.locals.includes(id));frame.locals=[];}
function assignLocal(state:RuntimeContext,frame:RuntimeFrame,variable:VariableDeclaration,value:EvaluatedValue) {
  assert(JSON.stringify(variable.type)===JSON.stringify(value.type),'AUTOMATION_TYPE_MISMATCH');
  assert(!Object.hasOwn(state.variables,variable.id),'AUTOMATION_VARIABLE_DUPLICATE');
  state.variables[variable.id]=value;frame.locals.push(variable.id);
}
export class AutomationRuntime {
  readonly store:AutomationStore;
  readonly awaits:AutomationAwaits;
  private readonly now:()=>Date;
  constructor(readonly db:Database,readonly options:AutomationRuntimeOptions) {this.now=options.now??(()=>new Date());this.store=new AutomationStore(db,this.now);this.awaits=new AutomationAwaits(db,{now:this.now,authorize:async(tx,s,run,ticketId)=>{assert(this.options.adapter.authorizeAwait,'AUTOMATION_AWAIT_UNAVAILABLE',503);return this.options.adapter.authorizeAwait(tx,s,run,ticketId);}});}
  async tick(s:Scope,runId:string,maxSteps=100) {
    assert(Number.isSafeInteger(maxSteps)&&maxSteps>0&&maxSteps<=1000,'AUTOMATION_TICK_LIMIT');
    return this.store.withRunLock(s,runId,async()=>{
      let run=await this.store.run(s,runId);assert(run,'AUTOMATION_RUN_NOT_FOUND',404);
      if(run.ended_at)return {id:runId,state:run.status};
      const waitingTermination=run.resume.loopTermination;
      if(!run.cancel_requested_at&&run.deadline_at>this.now()&&run.wake_at&&run.wake_at>this.now()&&!expiredLoopOwner(run.resume,this.now(),waitingTermination?runtimeContexts(run.resume).find(candidate=>candidate.identity===waitingTermination.contextIdentity):undefined))return {id:runId,state:run.status};
      const source=(await sql<{definition:FlowDefinition}>`SELECT definition FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${run.flow_id} AND revision=${run.revision}`.execute(this.db)).rows[0];
      assert(source,'AUTOMATION_REVISION_NOT_FOUND',404);
      let numeric:Awaited<ReturnType<typeof scratchNumericOptions>>;
      try{numeric=await scratchNumericOptions(source.definition);}
      catch{
        // Initialization needs no external dispatch. Resolve a fresh row through
        // the usual checkpoint fence, which gives UNKNOWN, cancellation and the
        // run deadline precedence over a numerical-engine failure.
        const current=await this.store.run(s,runId);
        if(!current)return {id:runId,state:'DELETED'};
        if(!current.ended_at)await this.store.save(s,runId,structuredClone(current.resume),'FAILED',null,'AUTOMATION_NUMERIC_ENGINE_UNAVAILABLE',this.now());
        return {id:runId,state:(await this.store.run(s,runId))?.status??'DELETED'};
      }
      const plan=compileFlowDefinition(source.definition,{...numeric,temporalResolution:'fixed'});assert(plan.semanticHash===run.semantic_hash,'AUTOMATION_REVISION_CORRUPT');
      const state=structuredClone(run.resume);
      if(plan.definition.semanticProfile==='scratch.v1'){assert(state.semanticProfile===undefined||state.semanticProfile==='scratch.v1','AUTOMATION_SEMANTIC_PROFILE');state.semanticProfile='scratch.v1';}
      let context:RuntimeContext=state;
      const evaluate=(input:ValueInput)=>{
        const budget={evaluations:state.evaluations};
        try{return evaluateValue(input,{guildId:s.guildId,semanticProfile:plan.definition.semanticProfile,numericMath:numeric.numericMath,temporalResolution:'fixed',variables:{...context.variables,...runBuiltinValues(s.guildId,run!.started_at.toISOString())},limits:plan.limits,budget,pureDefinitions:plan.definition.pureDefinitions});}
        finally{state.evaluations=budget.evaluations;}
      };
      try {
        assertParallelCheckpoint(state,plan.limits);
        const interrupted=(await sql<{identity:string;state:'STARTED'|'UNKNOWN';reason:string|null}>`SELECT identity,state,reason FROM automation_operations WHERE ${tenant(s)} AND run_id=${runId}::uuid AND state IN ('STARTED','UNKNOWN')`.execute(this.db)).rows;
        if(interrupted.length){
          await sql`UPDATE automation_operations SET state='UNKNOWN',reason='WORKER_INTERRUPTED',finished_at=${this.now()} WHERE ${tenant(s)} AND run_id=${runId}::uuid AND state='STARTED'`.execute(this.db);
          if(!this.restoreUncertainty(s,run,plan,state,interrupted)){
            await this.store.save(s,runId,state,'UNKNOWN',null,'WORKER_INTERRUPTED',this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};
          }
        }
        if(run.cancel_requested_at||this.now()>=run.deadline_at){
          await this.store.save(s,runId,state,run.cancel_requested_at?'CANCELLED':'EXPIRED',null,run.cancel_requested_at?'CANCEL_REQUESTED':'RUN_DEADLINE',this.now());
          return {id:runId,state:(await this.store.run(s,runId))!.status};
        }
        await this.db.transaction().execute(async tx=>{await privacyReadLock(tx,s);await betaAccess(tx,s,'work',run!.beta_generation);await automationLock(tx,s);await consumeAutomationQuota(tx,s,runId,this.options.admission,this.now());});
        for(let step=0;step<maxSteps;step++){
          run=(await this.store.run(s,runId))!;
          if(!run)return {id:runId,state:'DELETED'};
          if(run.ended_at)return {id:runId,state:run.status};
          if(run.cancel_requested_at){await this.store.save(s,runId,state,'CANCELLED',null,'CANCEL_REQUESTED',this.now());break;}
          if(this.now()>=run.deadline_at){await this.store.save(s,runId,state,'EXPIRED',null,'RUN_DEADLINE',this.now());break;}
          const terminalContext=state.loopTermination?runtimeContexts(state).find(candidate=>candidate.identity===state.loopTermination!.contextIdentity):undefined;
          const expiredOwner=expiredLoopOwner(state,this.now(),terminalContext);
          if(expiredOwner){
            context=expiredOwner.context;
            if(!await this.enterLoopHandler(s,run,plan,state,context,expiredOwner.index,'local_deadline'))return {id:runId,state:(await this.store.run(s,runId))!.status};
            this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');continue;
          }
          if(!state.uncertainty){await this.options.adapter.authorize(s,run);
            const flow=(await sql<{state:string}>`SELECT state FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id}`.execute(this.db)).rows[0];
            assert(flow?.state==='ACTIVE','AUTOMATION_STOPPED');}
          const selected=state.uncertainty?runtimeContexts(state).find(candidate=>candidate.identity===state.uncertainty!.contextIdentity):await nextRuntimeContext(terminalContext??state,this.now(),async identity=>{const approval=await this.store.approval(s,runId,identity);return !approval||approval.state!=='PENDING'||approval.expires_at<=this.now();},(parent,group)=>{
            const statement=valueAtPath(plan.definition,group.nodePath) as Extract<Statement,{kind:'parallel'}>;
            assert(statement?.kind==='parallel','AUTOMATION_PARALLEL_CURSOR_INVALID');
            const updates:Record<string,EvaluatedValue>={};
            for(const [variableId,binding] of Object.entries(statement.outputs??{})){
              const value=group.branches.find(branch=>branch.id===binding.branchId)?.context.outputs?.[binding.outputId],old=parent.variables[variableId];
              assert(value&&old,'AUTOMATION_PARALLEL_OUTPUT_MISSING');
              assert(!parent.readonlyVariables?.includes(variableId)&&JSON.stringify(old.type)===JSON.stringify(value.type),'AUTOMATION_PARALLEL_OUTPUT_INVALID');
              updates[variableId]=value;
            }
            Object.assign(parent.variables,updates);
          },async identity=>{const row=(await sql<{state:string;expires_at:Date}>`SELECT state,expires_at FROM automation_event_waits WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(this.db)).rows[0];return !row||row.state!=='PENDING'||row.expires_at<=this.now();});
          if(!selected){
            if(state.uncertainty){await this.store.save(s,runId,state,'UNKNOWN',null,state.uncertainty.reason,this.now());return {id:runId,state:'UNKNOWN'};}
            this.resumable(state,plan);
            if(state.loopTermination&&terminalContext&&!terminalContext.frames.length&&!terminalContext.parallel){await this.store.save(s,runId,state,'FAILED',null,'LOOP_'+state.loopTermination.reason.toUpperCase(),this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
            const pause=parallelPause(terminalContext??state,this.now());
            const deadlines=runtimeContexts(terminalContext??state).flatMap(candidate=>candidate.frames.flatMap(frame=>frame.boundedLoop?.deadline?[Date.parse(frame.boundedLoop.deadline)]:[]));
            if(state.loopTermination&&terminalContext)deadlines.push(effectiveLoopDeadline(state,terminalContext,run.deadline_at).getTime());
            if(deadlines.length){const earliest=Math.min(...deadlines,...(pause.wakeAt?[pause.wakeAt.getTime()]:[]));pause.wakeAt=new Date(earliest);}
            const status=!state.frames.length&&!state.parallel?'COMPLETED':pause.state;
            await this.store.save(s,runId,state,status,status==='COMPLETED'?null:pause.wakeAt,null,this.now());
            const stored=(await this.store.run(s,runId))!;return {id:runId,state:stored.status,...(stored.wake_at?{dueAt:stored.wake_at.toISOString()}:{})};
          }
          context=selected;
          if(state.uncertainty&&!context.frames.length){await this.store.save(s,runId,state,'UNKNOWN',null,state.uncertainty.reason,this.now());return {id:runId,state:'UNKNOWN'};}
          const frame=context.frames.at(-1)!;
          if(frame.boundedLoop){
            const loop=frame.boundedLoop,loopStatement=valueAtPath(plan.definition,loop.nodePath) as BoundedLoop;
            assert(loop.version===1&&loopStatement.kind==='boundedLoop'&&loopStatement.semanticVersion===1,'AUTOMATION_LOOP_CURSOR_INVALID');
            if(loop.phase==='guard'){
              state.steps++;assert(state.steps<=plan.limits.maxExpandedSteps,'AUTOMATION_STEP_LIMIT');
              let decision:ReturnType<typeof boundedLoopDecision>;
              try{const condition=evaluate(loopStatement.condition);assert(condition.type==='Boolean'||condition.type==='ConditionResult','AUTOMATION_CONDITION_INVALID');decision=boundedLoopDecision(loopStatement.mode,loop.completed,loop.maxBody,condition.value as boolean|'true'|'false'|'unknown');}
              catch(error){if(state.loopTermination||error instanceof AutomationValueError&&/LIMIT|BUDGET/.test(error.code)||!(error instanceof AutomationValueError)&&!(isDomainError(error)&&error.code==='AUTOMATION_CONDITION_INVALID'))throw error;
                if(!await this.enterLoopHandler(s,run,plan,state,context,context.frames.length-1,'evaluation_failed'))return {id:runId,state:(await this.store.run(s,runId))!.status};
                this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');continue;}
              if(decision==='complete'){clearLocals(context,frame);context.frames.pop();}
              else if(decision==='body'){loop.phase='body';frame.index=0;}
              else if(!await this.enterLoopHandler(s,run,plan,state,context,context.frames.length-1,decision))return {id:runId,state:(await this.store.run(s,runId))!.status};
              this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');continue;
            }
          }
          const body=statements(plan.definition,frame.path),statement=body[frame.index];
          if(!statement){
            if(frame.boundedLoop){clearLocals(context,frame);frame.boundedLoop.completed++;frame.boundedLoop.phase='guard';frame.index=0;this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');continue;}
            if(frame.loop&&!frame.loop.completed){
              const loopStatement=valueAtPath(plan.definition,frame.loop.nodePath) as Extract<Statement,{kind:'repeat'}>;
              const values=frame.loop.skipped?{}:Object.fromEntries((loopStatement.results??[]).map(result=>[result.output.id,evaluate(result.value)]));
              markIteration(state,context,frame,frame.loop.skipped?'SKIPPED':'SUCCEEDED',values);
              frame.loop.completed=true;
              this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');
            }
            if(frame.loop){
              if(frame.loop.outcome){await this.store.save(s,runId,state,frame.loop.outcome==='UNKNOWN'?'UNKNOWN':'FAILED',null,'ITERATION_'+frame.loop.outcome,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
            }
            if(frame.loop&&frame.loop.iteration+1<frame.loop.items.length){
              clearLocals(context,frame);frame.loop.iteration++;frame.index=0;
              delete frame.loop.outcome;delete frame.loop.skipped;
              delete frame.loop.completed;
              this.loopInputs(plan,context,frame);
              if(frame.loop.resultIds?.length){this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');}
              continue;
            }
            assert(!frame.call,'AUTOMATION_RETURN_REQUIRED');
            if(frame.branch){
              const branch=valueAtPath(plan.definition,frame.branch.nodePath) as Extract<Statement,{kind:'parallel'}>['branches'][number];
              context.outputs=Object.fromEntries(Object.entries(branch.outputs??{}).map(([key,input])=>[key,evaluate(input)]));
            }
            clearLocals(context,frame);context.frames.pop();
            if(frame.uncertaintyBoundary){await this.store.save(s,runId,state,'UNKNOWN',null,state.uncertainty!.reason,this.now());return {id:runId,state:'UNKNOWN'};}
            if(frame.terminalAfter){await this.store.save(s,runId,state,frame.terminalAfter.status,null,frame.terminalAfter.reason,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
            continue;
          }
          if(statement.enabled===false){frame.index++;continue;}
          const path=frame.path+'/'+frame.index,baseIdentity=dynamicExecutionIdentity(run,context.frames,statement.id,context.identity),identity=statement.kind==='poll'?fingerprint({poll:baseIdentity,attempt:frame.poll?.attempts??0}):baseIdentity;
          if(state.uncertainty)assert(state.uncertainty.phase==='CAPTURED'?statement.kind==='resultBranch'&&path+'/unknown'===state.uncertainty.handlerPath:isUncertaintySafe(statement),'AUTOMATION_UNCERTAINTY_EFFECT');
          if(state.loopTermination?.pure)assert(isLocalDeadlineSafe(statement),'AUTOMATION_LOCAL_DEADLINE_EFFECT');
          if(context.chargedStepIdentity!==identity){state.steps++;context.chargedStepIdentity=identity;}
          assert(state.steps<=plan.limits.maxExpandedSteps,'AUTOMATION_STEP_LIMIT');
          switch(statement.kind){
            case 'declare':assignLocal(context,frame,statement.variable,evaluate(statement.value));frame.index++;break;
            case 'assign':{
              const old=context.variables[statement.variableId];assert(old,'AUTOMATION_VARIABLE_UNINITIALIZED');
              assert(!context.readonlyVariables?.includes(statement.variableId),'AUTOMATION_VARIABLE_READONLY');
              const next=evaluate(statement.value);assert(JSON.stringify(old.type)===JSON.stringify(next.type),'AUTOMATION_TYPE_MISMATCH');context.variables[statement.variableId]=next;frame.index++;break;
            }
            case 'branch':{
              const condition=evaluate(statement.condition);assert(condition.type==='Boolean'||condition.type==='ConditionResult','AUTOMATION_CONDITION_INVALID');
              const branch=condition.value===true||condition.value==='true'?'then':condition.value===false||condition.value==='false'?'otherwise':'unknown';
              frame.index++;context.frames.push({path:path+'/'+branch,index:0,locals:[]});break;
            }
            case 'switch':{
              const choice=evaluate(statement.value),index=statement.cases.findIndex(item=>item.value===choice.value);assert(index>=0,'AUTOMATION_CHOICE_UNHANDLED');
              frame.index++;context.frames.push({path:path+'/cases/'+index+'/body',index:0,locals:[]});break;
            }
            case 'optionalBranch':{
              const optional=evaluate(statement.value);assert(typeof optional.type==='object'&&optional.type.kind==='Optional'&&typeof optional.value==='object'&&optional.value!==null&&!Array.isArray(optional.value),'AUTOMATION_OPTIONAL_INVALID');
              const present=optional.value.state==='set',child:RuntimeFrame={path:path+'/'+(present?'present':'unset'),index:0,locals:[]};frame.index++;context.frames.push(child);
              if(present){assignLocal(context,child,statement.output,{type:optional.type.value,value:optional.value.value!,provenance:optional.provenance});context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.output.id])];}break;
            }
            case 'searchBranch':{
              const result=evaluate(statement.value);
              assert(typeof result.type==='object'&&result.type.kind==='Record'&&['nexus.index-result.v1','nexus.search-result.v1'].includes(result.type.schemaId)&&result.value!==null&&typeof result.value==='object'&&!Array.isArray(result.value),'AUTOMATION_SEARCH_RESULT_INVALID');
              const found=result.value.state==='found';assert(found||result.value.state==='not_found','AUTOMATION_SEARCH_RESULT_INVALID');
              const child:RuntimeFrame={path:path+'/'+(found?'found':'notFound'),index:0,locals:[]};frame.index++;context.frames.push(child);
              if(found){
                assert(typeof result.value.index==='number'&&Number.isSafeInteger(result.value.index)&&result.value.index>0,'AUTOMATION_SEARCH_RESULT_INVALID');
                assignLocal(context,child,statement.index,{type:'Number',value:result.value.index,provenance:result.provenance});
                const ids=[statement.index.id];
                if(statement.output){assert(result.type.schemaId==='nexus.search-result.v1'&&result.type.typeArgs?.[0]&&Object.hasOwn(result.value,'value'),'AUTOMATION_SEARCH_RESULT_INVALID');assignLocal(context,child,statement.output,{type:result.type.typeArgs[0],value:result.value.value!,provenance:result.provenance});ids.push(statement.output.id);}
                context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),...ids])];
              }break;
            }
            case 'resultBranch':{
              const result=evaluate(statement.value);assert(typeof result.type==='object'&&(result.type.kind==='ParseResult'||result.type.kind==='OperationOutcome')&&typeof result.value==='object'&&result.value!==null&&!Array.isArray(result.value),'AUTOMATION_RESULT_INVALID');
              const outcome=result.value,branch=outcome.state==='SUCCEEDED'?'succeeded':outcome.state==='FAILED'?'failed':outcome.state==='NOT_STARTED'?'notStarted':'unknown';
              if(branch==='unknown'){assert(state.uncertainty&&state.uncertainty.handlerPath===path+'/unknown','AUTOMATION_UNCERTAINTY_MISSING');state.uncertainty.phase='HANDLING';}
              const child:RuntimeFrame={path:path+'/'+branch,index:0,locals:[],...(branch==='unknown'?{uncertaintyBoundary:true}:{})};frame.index++;context.frames.push(child);
              if(branch==='succeeded'){assignLocal(context,child,statement.output,{type:result.type.value,value:outcome.value!,provenance:result.provenance});context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.output.id])];}
              else if(statement.reason){assignLocal(context,child,statement.reason,{type:'PlainText',value:outcome.reason!,provenance:result.provenance});context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.reason.id])];}break;
            }
            case 'boundedLoop':{
              assert(plan.definition.semanticProfile==='scratch.v1'&&statement.semanticVersion===1,'AUTOMATION_SEMANTIC_PROFILE');
              const maximum=count(evaluate(statement.maxBody),plan.limits.maxExpandedSteps);
              const until=evaluate(statement.until);assert(until.type==='Instant'&&typeof until.value==='string'&&Number.isFinite(Date.parse(until.value)),'AUTOMATION_INSTANT_INVALID');
              const deadline=new Date(until.value);assert(deadline<=run.deadline_at,'AUTOMATION_DEADLINE_EXCEEDED');
              frame.index++;context.frames.push({path:path+'/body',index:0,locals:[],boundedLoop:{version:1,nodePath:path,identity,maxBody:maximum,completed:0,phase:'guard',deadline:deadline.toISOString()}});break;
            }
            case 'repeat':{
              let items:EvaluatedValue[];
              if(statement.count){const size=count(evaluate(statement.count),plan.limits.maxListItems);items=Array.from({length:size},(_,index)=>({type:'Number' as const,value:index+1,provenance:[{source:'service' as const,guildId:s.guildId}]}));}
              else{assert(statement.list,'AUTOMATION_INPUT_MISSING');const list=evaluate(statement.list);assert(typeof list.type==='object'&&list.type.kind==='List'&&Array.isArray(list.value),'AUTOMATION_LIST_INVALID');const type=list.type.element;items=list.value.map(value=>({type,value,provenance:list.provenance}));assert(items.length<=plan.limits.maxListItems,'AUTOMATION_LIST_LIMIT');}
              // Preflight the entire checkpoint before publishing any result
              // declaration, item snapshot or metadata into live resume state.
              const candidate=structuredClone(state),candidateContext=runtimeContexts(candidate).find(item=>item.identity===context.identity)!;
              const parent=candidateContext.frames.at(-1)!;parent.index++;
              for(const result of statement.results??[]){assignLocal(candidateContext,parent,result.output,iterationList(result.value.type,items.length,s.guildId));candidateContext.readonlyVariables=[...new Set([...(candidateContext.readonlyVariables??[]),result.output.id])];}
              if(statement.results?.length){candidate.iterations??=[];candidate.iterations.push({blockId:statement.id,identity,states:items.map(()=>'NOT_STARTED')});}
              if(items.length){const child:RuntimeFrame={path:path+'/body',index:0,locals:[],loop:{nodePath:path,items,iteration:0,...(statement.results?.length?{resultIds:statement.results.map(result=>result.output.id),resultIdentity:identity}:{})}};candidateContext.frames.push(child);this.loopInputs(plan,candidateContext,child);}
              this.resumable(candidate,plan);
              const contextIdentity=context.identity;Object.assign(state,candidate);context=runtimeContexts(state).find(item=>item.identity===contextIdentity)!;
              break;
            }
            case 'wait':{
              const start=this.now();let milliseconds:number;
              if(statement.duration){const duration=evaluate(statement.duration);assert(duration.type==='Duration'&&typeof duration.value==='number','AUTOMATION_DURATION_INVALID');milliseconds=duration.value*1000;}
              else{assert(statement.until,'AUTOMATION_INPUT_MISSING');const instant=evaluate(statement.until);assert(instant.type==='Instant'&&typeof instant.value==='string','AUTOMATION_INSTANT_INVALID');milliseconds=new Date(instant.value).getTime()-start.getTime();}
              assert(Number.isFinite(milliseconds)&&milliseconds>=0&&milliseconds<=MAX_WAIT_SECONDS*1000,'AUTOMATION_WAIT_LIMIT');
              const wake=new Date(start.getTime()+milliseconds);assert(wake<=effectiveLoopDeadline(state,context,run.deadline_at),'AUTOMATION_DEADLINE_EXCEEDED');frame.index++;
              if(milliseconds>0)context.waitUntil=wake.toISOString();break;
            }
            case 'poll':{
              if(!frame.poll){
                const ticket=evaluate(statement.ticket),bounds=fixedPollBounds({maxAttempts:evaluate(statement.maxAttempts),interval:evaluate(statement.interval),until:evaluate(statement.until)},effectiveLoopDeadline(state,context,run.deadline_at),plan.limits.maxListItems);
                assert(ticket.type==='TicketRef'&&!ticket.provenance.some(source=>source.sensitive||source.resumable===false),'AUTOMATION_INPUT_SENSITIVE');
                frame.poll={nodePath:path,ticket,...bounds,attempts:0};
              }
              const polling=frame.poll;assert(polling.nodePath===path,'AUTOMATION_POLL_CURSOR_INVALID');
              const enter=(branch:'matched'|'exhausted'|'timedOut',value?:EvaluatedValue)=>{
                frame.index++;delete frame.poll;
                const child:RuntimeFrame={path:path+'/'+branch,index:0,locals:[]};context.frames.push(child);
                if(value){assignLocal(context,child,statement.output,value);context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.output.id])];}
              };
              if(this.now()>=new Date(polling.deadline)){enter('timedOut');break;}
              assert(polling.attempts<polling.maxAttempts,'AUTOMATION_POLL_CURSOR_INVALID');
              const inputs={ticket:polling.ticket},old=await this.store.operation(s,runId,identity);let outcome:OperationOutcome;
              if(old){
                assert(old.fingerprint===fingerprint(inputs),'AUTOMATION_POLL_INPUT_CHANGED');
                outcome=old.state==='SUCCEEDED'?{state:'SUCCEEDED',...(old.result?{value:old.result}:{})}:{state:old.state==='STARTED'?'UNKNOWN':old.state,code:old.reason??'READ_UNAVAILABLE'};
              }else{
                this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');
                outcome=await betaWork(this.db,s,async()=>{
                  const current=await this.store.run(s,runId);assert(current,'AUTOMATION_RUN_NOT_FOUND',404);await this.options.adapter.authorize(s,current);
                  assert(this.now()<new Date(polling.deadline),'AUTOMATION_POLL_DEADLINE');
                  await this.store.beginOperation(s,runId,identity,'nexus.readTicket',fingerprint(inputs),effectiveLoopDeadline(state,context,current.deadline_at),this.now(),automationDispatchCheckpoint(state));
                  let result:OperationOutcome;
                  try{result=await this.options.adapter.execute({scope:s,runId,identity,operation:'nexus.readTicket',inputs,targets:plan.definition.targets??{channelIds:[],roleIds:[],parentCategoryIds:[]},approvalRequired:false});}
                  catch{result={state:'UNKNOWN',code:'CONNECTOR_RESULT_UNKNOWN'};}
                  await this.store.finishOperation(s,runId,identity,result);return result;
                },{generation:run.beta_generation});
              }
              if(outcome.state!=='SUCCEEDED'){
                noteIterationOperation(context,outcome.state,state);
                await this.store.event(s,runId,statement.id,outcome.state,outcome.code);
                await this.store.save(s,runId,state,outcome.state==='UNKNOWN'?'UNKNOWN':'FAILED',null,outcome.code,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};
              }
              const value=outcome.value;assert(value&&JSON.stringify(value.type)===JSON.stringify(ACTION_DEFINITIONS['nexus.readTicket'].outputType)&&value.provenance.some(source=>source.source==='service'&&source.guildId===s.guildId)&&!value.provenance.some(source=>source.sensitive||source.resumable===false),'AUTOMATION_ACTION_OUTPUT_INVALID');
              assertValueMatchesType(value.type,value.value,{guildId:s.guildId,limits:plan.limits,temporalResolution:'fixed'});
              const current=await this.store.run(s,runId);assert(current&&!current.ended_at&&!current.cancel_requested_at,'AUTOMATION_STOPPED');await this.options.adapter.authorize(s,current);
              if(old){
                const authorization=await this.db.transaction().execute(async tx=>{await privacyReadLock(tx,s);await betaAccess(tx,s,'work',current.beta_generation);assert(this.options.adapter.authorizeAwait,'AUTOMATION_POLL_AUTHORIZATION_UNAVAILABLE',503);const target=polling.ticket.value as {id:string};return this.options.adapter.authorizeAwait(tx,s,current,target.id);});
                assert(authorization&&Array.isArray(authorization.allowedChannelIds)&&authorization.allowedChannelIds.every(id=>/^\d{17,20}$/.test(id)),'AUTOMATION_POLL_AUTHORIZATION_UNAVAILABLE');
                value.provenance=[...value.provenance,{source:'service',guildId:s.guildId,resumable:true,allowedChannelIds:authorization.allowedChannelIds}];
              }
              polling.attempts++;
              context.variables[statement.output.id]=value;
              let matched:boolean;
              try{const condition=evaluate(statement.condition);assert(condition.type==='Boolean'&&typeof condition.value==='boolean','AUTOMATION_CONDITION_INVALID');matched=condition.value;}
              finally{delete context.variables[statement.output.id];}
              if(this.now()>=new Date(polling.deadline)){enter('timedOut');break;}
              if(matched){enter('matched',value);break;}
              if(polling.attempts>=polling.maxAttempts){enter('exhausted',value);break;}
              const finishedAt=this.now().getTime(),wake=new Date(Math.min(finishedAt+polling.intervalSeconds*1000,Date.parse(polling.deadline)));
              assert(wake.getTime()>finishedAt,'AUTOMATION_POLL_INTERVAL');context.waitUntil=wake.toISOString();break;
            }
            case 'awaitEvent':{
              if(!frame.await){
                const ticket=evaluate(statement.ticket),until=evaluate(statement.until);
                assert(![ticket,until].some(value=>value.provenance.some(source=>source.sensitive||source.resumable===false)),'AUTOMATION_STATE_NOT_RESUMABLE');
                assert(ticket.type==='TicketRef'&&typeof ticket.value==='object'&&ticket.value!==null&&!Array.isArray(ticket.value)&&typeof ticket.value.id==='string','AUTOMATION_REFERENCE_INVALID');
                assert(until.type==='Instant'&&typeof until.value==='string'&&Number.isFinite(Date.parse(until.value)),'AUTOMATION_INSTANT_INVALID');
                assert(new Date(until.value)<=effectiveLoopDeadline(state,context,run.deadline_at),'AUTOMATION_DEADLINE_EXCEEDED');
                frame.await={identity,ticket,deadline:new Date(until.value).toISOString()};
              }
              const awaiting=frame.await;assert(awaiting.identity===identity,'AUTOMATION_AWAIT_CURSOR_INVALID');
              const enter=(branch:'matched'|'timedOut',value?:EvaluatedValue)=>{
                frame.index++;delete frame.await;delete context.awaitIdentity;delete context.awaitDeadline;
                const child:RuntimeFrame={path:path+'/'+branch,index:0,locals:[]};context.frames.push(child);
                if(value){assignLocal(context,child,statement.output,value);context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.output.id])];state.pendingAwaitAcknowledgements=[...(state.pendingAwaitAcknowledgements??[]),identity];}
              };
              // An expiry before registration has no event, subscription or value.
              if(new Date(awaiting.deadline)<=this.now()&&!context.awaitIdentity){
                const existing=(await sql<{state:string}>`SELECT state FROM automation_event_waits WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(this.db)).rows[0];
                if(!existing){enter('timedOut');break;}
              }
              this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');
              const receipt=await this.awaits.register(s,runId,{identity,ticketId:(awaiting.ticket.value as {id:string}).id,event:statement.event,states:statement.states,expiresAt:new Date(awaiting.deadline)});
              if(receipt.state==='PENDING'){context.awaitIdentity=identity;context.awaitDeadline=receipt.expiresAt.toISOString();break;}
              if(receipt.state==='CANCELLED'){
                await this.store.save(s,runId,state,'CANCELLED',null,'AUTOMATION_STOPPED',this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};
              }
              if(receipt.state==='TIMED_OUT'){enter('timedOut');break;}
              assert(receipt.state==='MATCHED','AUTOMATION_AWAIT_CORRUPT');
              const value:EvaluatedValue={type:statement.output.type,value:receipt.value,provenance:[{source:'service',guildId:s.guildId,resumable:true,allowedChannelIds:receipt.allowedChannelIds}]};
              assertValueMatchesType(value.type,value.value,{guildId:s.guildId,limits:plan.limits,temporalResolution:'fixed'});enter('matched',value);break;
            }
            case 'random':{
              if(plan.definition.semanticProfile==='scratch.v1'){
                const attempts=this.options.scratchRandomAttempts;
                assert(attempts&&Number.isSafeInteger(attempts)&&attempts>0,'AUTOMATION_RANDOM_CAPACITY_UNMEASURED');
                const tapes=new RandomTapeStore(this.db,this.now);
                this.resumable(state,plan);
                let record:RandomTapeRecord;
                try{record=await tapes.prepare(s,runId,identity,state,fingerprint(run.resume),plan.limits.maxValueBytes,available=>{
                  let input:RandomTapeInput,provenance:EvaluatedValue['provenance'];
                  if(statement.mode==='integer'||statement.mode==='decimal'){
                    assert(statement.min&&statement.max,'AUTOMATION_INPUT_MISSING');
                    const lower=evaluate(statement.min),upper=evaluate(statement.max);
                    assert(lower.type==='Number'&&upper.type==='Number'&&typeof lower.value==='number'&&typeof upper.value==='number','AUTOMATION_RANDOM_RANGE');
                    input={mode:statement.mode,lower:lower.value,upper:upper.value};provenance=[...lower.provenance,...upper.provenance];
                  }else{
                    assert(statement.list,'AUTOMATION_INPUT_MISSING');const list=evaluate(statement.list);assert(Array.isArray(list.value),'AUTOMATION_LIST_INVALID');
                    const requested=statement.mode==='sample'?evaluate(statement.count!):undefined;
                    input=statement.mode==='sample'?{mode:'sample',candidates:list.value,count:count(requested!,plan.limits.maxListItems)}:{mode:'shuffle',candidates:list.value};
                    provenance=[...list.provenance,...(requested?.provenance??[])];
                  }
                  assert(!provenance.some(source=>source.sensitive||source.resumable===false),'AUTOMATION_RANDOM_NOT_RESUMABLE');
                  const planned=planRandomTape(input,attempts),remaining=plan.limits.maxEvaluations-state.evaluations;
                  assert(planned.reservedTrials<=remaining,'AUTOMATION_EVALUATION_LIMIT');
                  // Reserve trial and material capacity before calling the bit source.
                  const shell:Omit<StoredRandomTapeInput,'material'>={version:1,type:statement.output.type,provenance:[...provenance,{source:'service',guildId:s.guildId,resumable:true}]};
                  const overhead=Buffer.byteLength(JSON.stringify({...shell,material:null}))+Buffer.byteLength(JSON.stringify({state:'SUCCEEDED',value:null,consumedTrials:planned.reservedTrials}));
                  const material=prepareRandomTape(planned,{id:identity,maxMaterialBytes:available-overhead,maxCandidateTrials:Math.max(1,remaining)},bytes=>randomBytes(bytes));
                  state.evaluations+=planned.reservedTrials;
                  return {...shell,material};
                },this.now(),effectiveLoopDeadline(state,context,run.deadline_at));}
                catch(error){if(isDomainError(error)||error instanceof AutomationValueError)throw error;const known=await tapes.reconcile(s,runId,identity);if(!known)throw error;return {id:runId,state:known.run.status};}
                if(record.result.state==='PREPARED'){
                  try{record=await tapes.reserveEvaluation(s,runId,identity,record.fingerprint,state,plan.limits.maxEvaluations,plan.limits.maxValueBytes,this.now(),effectiveLoopDeadline(state,context,run.deadline_at));}
                  catch(error){if(isDomainError(error)||error instanceof AutomationValueError)throw error;const known=await tapes.reconcile(s,runId,identity,record.fingerprint);if(!known)throw error;return {id:runId,state:known.run.status};}
                }
                const outcome=record.result.state==='PREPARED'?evaluateRandomTape(record.input.material):record.result;
                if(outcome.state==='SUCCEEDED'){
                  const result:EvaluatedValue={type:record.input.type,value:outcome.value,provenance:record.input.provenance};
                  assertValueMatchesType(statement.output.type,result.value,{guildId:s.guildId,limits:plan.limits,semanticProfile:plan.definition.semanticProfile,temporalResolution:'fixed'});
                  assignLocal(context,frame,statement.output,result);frame.index++;delete context.chargedStepIdentity;
                  this.resumable(state,plan);
                  try{await tapes.complete(s,runId,identity,record.fingerprint,outcome,state,plan.limits.maxValueBytes,this.now(),effectiveLoopDeadline(state,context,run.deadline_at));}
                  catch(error){if(isDomainError(error)||error instanceof AutomationValueError)throw error;const known=await tapes.reconcile(s,runId,identity,record.fingerprint);if(!known)throw error;return {id:runId,state:known.run.status};}
                }else{
                  try{await tapes.complete(s,runId,identity,record.fingerprint,outcome,state,plan.limits.maxValueBytes,this.now(),effectiveLoopDeadline(state,context,run.deadline_at));}
                  catch(error){if(isDomainError(error)||error instanceof AutomationValueError)throw error;const known=await tapes.reconcile(s,runId,identity,record.fingerprint);if(!known)throw error;return {id:runId,state:known.run.status};}
                  throw new AutomationValueError('RANDOM_SAMPLING_EXHAUSTED','The fixed random trial budget was exhausted.');
                }
                break;
              }
              const committed=await this.store.randomOnce(s,runId,identity,()=>{
                let input:JsonValue,result:JsonValue;let provenance:EvaluatedValue['provenance'];
                if(statement.mode==='integer'){
                  assert(statement.min&&statement.max,'AUTOMATION_INPUT_MISSING');const lower=evaluate(statement.min),upper=evaluate(statement.max);
                  assert(lower.type==='Number'&&upper.type==='Number'&&typeof lower.value==='number'&&typeof upper.value==='number'&&Number.isSafeInteger(lower.value)&&Number.isSafeInteger(upper.value)&&lower.value<=upper.value&&upper.value-lower.value<281474976710655,'AUTOMATION_RANDOM_RANGE');
                  provenance=[...lower.provenance,...upper.provenance];
                  input={mode:'integer',lower:lower.value,upper:upper.value};result=lower.value===upper.value?lower.value:randomInt(lower.value,upper.value+1);
                }else{
                  assert(statement.list,'AUTOMATION_INPUT_MISSING');const list=evaluate(statement.list);assert(Array.isArray(list.value),'AUTOMATION_LIST_INVALID');
                  const requested=statement.mode==='shuffle'?null:evaluate(statement.count!);
                  const size=requested?count(requested,plan.limits.maxListItems):list.value.length;
                  provenance=[...list.provenance,...(requested?.provenance??[])];
                  assert(size<=list.value.length,'AUTOMATION_RANDOM_CANDIDATES');input={mode:statement.mode,candidates:list.value,count:size};
                  const shuffled=[...list.value];for(let index=shuffled.length-1;index>0;index--){const next=randomInt(index+1);[shuffled[index],shuffled[next]]=[shuffled[next]!,shuffled[index]!];}result=shuffled.slice(0,size);
                }
                assert(!provenance.some(source=>source.sensitive||source.resumable===false),'AUTOMATION_RANDOM_NOT_RESUMABLE');
                assert(Buffer.byteLength(JSON.stringify(input))<=plan.limits.maxValueBytes,'AUTOMATION_STATE_LIMIT');
                return {input,fingerprint:fingerprint(input),result:{type:statement.output.type,value:result,provenance:[...provenance,{source:'service',guildId:s.guildId,resumable:true}]}};
              });
              assignLocal(context,frame,statement.output,committed.result);frame.index++;break;
            }
            case 'readClock':{
              const committed=await this.store.randomOnce(s,runId,identity,()=>({input:{clock:true},fingerprint:fingerprint({clock:true}),result:{type:'Instant',value:this.now().toISOString(),provenance:[{source:'service',guildId:s.guildId,resumable:true}]}}));
              assignLocal(context,frame,statement.output,committed.result);frame.index++;break;
            }
            case 'approval':{
              if(!frame.approvalWait){
                const targetIndex=body.findIndex(candidate=>candidate.id===statement.actionId),target=body[targetIndex];
                assert(targetIndex>frame.index&&target?.kind==='action'&&target.enabled!==false&&(target.operation==='discord.addRole'||target.operation==='discord.removeRole'),'AUTOMATION_APPROVAL_TARGET');
                const until=evaluate(statement.until);assert(until.type==='Instant'&&typeof until.value==='string','AUTOMATION_APPROVAL_DEADLINE_INVALID');
                const expires=new Date(until.value);assert(Number.isFinite(expires.getTime())&&expires<=effectiveLoopDeadline(state,context,run.deadline_at),'AUTOMATION_APPROVAL_DEADLINE_INVALID');
                const targetFrames=structuredClone(context.frames);targetFrames.at(-1)!.index=targetIndex;
                const approvalIdentity=dynamicExecutionIdentity(run,targetFrames,target.id,context.identity),inputs=Object.fromEntries(Object.entries(target.inputs).map(([key,input])=>[key,evaluate(input)]));
                assert(!Object.values(inputs).some(value=>value.provenance.some(source=>source.sensitive||source.resumable===false)),'AUTOMATION_INPUT_SENSITIVE');
                await this.store.requireApproval(s,run,approvalIdentity,target.operation,inputs,expires);
                frame.approvalWait={identity:approvalIdentity,actionId:target.id};
              }
              const approval=await this.store.approval(s,runId,frame.approvalWait.identity);assert(approval,'AUTOMATION_APPROVAL_MISSING');
              if(approval.state==='PENDING'&&approval.expires_at>this.now()){context.approvalIdentity=approval.identity;context.approvalDeadline=approval.expires_at.toISOString();break;}
              const branch=approval.expires_at<=this.now()||approval.state==='EXPIRED'?'expired':approval.state==='APPROVED'?'approved':'rejected';
              delete frame.approvalWait;delete context.approvalIdentity;delete context.approvalDeadline;frame.index++;
              context.frames.push({path:path+'/'+branch,index:0,locals:[],...(branch==='approved'?{}:{terminalAfter:{status:branch==='expired'?'EXPIRED':'FAILED',reason:branch==='expired'?'APPROVAL_EXPIRED':'APPROVAL_REJECTED'}})});break;
            }
            case 'action':{
              const old=await this.store.operation(s,runId,identity);let outcome:OperationOutcome;
              if(old){
                if(old.state==='STARTED'){outcome={state:'UNKNOWN',code:'WORKER_INTERRUPTED'};await this.store.finishOperation(s,runId,identity,outcome);}
                else outcome=old.state==='SUCCEEDED'?{state:'SUCCEEDED',...(old.result?{value:old.result}:{})}:{state:old.state,code:old.reason??'ACTION_UNAVAILABLE'};
              }else{
                const needsApproval=statement.operation==='discord.addRole'||statement.operation==='discord.removeRole';
                let approved=needsApproval?await this.store.approval(s,runId,identity):null;
                const inputs=approved?.inputs??Object.fromEntries(Object.entries(statement.inputs).map(([key,value])=>[key,evaluate(value)]));
                assert(!Object.values(inputs).some(value=>value.provenance.some(source=>source.sensitive)),'AUTOMATION_INPUT_SENSITIVE');
                if(needsApproval){
                  approved??=await this.store.requireApproval(s,run,identity,statement.operation,inputs);
                  if(approved.state==='PENDING'&&approved.expires_at>this.now()){
                    // Restart this statement using the fixed approval inputs.
                    context.approvalIdentity=identity;
                    context.approvalDeadline=approved.expires_at.toISOString();
                    this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');continue;
                  }
                  assert(approved.state==='APPROVED'&&approved.expires_at>this.now(),'AUTOMATION_APPROVAL_REJECTED');
                }
                if(ACTION_DEFINITIONS[statement.operation].externalChange){state.externalActions++;assert(state.externalActions<=plan.limits.maxExternalActions,'AUTOMATION_ACTION_LIMIT');}
                this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');
                outcome=await betaWork(this.db,s,async()=>{
                  const current=await this.store.run(s,runId);assert(current,'AUTOMATION_RUN_NOT_FOUND',404);await this.options.adapter.authorize(s,current);
                  assert(this.now()<effectiveLoopDeadline(state,context,current.deadline_at),'AUTOMATION_LOCAL_DEADLINE');
                  await this.store.beginOperation(s,runId,identity,statement.operation,fingerprint(inputs),effectiveLoopDeadline(state,context,current.deadline_at),this.now(),automationDispatchCheckpoint(state));
                  let result:OperationOutcome;
                  try {result=await this.options.adapter.execute({scope:s,runId,identity,operation:statement.operation,inputs,targets:plan.definition.targets??{channelIds:[],roleIds:[],parentCategoryIds:[]},approvalRequired:needsApproval,...(approved?{approval:{id:approved.id,fingerprint:approved.fingerprint,expiresAt:approved.expires_at.toISOString()}}:{})});}
                  catch {result={state:'UNKNOWN',code:'CONNECTOR_RESULT_UNKNOWN'};}
                  await this.store.finishOperation(s,runId,identity,result);return result;
                },{generation:run.beta_generation});
              }
              if(old?.state==='SUCCEEDED'&&statement.operation==='nexus.readTicket'&&outcome.state==='SUCCEEDED'&&outcome.value){
                const ticket=evaluate(statement.inputs.ticket!);assert(ticket.value&&typeof ticket.value==='object'&&!Array.isArray(ticket.value)&&typeof ticket.value.id==='string','AUTOMATION_REFERENCE_INVALID');
                const authorization=await this.db.transaction().execute(async tx=>{await privacyReadLock(tx,s);await betaAccess(tx,s,'work',run!.beta_generation);assert(this.options.adapter.authorizeAwait,'AUTOMATION_POLL_AUTHORIZATION_UNAVAILABLE',503);return this.options.adapter.authorizeAwait(tx,s,run!,String((ticket.value as {id:string}).id));});
                assert(authorization&&Array.isArray(authorization.allowedChannelIds)&&authorization.allowedChannelIds.every(id=>/^\d{17,20}$/.test(id)),'AUTOMATION_POLL_AUTHORIZATION_UNAVAILABLE');
                outcome.value.provenance=[...outcome.value.provenance,{source:'service',guildId:s.guildId,resumable:true,allowedChannelIds:authorization.allowedChannelIds}];
              }
              if(outcome.state!=='SUCCEEDED')noteIterationOperation(context,outcome.state,state);
              if(statement.outcome){this.captureOutcome(s,plan,state,context,frame,statement,outcome,identity,path);break;}
              if(outcome.state!=='SUCCEEDED'){
                await this.store.event(s,runId,statement.id,outcome.state,outcome.code);
                await this.store.save(s,runId,state,outcome.state==='UNKNOWN'?'UNKNOWN':'FAILED',null,outcome.code,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};
              }
              if(statement.output){assert(outcome.value,'AUTOMATION_ACTION_OUTPUT_MISSING');assignLocal(context,frame,statement.output,outcome.value);}
              frame.index++;break;
            }
            case 'call':{
              const index=plan.definition.procedures?.findIndex(procedure=>procedure.id===statement.procedureId&&procedure.revision===statement.revision)??-1;
              assert(index>=0,'AUTOMATION_PROCEDURE_NOT_FOUND');
              const parentVariables=context.variables,parentReadonlyVariables=context.readonlyVariables,args=Object.fromEntries(Object.entries(statement.args).map(([key,value])=>[key,evaluate(value)]));
              frame.index++;context.variables=args;context.readonlyVariables=Object.keys(args);context.frames.push({path:'procedures/'+index+'/body',index:0,locals:[],call:{parentVariables,parentReadonlyVariables,outputs:Object.fromEntries(Object.entries(statement.outputs).map(([key,variable])=>[key,variable.id]))}});break;
            }
            case 'return':{
              const at=context.frames.findLastIndex(candidate=>Boolean(candidate.call));assert(at>=0,'AUTOMATION_RETURN_OUTSIDE_PROCEDURE');const call=context.frames[at]!.call!;
              const terminal=context.frames.slice(at).findLast(candidate=>candidate.terminalAfter)?.terminalAfter;
              if(terminal){await this.store.save(s,runId,state,terminal.status,null,terminal.reason,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              const failedIteration=context.frames.slice(at).findLast(candidate=>candidate.loop?.outcome)?.loop?.outcome;
              if(failedIteration){await this.store.save(s,runId,state,failedIteration==='UNKNOWN'?'UNKNOWN':'FAILED',null,'ITERATION_'+failedIteration,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              const values=Object.fromEntries(Object.entries(statement.values).map(([key,value])=>[key,evaluate(value)]));
              for(const exited of context.frames.slice(at))if(exited.loop)markIteration(state,context,exited,'SKIPPED');
              context.frames.splice(at);context.variables=call.parentVariables;context.readonlyVariables=call.parentReadonlyVariables;
              const parent=context.frames.at(-1)!;
              for(const [key,id] of Object.entries(call.outputs)){const value=values[key];assert(value,'AUTOMATION_RETURN_REQUIRED');assert(!Object.hasOwn(context.variables,id),'AUTOMATION_VARIABLE_DUPLICATE');context.variables[id]=value;parent.locals.push(id);}break;
            }
            case 'break':case 'continue':{
              let at=context.frames.length-1;while(at>=0&&!context.frames[at]!.loop&&!context.frames[at]!.boundedLoop){assert(!context.frames[at]!.call,'AUTOMATION_LOOP_BOUNDARY');at--;}
              assert(at>=0,'AUTOMATION_LOOP_BOUNDARY');
              const terminal=context.frames.slice(at+1).findLast(candidate=>candidate.terminalAfter)?.terminalAfter;
              if(terminal){await this.store.save(s,runId,state,terminal.status,null,terminal.reason,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              const failedIteration=context.frames[at]!.loop?.outcome;
              if(failedIteration){await this.store.save(s,runId,state,failedIteration==='UNKNOWN'?'UNKNOWN':'FAILED',null,'ITERATION_'+failedIteration,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              while(context.frames.length>at+1)clearLocals(context,context.frames.pop()!);
              const loop=context.frames[at]!;
              if(loop.boundedLoop){
                clearLocals(context,loop);
                if(statement.kind==='break')context.frames.pop();
                else {loop.boundedLoop.completed++;loop.boundedLoop.phase='guard';loop.index=0;}
                break;
              }
              loop.loop!.skipped=true;markIteration(state,context,loop,'SKIPPED');
              if(statement.kind==='break'){clearLocals(context,loop);context.frames.pop();}else loop.index=statements(plan.definition,loop.path).length;
              break;
            }
            case 'endBranch':{
              assert(plan.definition.semanticProfile==='scratch.v1'&&statement.semanticVersion===1,'AUTOMATION_SEMANTIC_PROFILE');
              const at=context.frames.findLastIndex(candidate=>Boolean(candidate.branch));assert(at>=0,'AUTOMATION_END_BRANCH_SCOPE');
              const boundary=context.frames.slice(at).findLast(candidate=>candidate.terminalAfter)?.terminalAfter;
              if(boundary){await this.store.save(s,runId,state,boundary.status,null,boundary.reason,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              const branch=valueAtPath(plan.definition,context.frames[at]!.branch!.nodePath) as Extract<Statement,{kind:'parallel'}>['branches'][number];
              context.outputs=Object.fromEntries(Object.entries(branch.outputs??{}).map(([key,input])=>[key,evaluate(input)]));
              for(const exited of context.frames.slice(at))if(exited.loop)markIteration(state,context,exited,'SKIPPED');
              while(context.frames.length>at)clearLocals(context,context.frames.pop()!);
              delete context.parallel;break;
            }
            case 'endRun':case 'end':{
              if(statement.kind==='endRun')assert(plan.definition.semanticProfile==='scratch.v1'&&statement.semanticVersion===1,'AUTOMATION_SEMANTIC_PROFILE');
              if(state.uncertainty){await this.store.save(s,runId,state,'UNKNOWN',null,state.uncertainty.reason,this.now());return {id:runId,state:'UNKNOWN'};}
              if(state.loopTermination){await this.store.save(s,runId,state,'FAILED',null,'LOOP_'+state.loopTermination.reason.toUpperCase(),this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              const terminal=context.frames.findLast(candidate=>candidate.terminalAfter)?.terminalAfter;
              if(terminal){await this.store.save(s,runId,state,terminal.status,null,terminal.reason,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              const failedIteration=context.frames.findLast(candidate=>candidate.loop?.outcome)?.loop?.outcome;
              if(failedIteration){await this.store.save(s,runId,state,failedIteration==='UNKNOWN'?'UNKNOWN':'FAILED',null,'ITERATION_'+failedIteration,this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              if(statement.kind==='end')assert(context===state,'AUTOMATION_END_SCOPE');
              for(const active of statement.kind==='endRun'?runtimeContexts(state):[context])for(const candidate of active.frames)if(candidate.loop)markIteration(state,active,candidate,'SKIPPED');
              if(statement.kind==='endRun'){state.frames=[];delete state.parallel;}else context.frames=[];break;
            }
            case 'parallel':context.parallel=forkParallel(context,identity,path,statement.branches);state.formatVersion=2;frame.index++;break;
          }
          if(!(statement.kind==='awaitEvent'&&context.awaitIdentity))delete context.chargedStepIdentity;
          this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');
        }
        this.resumable(state,plan);await this.store.save(s,runId,state,'RUNNING');
      } catch(error) {
          const expressionCodes:Readonly<Record<string,string>>={NumericOverflow:'AUTOMATION_NUMERIC_OVERFLOW',NumericUnderflow:'AUTOMATION_NUMERIC_UNDERFLOW',DomainError:'AUTOMATION_DOMAIN_ERROR',ZeroDivision:'AUTOMATION_ZERO_DIVISION',NumericEngineUnavailable:'AUTOMATION_NUMERIC_ENGINE_UNAVAILABLE',NumericCertificationUnavailable:'AUTOMATION_NUMERIC_CERTIFICATION_UNAVAILABLE',IndexError:'AUTOMATION_INDEX_ERROR'};
          const code=isDomainError(error)?error.code:error instanceof AutomationValueError?(expressionCodes[error.code]??(/^[A-Z_]{1,80}$/.test(error.code)?'AUTOMATION_'+error.code:'AUTOMATION_EXECUTION_FAILED')):error instanceof Error&&/^AUTOMATION_[A-Z_]+$/.test(error.message)?error.message:'AUTOMATION_EXECUTION_FAILED';
        const current=await this.store.run(s,runId);
        if(code==='AUTOMATION_CHECKPOINT_CONFLICT')return {id:runId,state:current?.status??'DELETED'};
        if(current&&!current.ended_at){
          // A worker may die after its durable dispatch claim. Neither a later
          // permission failure nor cancellation makes that operation unsent.
          const pending=(await sql`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${runId}::uuid AND state IN ('STARTED','UNKNOWN')`.execute(this.db)).rows.length;
          let checkpoint=error instanceof LoopDeadlineConflict?structuredClone(error.resume):state;
          if(error instanceof LoopDeadlineConflict){checkpoint.steps=state.steps;checkpoint.evaluations=state.evaluations;checkpoint.externalActions=state.externalActions;}
          try{this.resumable(checkpoint,plan);}catch{
            // Never persist the over-budget or non-resumable value which caused
            // this failure. Durable operation evidence remains in its ledger.
            checkpoint=structuredClone(current.resume);
            checkpoint.steps=state.steps;checkpoint.evaluations=state.evaluations;checkpoint.externalActions=state.externalActions;
          }
          const failedContext=runtimeContexts(checkpoint).find(item=>item.identity===context.identity)??checkpoint;
          if(checkpoint.loopTermination){checkpoint.loopTermination.diagnostics=[...new Set([...(checkpoint.loopTermination.diagnostics??[]),code,'HANDLER_FAILED'])];}
          const expiredOwner=expiredLoopOwner(checkpoint,this.now(),checkpoint.loopTermination?failedContext:undefined);
          const nearest=nearestBoundedLoopOwner(checkpoint,failedContext);
          const localFailure=error instanceof LoopDeadlineConflict||error instanceof AutomationValueError&&!/LIMIT|BUDGET/.test(error.code)||isDomainError(error)&&['AUTOMATION_CONDITION_INVALID','AUTOMATION_COUNT_INVALID','AUTOMATION_DURATION_INVALID','AUTOMATION_WAIT_LIMIT','AUTOMATION_LIST_INVALID','AUTOMATION_INSTANT_INVALID','AUTOMATION_DEADLINE_EXCEEDED','AUTOMATION_LOCAL_DEADLINE'].includes(error.code);
          if(!pending&&!current.cancel_requested_at&&this.now()<current.deadline_at&&!isAutomationBudgetStop(code)&&(expiredOwner||!checkpoint.loopTermination&&nearest&&localFailure)){
            let owner=expiredOwner?{context:expiredOwner.context,index:expiredOwner.index}:nearest!,reason:LoopFailureReason=expiredOwner?'local_deadline':'evaluation_failed';
            for(let retry=0;retry<plan.limits.maxNesting+plan.limits.maxCallDepth+2;retry++){
              checkpoint.steps++;
              if(checkpoint.steps>plan.limits.maxExpandedSteps){await this.store.save(s,runId,checkpoint,'FAILED',null,'AUTOMATION_STEP_LIMIT',this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};}
              try{
                if(await this.enterLoopHandler(s,current,plan,checkpoint,owner.context,owner.index,reason)){this.resumable(checkpoint,plan);await this.store.save(s,runId,checkpoint,'RUNNING');}
                return {id:runId,state:(await this.store.run(s,runId))!.status};
              }catch(conflict){
                if(isDomainError(conflict)&&conflict.code==='AUTOMATION_CHECKPOINT_CONFLICT')return {id:runId,state:(await this.store.run(s,runId))?.status??'DELETED'};
                if(!(conflict instanceof LoopDeadlineConflict))throw conflict;
                const steps=checkpoint.steps,evaluations=checkpoint.evaluations,externalActions=checkpoint.externalActions;
                checkpoint=structuredClone(conflict.resume);Object.assign(checkpoint,{steps,evaluations,externalActions});
                const selected=checkpoint.loopTermination?runtimeContexts(checkpoint).find(item=>item.identity===checkpoint.loopTermination!.contextIdentity):undefined;
                const expired=expiredLoopOwner(checkpoint,this.now(),selected);assert(expired,'AUTOMATION_LOOP_CURSOR_INVALID');owner={context:expired.context,index:expired.index};reason='local_deadline';
              }
            }
            await this.store.save(s,runId,checkpoint,'FAILED',null,'AUTOMATION_NESTING_LIMIT',this.now());return {id:runId,state:(await this.store.run(s,runId))!.status};
          }
          if(pending)noteIterationOperation(failedContext,'UNKNOWN',checkpoint);
          else if(!current.cancel_requested_at&&this.now()<current.deadline_at)noteIterationOperation(failedContext,'FAILED',checkpoint);
          const terminalStatus=pending?'UNKNOWN':this.now()>=current.deadline_at?'EXPIRED':'FAILED';
          await this.store.save(s,runId,checkpoint,terminalStatus,null,code,this.now());
        }
      }
      const final=await this.store.run(s,runId);return {id:runId,state:final?.status??'DELETED'};
    });
  }
  private async enterLoopHandler(s:Scope,run:RunRecord,plan:ExecutionPlan,state:ResumeState,context:RuntimeContext,index:number,reason:LoopFailureReason):Promise<boolean> {
    const owner=context.frames[index],loop=owner?.boundedLoop;
    assert(owner&&loop,'AUTOMATION_LOOP_CURSOR_INVALID');
    const statement=valueAtPath(plan.definition,loop.nodePath) as BoundedLoop;
    assert(statement.kind==='boundedLoop'&&statement.semanticVersion===1,'AUTOMATION_LOOP_CURSOR_INVALID');
    const pending=(await sql`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND state IN ('STARTED','UNKNOWN')`.execute(this.db)).rows.length;
    if(pending||state.uncertainty){await this.store.save(s,run.id,state,'UNKNOWN',null,'UNRESOLVED_EXTERNAL_RESULT',this.now());return false;}
    const current=await this.store.run(s,run.id);
    assert(current,'AUTOMATION_RUN_NOT_FOUND',404);
    if(current.ended_at)return false;
    if(current.cancel_requested_at||this.now()>=current.deadline_at){await this.store.save(s,run.id,state,current.cancel_requested_at?'CANCELLED':'EXPIRED',null,current.cancel_requested_at?'CANCEL_REQUESTED':'RUN_DEADLINE',this.now());return false;}
    if(state.loopTermination&&reason!=='local_deadline'){
      state.loopTermination.diagnostics=[...new Set([...(state.loopTermination.diagnostics??[]),'HANDLER_FAILED','LOOP_'+reason.toUpperCase()])];
      await this.store.save(s,run.id,state,'FAILED',null,'LOOP_'+state.loopTermination.reason.toUpperCase(),this.now());return false;
    }
    for(let at=context.frames.length-1;at>index;at--){const exited=context.frames.pop()!;clearLocals(context,exited);if(exited.call){context.variables=exited.call.parentVariables;context.readonlyVariables=exited.call.parentReadonlyVariables;}}
    clearLocals(context,owner);
    delete context.parallel;delete context.waitUntil;delete context.approvalIdentity;delete context.approvalDeadline;delete context.awaitIdentity;delete context.awaitDeadline;delete context.chargedStepIdentity;
    const key=LOOP_HANDLER_KEYS[reason],handlerPath=loop.nodePath+'/handlers/'+key;
    const prior=state.loopTermination;
    const dischargedOwners=prior?[...(prior.dischargedOwners??[]),...(prior.reason==='local_deadline'?[{nodePath:prior.handlerPath.replace(/\/handlers\/localDeadline$/,''),...(prior.contextIdentity?{contextIdentity:prior.contextIdentity}:{})}]:[])]:[];
    state.loopTermination={version:1,...(context.identity?{contextIdentity:context.identity}:{}),reason,handlerPath,pure:reason==='local_deadline',...(dischargedOwners.length?{dischargedOwners}:{}),...(prior?{diagnostics:[...new Set([...(prior.diagnostics??[]),'LOOP_'+prior.reason.toUpperCase()])]}:{})};
    if(!statement.handlers[key]){await this.store.save(s,run.id,state,'FAILED',null,'LOOP_'+reason.toUpperCase(),this.now());return false;}
    owner.path=handlerPath;owner.index=0;delete owner.boundedLoop;
    owner.terminalAfter={status:'FAILED',reason:'LOOP_'+reason.toUpperCase()};
    if(statement.reason){assignLocal(context,owner,statement.reason,{type:statement.reason.type,value:reason,provenance:[{source:'service',guildId:s.guildId,resumable:true}]});context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.reason.id])];}
    await this.store.event(s,run.id,statement.id,'LOOP_HANDLER',reason.toUpperCase());
    return true;
  }
  private captureOutcome(s:Scope,plan:ExecutionPlan,state:ResumeState,context:RuntimeContext,frame:RuntimeFrame,statement:Extract<Statement,{kind:'action'}>,outcome:OperationOutcome,identity:string,path:string) {
    assert(statement.outcome,'AUTOMATION_ACTION_OUTCOME_REQUIRED');
    const action=ACTION_DEFINITIONS[statement.operation];
    if(outcome.state==='SUCCEEDED'&&action.outputType)assert(outcome.value&&outcome.value.provenance.some(source=>source.source==='service'&&source.guildId===s.guildId),'AUTOMATION_ACTION_OUTPUT_MISSING');
    const value:EvaluatedValue={type:{kind:'OperationOutcome',value:action.outputType??'Boolean'},value:outcome.state==='SUCCEEDED'?{state:'SUCCEEDED',value:action.outputType?outcome.value!.value:true}:{state:outcome.state,reason:safeResultReason(outcome.code)},provenance:[...(outcome.state==='SUCCEEDED'?outcome.value?.provenance??[]:[]),{source:'service',guildId:s.guildId,resumable:true,evidence:'operation'}]};
    assertValueMatchesType(value.type,value.value,{guildId:s.guildId,limits:plan.limits,temporalResolution:'fixed'});
    assignLocal(context,frame,statement.outcome,value);context.readonlyVariables=[...new Set([...(context.readonlyVariables??[]),statement.outcome.id])];frame.index++;
    if(outcome.state==='UNKNOWN'){
      const body=statements(plan.definition,frame.path),index=body.findIndex((node,index)=>index>=frame.index&&node.enabled!==false),handler=body[index];
      assert(handler?.kind==='resultBranch'&&handler.value.kind==='variable'&&handler.value.variableId===statement.outcome.id,'AUTOMATION_ACTION_OUTCOME_HANDLER');
      state.uncertainty={operationIdentity:identity,...(context.identity?{contextIdentity:context.identity}:{}),handlerPath:frame.path+'/'+index+'/unknown',reason:safeResultReason(outcome.code),phase:'CAPTURED'};
      void path;
    }
  }
  private restoreUncertainty(s:Scope,run:RunRecord,plan:ExecutionPlan,state:ResumeState,operations:{identity:string;state:'STARTED'|'UNKNOWN';reason:string|null}[]):boolean {
    if(operations.length!==1)return false;
    const operation=operations[0]!;
    if(state.uncertainty)return state.uncertainty.operationIdentity===operation.identity&&runtimeContexts(state).some(context=>context.identity===state.uncertainty!.contextIdentity);
    for(const context of runtimeContexts(state)){
      const frame=context.frames.at(-1);if(!frame)continue;
      const statement=statements(plan.definition,frame.path)[frame.index];if(statement?.kind!=='action'&&statement?.kind!=='poll')continue;
      const base=dynamicExecutionIdentity(run,context.frames,statement.id,context.identity),identity=statement.kind==='poll'?fingerprint({poll:base,attempt:frame.poll?.attempts??0}):base;if(identity!==operation.identity)continue;
      noteIterationOperation(context,'UNKNOWN',state);
      if(statement.kind!=='action'||!statement.outcome)return false;
      this.captureOutcome(s,plan,state,context,frame,statement,{state:'UNKNOWN',code:operation.state==='STARTED'?'WORKER_INTERRUPTED':safeResultReason(operation.reason??'WORKER_INTERRUPTED')},identity,frame.path+'/'+frame.index);return true;
    }
    return false;
  }
  private loopInputs(plan:ExecutionPlan,state:RuntimeContext,frame:RuntimeFrame) {
    const loop=frame.loop!,parts=loop.nodePath.split('/'),index=Number(parts.pop()),statement=statements(plan.definition,parts.join('/'))[index];
    assert(statement?.kind==='repeat','AUTOMATION_CURSOR_INVALID');
    assignLocal(state,frame,statement.itemVariable,loop.items[loop.iteration]!);
    if(statement.indexVariable)assignLocal(state,frame,statement.indexVariable,{type:'Number',value:loop.iteration+1,provenance:[{source:'service',guildId:plan.definition.guildId}]});
  }
  private resumable(state:ResumeState,plan:ExecutionPlan) {
    assertParallelCheckpoint(state,plan.limits);
    const values=runtimeContexts(state).flatMap(context=>[...Object.values(context.variables),...Object.values(context.outputs??{}),...context.frames.flatMap(frame=>[...Object.values(frame.call?.parentVariables??{}),...(frame.loop?.items??[]),...(frame.poll?[frame.poll.ticket]:[]),...(frame.await?[frame.await.ticket]:[])])]);
    assert(values.length<=plan.limits.maxVariables,'AUTOMATION_VARIABLE_LIMIT');
    assert(!values.some(value=>value.provenance.some(source=>source.sensitive||source.resumable===false)),'AUTOMATION_STATE_NOT_RESUMABLE');
    assert(Buffer.byteLength(JSON.stringify(state))<=plan.limits.maxValueBytes,'AUTOMATION_STATE_LIMIT');
  }
}
