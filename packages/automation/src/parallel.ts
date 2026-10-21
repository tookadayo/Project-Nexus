import {assert} from '../../shared/src/index';
import type {AutomationLimits} from './types';
import {fingerprint,type ResumeState,type RuntimeContext,type RuntimeParallelGroup} from './store';

/** One context owns mutable locals. Parent snapshots are copied at fork and
 * discarded after completion; no branch can publish an implicit output. */
export function forkParallel(context:RuntimeContext,identity:string,path:string,branches:{id:string}[]):RuntimeParallelGroup {
  assert(!context.parallel,'AUTOMATION_PARALLEL_CURSOR_INVALID');
  return {identity,nodePath:path,cursor:0,branches:branches.map((branch,index)=>({id:branch.id,context:{
    identity:fingerprint({parallel:identity,branch:branch.id}),
    frames:[{path:path+'/branches/'+index+'/body',index:0,locals:[],branch:{nodePath:path+'/branches/'+index}}],
    variables:structuredClone(context.variables),readonlyVariables:Object.keys(context.variables),
  }}))};
}
export function runtimeContexts(root:RuntimeContext):RuntimeContext[] {
  const result:RuntimeContext[]=[],pending=[root];
  while(pending.length){const context=pending.pop()!;result.push(context);assert(result.length<=1001,'AUTOMATION_PARALLEL_CONTEXT_LIMIT');for(const branch of context.parallel?.branches??[])pending.push(branch.context);}
  return result;
}
export function assertParallelCheckpoint(root:ResumeState,limits:AutomationLimits) {
  assert(root.formatVersion===undefined||root.formatVersion===2,'AUTOMATION_RESUME_VERSION_UNSUPPORTED');
  const visit=(context:RuntimeContext,depth:number)=>{
    assert(depth<=limits.maxNesting,'AUTOMATION_PARALLEL_DEPTH_LIMIT');
    assert(Array.isArray(context.frames)&&context.variables&&typeof context.variables==='object','AUTOMATION_PARALLEL_CURSOR_INVALID');
    if(context.waitUntil)assert(Number.isFinite(Date.parse(context.waitUntil)),'AUTOMATION_PARALLEL_CURSOR_INVALID');
    if(context.awaitIdentity)assert(/^[a-f0-9]{64}$/.test(context.awaitIdentity)&&context.awaitDeadline&&Number.isFinite(Date.parse(context.awaitDeadline)),'AUTOMATION_AWAIT_CURSOR_INVALID');
    if(!context.parallel)return;
    const group=context.parallel;
    assert(/^[a-f0-9]{64}$/.test(group.identity)&&typeof group.nodePath==='string'&&Number.isSafeInteger(group.cursor)&&group.cursor>=0&&group.cursor<group.branches.length,'AUTOMATION_PARALLEL_CURSOR_INVALID');
    assert(group.branches.length>0&&group.branches.length<=limits.maxParallelBranches&&new Set(group.branches.map(branch=>branch.id)).size===group.branches.length,'AUTOMATION_PARALLEL_BRANCH_LIMIT');
    for(const branch of group.branches){assert(branch.context.identity===fingerprint({parallel:group.identity,branch:branch.id}),'AUTOMATION_PARALLEL_IDENTITY_INVALID');visit(branch.context,depth+1);}
  };visit(root,0);runtimeContexts(root);
}
type ApprovalReady=(identity:string)=>Promise<boolean>;
/** Cooperative round robin: select one runnable leaf, with no asynchronous
 * branch fan-out. The caller shares the Run's step/evaluation/action counters. */
export async function nextRuntimeContext(root:RuntimeContext,now:Date,approvalReady:ApprovalReady,join:(context:RuntimeContext,group:RuntimeParallelGroup)=>void,awaitReady:ApprovalReady=async()=>false):Promise<RuntimeContext|null> {
  if(root.awaitIdentity){if(!await awaitReady(root.awaitIdentity))return null;delete root.awaitIdentity;delete root.awaitDeadline;}
  if(root.waitUntil){if(new Date(root.waitUntil)>now)return null;delete root.waitUntil;}
  if(root.approvalIdentity){if(!await approvalReady(root.approvalIdentity))return null;delete root.approvalIdentity;delete root.approvalDeadline;}
  if(root.parallel){
    const group=root.parallel;
    for(let offset=0;offset<group.branches.length;offset++){
      const index=(group.cursor+offset)%group.branches.length,branch=group.branches[index]!;
      const context=await nextRuntimeContext(branch.context,now,approvalReady,join,awaitReady);
      if(context){group.cursor=(index+1)%group.branches.length;return context;}
    }
    if(!group.branches.every(branch=>branch.context.frames.length===0&&!branch.context.parallel))return null;
    join(root,group);
    delete root.parallel;
  }
  if(root.frames.length)return root;
  // Completed branch snapshots are no longer needed for resumption.
  root.variables={};delete root.readonlyVariables;delete root.waitUntil;delete root.approvalIdentity;delete root.awaitIdentity;delete root.awaitDeadline;
  return null;
}
export function parallelPause(root:RuntimeContext,now:Date):{state:'WAITING'|'WAITING_APPROVAL';wakeAt:Date|null} {
  const contexts=runtimeContexts(root),waiting=contexts.filter(context=>context.frames.length>0&&context.waitUntil&&new Date(context.waitUntil)>now);
  const due=[...waiting.map(context=>new Date(context.waitUntil!).getTime()),...contexts.flatMap(context=>context.awaitIdentity&&context.awaitDeadline?[Date.parse(context.awaitDeadline)]:[]),...contexts.flatMap(context=>context.approvalIdentity&&context.approvalDeadline?[Date.parse(context.approvalDeadline)]:[])];
  return {state:contexts.some(context=>context.approvalIdentity)?'WAITING_APPROVAL':'WAITING',wakeAt:due.length?new Date(Math.min(...due)):null};
}
export interface ParallelRunStatus {
  identity:string;join:'ALL';branches:{id:string;state:'RUNNABLE'|'WAITING'|'WAITING_APPROVAL'|'COMPLETED';dueAt?:string;parallel?:ParallelRunStatus}[];
}
/** Metadata only: never return stored variable values or evaluated inputs. */
export function parallelRunStatus(root:RuntimeContext,now=new Date()):ParallelRunStatus|undefined {
  const group=root.parallel;if(!group)return undefined;
  return {identity:group.identity,join:'ALL',branches:group.branches.map(({id,context})=>{
    const nested=parallelRunStatus(context,now),children=nested?.branches??[];
    let state:ParallelRunStatus['branches'][number]['state']='RUNNABLE';
    if(!context.frames.length&&!context.parallel)state='COMPLETED';
    else if(context.approvalIdentity)state='WAITING_APPROVAL';
    else if(context.awaitIdentity)state='WAITING';
    else if(context.waitUntil&&new Date(context.waitUntil)>now)state='WAITING';
    else if(children.length&&!children.some(branch=>branch.state==='RUNNABLE')){
      if(children.some(branch=>branch.state==='WAITING_APPROVAL'))state='WAITING_APPROVAL';
      else if(children.some(branch=>branch.state==='WAITING'))state='WAITING';
    }
    const due=[...(context.waitUntil?[context.waitUntil]:[]),...(context.awaitDeadline?[context.awaitDeadline]:[]),...children.flatMap(branch=>branch.dueAt?[branch.dueAt]:[])].sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
    return {id,state,...(due?{dueAt:due}:{}),...(nested?{parallel:nested}:{})};
  })};
}
