import {z} from 'zod';
import {assert} from '../../shared/src/index.js';
import type {Settings} from '../../settings/src/index.js';
const optionSchema=z.object({id:z.string().regex(/^[a-z\d_-]{1,50}$/),label:z.string().min(1).max(100),next:z.string().nullable(),roleId:z.string().regex(/^\d{17,20}$/).optional(),channelId:z.string().regex(/^\d{17,20}$/).optional()}).strict();
export const flowSchema=z.object({start:z.string(),nodes:z.array(z.object({id:z.string().regex(/^[a-z\d_-]{1,50}$/),question:z.string().min(1).max(500),options:z.array(optionSchema).min(1).max(25),
 type:z.enum(['info','choice','multi_choice','role_select','channel_select','condition','assign_role','recommend_channel','finish']).optional(),
 condition:z.object({nodeId:z.string(),optionId:z.string()}).strict().optional(),nativePromptId:z.string().optional()
}).strict()).min(1).max(25)}).strict();
export type Flow=z.infer<typeof flowSchema>;
export type FlowState={nodeId:string|null,answers:Record<string,string>,complete:boolean};
export function validateFlow(input:unknown):Flow {
 const flow=flowSchema.parse(input);const nodes=new Map(flow.nodes.map(n=>[n.id,n]));
 assert(nodes.size===flow.nodes.length&&nodes.has(flow.start),'INVALID_FLOW_NODES');
 const visited=new Set<string>();const visit=(id:string,path:Set<string>)=>{
  assert(!path.has(id),'FLOW_CYCLE');const node=nodes.get(id);assert(node,'FLOW_DANGLING_EDGE');
  assert(new Set(node.options.map(o=>o.id)).size===node.options.length,'DUPLICATE_OPTIONS');
  if(node.type==='condition')assert(node.condition&&node.options.length===2,'CONDITION_REQUIRES_TWO_BRANCHES');
  if(node.type==='multi_choice'||node.type==='role_select'||node.type==='channel_select')assert(new Set(node.options.map(o=>o.next)).size===1,'MULTI_SELECTION_REQUIRES_SHARED_NEXT');
  if(node.type==='role_select')assert(node.options.every(o=>o.roleId),'ROLE_SELECT_REQUIRES_ALLOWLIST');
  if(node.type==='channel_select')assert(node.options.every(o=>o.channelId),'CHANNEL_SELECT_REQUIRES_ALLOWLIST');
  visited.add(id);const nextPath=new Set(path).add(id);
  for(const option of node.options)if(option.next!==null)visit(option.next,nextPath);
 };visit(flow.start,new Set());assert(visited.size===nodes.size,'UNREACHABLE_NODE');return flow;
}
export function advanceFlow(flow:Flow,input:FlowState):FlowState{
 let state=input;
 for(let step=0;step<flow.nodes.length&&!state.complete;step++){
  const node=flow.nodes.find(n=>n.id===state.nodeId)!;
  if(node.type==='finish')return {...state,nodeId:null,complete:true};
  if(!['condition','assign_role','recommend_channel'].includes(node.type??''))break;
  const option=node.type==='condition'?node.options[state.answers[node.condition!.nodeId]?.split('|').includes(node.condition!.optionId)?0:1]!:node.options[0]!;
  state={nodeId:option.next,answers:{...state.answers,[node.id]:option.id},complete:option.next===null};
 }
 return state;
}
export function initialFlowState(flow:Flow):FlowState{return advanceFlow(flow,{nodeId:flow.start,answers:{},complete:false});}
export function answerFlow(flow:Flow,state:FlowState,nodeId:string,optionId:string|string[]):FlowState{
 assert(!state.complete&&state.nodeId===nodeId,'STALE_FLOW_NODE',409);
 const node=flow.nodes.find(n=>n.id===nodeId)!;const ids=[...new Set(Array.isArray(optionId)?optionId:[optionId])];
 assert(ids.length>0&&(['multi_choice','role_select','channel_select'].includes(node.type??'')||ids.length===1),'INVALID_SELECTION_COUNT');
 const options=ids.map(id=>node.options.find(o=>node.type==='role_select'?o.roleId===id:node.type==='channel_select'?o.channelId===id:o.id===id));
 assert(options.every(Boolean),'INVALID_FLOW_OPTION');const next=options[0]!.next;
 return advanceFlow(flow,{nodeId:next,answers:{...state.answers,[nodeId]:options.map(o=>o!.id).sort().join('|')},complete:next===null});
}
export function selectedOptions(flow:Flow,state:FlowState){return Object.entries(state.answers).flatMap(([id,answer])=>flow.nodes.find(n=>n.id===id)?.options.filter(o=>answer.split('|').includes(o.id))??[]);}
export function templateFlow(template:Settings['template']):Flow{
 if(template==='Gaming')return validateFlow({start:'purpose',nodes:[
  {id:'purpose',question:'What brings you here?',options:[{id:'gaming',label:'Gaming',next:'game'},{id:'community',label:'Community',next:null}]},
  {id:'game',question:'Which game?',options:[{id:'minecraft',label:'Minecraft',next:'edition'},{id:'valorant',label:'Valorant',next:null}]},
  {id:'edition',question:'Java or Bedrock?',options:[{id:'java',label:'Java',next:null},{id:'bedrock',label:'Bedrock',next:null}]}
 ]});
 const labels:Record<string,[string,string]>={'Creator':['Create together','Discover work'],'Developer / OSS':['Contribute','Learn'],'Product / SaaS':['Build with the product','Learn the product'],'Education':['Study together','Explore resources'],'General Community':['Meet members','Explore topics']};
 const choices=labels[template]!;
 return validateFlow({start:'purpose',nodes:[{id:'purpose',question:'What would you like to do first?',options:[{id:'participate',label:choices[0],next:'interest'},{id:'explore',label:choices[1],next:null}]},
 {id:'interest',question:'How would you like to get started?',options:[{id:'conversation',label:'Join a conversation',next:null},{id:'resources',label:'Find resources',next:null}]}]});
}
