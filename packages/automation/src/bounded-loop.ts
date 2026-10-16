import {assert} from '../../shared/src/index';
import type {RuntimeContext,RuntimeFrame,ResumeState} from './store';
import type {ConditionResult,Statement} from './types';

export const LOOP_FAILURE_REASONS=['limit_reached','condition_unknown','evaluation_failed','local_deadline'] as const;
export type LoopFailureReason=typeof LOOP_FAILURE_REASONS[number];
export const LOOP_HANDLER_KEYS={limit_reached:'limit',condition_unknown:'conditionUnknown',evaluation_failed:'evaluationError',local_deadline:'localDeadline'} as const;
export type BoundedLoop=Extract<Statement,{kind:'boundedLoop'}>;
export const isAutomationBudgetStop=(code:string)=>/^AUTOMATION_(?:STEP_LIMIT|EVALUATION_(?:BUDGET|LIMIT)|ACTION_LIMIT|STATE_LIMIT|VARIABLE_LIMIT|PARALLEL_CONTEXT_LIMIT|NESTING_LIMIT)$/.test(code);

/** The guard is evaluated before the limit check, including at N=0 and N. */
export function boundedLoopDecision(mode:BoundedLoop['mode'],completed:number,maxBody:number,condition:boolean|ConditionResult):'body'|'complete'|'limit_reached'|'condition_unknown' {
  assert(Number.isSafeInteger(completed)&&completed>=0&&Number.isSafeInteger(maxBody)&&maxBody>=completed,'AUTOMATION_LOOP_CURSOR_INVALID');
  assert(typeof condition==='boolean'||['true','false','unknown'].includes(condition),'AUTOMATION_CONDITION_INVALID');
  if(condition==='unknown')return 'condition_unknown';
  const truth=condition===true||condition==='true';
  if(mode==='until'?truth:!truth)return 'complete';
  return completed===maxBody?'limit_reached':'body';
}

/** No effectful statement is permitted in an expired loop's terminal region. */
export function isLocalDeadlineSafe(statement:Statement):boolean {
  return ['declare','assign','branch','switch','optionalBranch','searchBranch','repeat','boundedLoop','break','continue','end','endRun'].includes(statement.kind);
}

export function contextLineage(root:RuntimeContext,target:RuntimeContext):RuntimeContext[] {
  if(root===target)return [root];
  for(const branch of root.parallel?.branches??[]){const found=contextLineage(branch.context,target);if(found.length)return [root,...found];}
  return [];
}

export interface LoopDeadlineOwner {context:RuntimeContext;frame:RuntimeFrame;index:number;at:number;depth:number;}
/** Run expiry is checked by the caller first. Equal local times select outermost. */
export function expiredLoopOwner(state:ResumeState,now:Date,selected?:RuntimeContext):LoopDeadlineOwner|undefined {
  const candidates:LoopDeadlineOwner[]=[];
  const visit=(context:RuntimeContext,depth:number)=>{
    context.frames.forEach((frame,index)=>{if(frame.boundedLoop?.deadline){const at=Date.parse(frame.boundedLoop.deadline);assert(Number.isFinite(at),'AUTOMATION_LOOP_CURSOR_INVALID');if(at<=now.getTime())candidates.push({context,frame,index,at,depth:depth+index});}});
    if(!selected)for(const branch of context.parallel?.branches??[])visit(branch.context,depth+context.frames.length);
  };
  if(selected){let depth=0;for(const context of contextLineage(state,selected)){visit(context,depth);depth+=context.frames.length;}}
  else visit(state,0);
  return candidates.sort((a,b)=>a.at-b.at||a.depth-b.depth||(a.context.identity??'').localeCompare(b.context.identity??''))[0];
}

export function effectiveLoopDeadline(state:ResumeState,context:RuntimeContext,runDeadline:Date):Date {
  const times=[runDeadline.getTime(),...contextLineage(state,context).flatMap(item=>item.frames.flatMap(frame=>frame.boundedLoop?.deadline?[Date.parse(frame.boundedLoop.deadline)]:[]))];
  assert(times.every(Number.isFinite),'AUTOMATION_LOOP_CURSOR_INVALID');return new Date(Math.min(...times));
}

export function nearestBoundedLoop(context:RuntimeContext):number {
  for(let index=context.frames.length-1;index>=0;index--){const frame=context.frames[index]!;if(frame.boundedLoop)return index;}
  return -1;
}
export function nearestBoundedLoopOwner(state:ResumeState,context:RuntimeContext):{context:RuntimeContext;index:number}|undefined {
  for(const ancestor of contextLineage(state,context).reverse()){
    const index=nearestBoundedLoop(ancestor);if(index>=0)return {context:ancestor,index};
  }
  return undefined;
}
export class LoopDeadlineConflict extends Error {
  constructor(readonly resume:ResumeState){super('AUTOMATION_LOCAL_DEADLINE');}
}
function contextWithIdentity(root:RuntimeContext,identity?:string):RuntimeContext|undefined {
  const pending=[root];while(pending.length){const next=pending.pop()!;if(next.identity===identity)return next;for(const branch of next.parallel?.branches??[])pending.push(branch.context);}return undefined;
}
/** Keep deadline ownership at the same commit boundary as a frame pop. */
export function assertLoopDeadlineCommit(previous:ResumeState,candidate:ResumeState,now:Date):void {
  const before=structuredClone(previous),after=structuredClone(candidate),termination=candidate.loopTermination;
  const selected=(resume:ResumeState)=>resume.loopTermination?contextWithIdentity(resume,resume.loopTermination.contextIdentity):undefined;
  for(const resume of [before,after])for(const marker of termination?.dischargedOwners??[]){
    const context=contextWithIdentity(resume,marker.contextIdentity),index=context?.frames.findIndex(frame=>frame.boundedLoop?.nodePath===marker.nodePath)??-1;
    if(context&&index>=0){
      const current=expiredLoopOwner(resume,now,selected(resume));
      if(current?.context!==context||current.index!==index)throw new LoopDeadlineConflict(resume);
      context.frames.splice(index);delete context.parallel;delete context.waitUntil;delete context.approvalIdentity;delete context.awaitIdentity;
      resume.loopTermination=termination&&structuredClone(termination);
    }
  }
  const oldOwner=expiredLoopOwner(before,now,selected(before)),newOwner=expiredLoopOwner(after,now,selected(after));
  const matches=(owner:LoopDeadlineOwner|undefined)=>Boolean(owner&&termination?.reason==='local_deadline'&&termination.contextIdentity===owner.context.identity&&termination.handlerPath===owner.frame.boundedLoop!.nodePath+'/handlers/localDeadline');
  if(oldOwner&&!matches(oldOwner))throw new LoopDeadlineConflict(before);
  const discharged=matches(oldOwner)||!oldOwner&&matches(newOwner);
  if(discharged&&termination){
    for(const resume of [before,after]){
      const context=contextWithIdentity(resume,termination.contextIdentity);
      const index=context?.frames.findIndex(frame=>frame.boundedLoop&&termination.handlerPath===frame.boundedLoop.nodePath+'/handlers/localDeadline')??-1;
      if(context&&index>=0){context.frames.splice(index);delete context.parallel;delete context.waitUntil;delete context.approvalIdentity;delete context.awaitIdentity;}
      resume.loopTermination=structuredClone(termination);
    }
  }
  if(expiredLoopOwner(before,now,selected(before)))throw new LoopDeadlineConflict(before);
  if(expiredLoopOwner(after,now,selected(after)))throw new LoopDeadlineConflict(after);
}
