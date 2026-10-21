import {expect,it} from 'vitest';
import {boundedLoopDecision,expiredLoopOwner,effectiveLoopDeadline,LOOP_FAILURE_REASONS} from '../../packages/automation/src/bounded-loop';
import {validateFlowDefinition} from '../../packages/automation/src/definition';
import {dynamicExecutionIdentity} from '../../packages/automation/src/runtime';
import type {FlowDefinition,Statement,ValueInput} from '../../packages/automation/src/types';
import type {ResumeState,RuntimeFrame} from '../../packages/automation/src/store';

const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const truth=(value:boolean):ValueInput=>({kind:'literal',type:'Boolean',value});
const loop=(overrides:Partial<Extract<Statement,{kind:'boundedLoop'}>>={}):Extract<Statement,{kind:'boundedLoop'}>=>({id:'loop',kind:'boundedLoop',semanticVersion:1,mode:'until',maxBody:number(3),condition:truth(false),until:{kind:'literal',type:'Instant',value:'2030-01-01T00:00:00.000Z'},body:[],handlers:{},...overrides});
const flow=(body:Statement[]):FlowDefinition=>({schemaVersion:1,semanticProfile:'scratch.v1',id:'flow',name:'Flow',guildId:'884000000000000001',trigger:{kind:'manual',inputs:[]},variables:[],body});
const frame=(nodePath:string,deadline:string):RuntimeFrame=>({path:nodePath+'/body',index:0,locals:[],boundedLoop:{version:1,nodePath,identity:'fixed',maxBody:3,completed:0,phase:'body',deadline}});
const state=(frames:RuntimeFrame[]):ResumeState=>({frames,variables:{},startedAt:'2026-10-15T00:00:00.000Z',steps:0,evaluations:0,externalActions:0});

it('S001-S005 evaluates the zero and final guard before deciding exhaustion',()=>{
  expect(boundedLoopDecision('until',0,0,true)).toBe('complete');
  expect(boundedLoopDecision('until',0,0,false)).toBe('limit_reached');
  expect(boundedLoopDecision('while',0,0,false)).toBe('complete');
  expect(boundedLoopDecision('while',0,0,true)).toBe('limit_reached');
  expect(boundedLoopDecision('until',3,3,true)).toBe('complete');
  expect(boundedLoopDecision('until',3,3,false)).toBe('limit_reached');
  expect(boundedLoopDecision('until',2,3,false)).toBe('body');
});
it('S006 keeps condition unknown separate from false and limit',()=>{
  expect(boundedLoopDecision('while',0,0,'unknown')).toBe('condition_unknown');
  expect(boundedLoopDecision('until',0,3,'unknown')).toBe('condition_unknown');
});
it('requires the explicit loop and flow versions and safe integer bounds',()=>{
  expect(validateFlowDefinition(flow([loop()])).valid).toBe(true);
  const old=flow([loop()]);delete old.semanticProfile;
  expect(validateFlowDefinition(old).issues.some(issue=>issue.code==='SEMANTIC_PROFILE')).toBe(true);
  expect(validateFlowDefinition(flow([loop({maxBody:number(1.5)})])).issues.some(issue=>issue.code==='COUNT')).toBe(true);
  expect(validateFlowDefinition(flow([loop({semanticVersion:2 as 1})])).issues.some(issue=>issue.code==='SCHEMA')).toBe(true);
});
it('S010 rejects handler escape to the former loop or calling procedure',()=>{
  for(const exit of [{id:'exit',kind:'break'},{id:'exit',kind:'continue'},{id:'exit',kind:'return',values:{}}] as Statement[]){
    const result=validateFlowDefinition(flow([loop({handlers:{limit:[exit]}})]));
    expect(result.valid).toBe(false);
    expect(result.issues.some(issue=>['LOOP_BOUNDARY','RETURN_SCOPE'].includes(issue.code))).toBe(true);
  }
  expect(validateFlowDefinition(flow([loop({handlers:{limit:[{id:'inner',kind:'repeat',count:number(1),itemVariable:{id:'item',name:'Item',type:'Number'},body:[{id:'break',kind:'break'}]}]}})])).valid).toBe(true);
});
it('S013 rejects effectful deadline handlers and keeps reason bindings local',()=>{
  const reason={id:'reason',name:'Reason',type:{kind:'Enum' as const,values:[...LOOP_FAILURE_REASONS]}};
  const handler:Statement={id:'copy',kind:'declare',variable:{id:'local',name:'Local',type:reason.type},value:{kind:'variable',type:reason.type,variableId:'reason'}};
  expect(validateFlowDefinition(flow([loop({reason,handlers:{localDeadline:[handler]}})])).valid).toBe(true);
  expect(validateFlowDefinition(flow([loop({reason,handlers:{localDeadline:[],limit:[],conditionUnknown:[],evaluationError:[]}})])).valid).toBe(true);
  for(const operation of [{id:'wait',kind:'wait',duration:{kind:'literal',type:'Duration',value:1}},{id:'clock',kind:'readClock',output:{id:'time',name:'Time',type:'Instant'}}] as Statement[])
    expect(validateFlowDefinition(flow([loop({handlers:{localDeadline:[operation]}})])).issues.some(issue=>issue.code==='LOCAL_DEADLINE_EFFECT')).toBe(true);
  const invisible:Statement={id:'outside',kind:'declare',variable:{id:'copy2',name:'Copy',type:reason.type},value:{kind:'variable',type:reason.type,variableId:reason.id}};
  expect(validateFlowDefinition(flow([loop({reason,handlers:{limit:[handler]}}),invisible])).valid).toBe(false);
});
it('S014 selects the earliest expired local deadline, breaking ties outward',()=>{
  const outer=frame('body/0','2026-10-15T01:00:00.000Z'),inner=frame('body/0/body/0','2026-10-15T01:00:00.000Z'),resume=state([outer,inner]);
  expect(expiredLoopOwner(resume,new Date('2026-10-15T01:00:00Z'))?.frame).toBe(outer);
  inner.boundedLoop!.deadline='2026-10-15T00:59:00.000Z';
  expect(expiredLoopOwner(resume,new Date('2026-10-15T01:00:00Z'))?.frame).toBe(inner);
  expect(effectiveLoopDeadline(resume,resume,new Date('2026-10-22T00:00:00Z')).toISOString()).toBe('2026-10-15T00:59:00.000Z');
});
it('inherits an enclosing deadline into parallel children and freezes siblings in terminal mode',()=>{
  const outer=frame('body/0','2026-10-15T01:00:00.000Z'),resume=state([outer]),child={identity:'child',frames:[frame('child/0','2026-10-15T02:00:00.000Z')],variables:{}};
  const sibling={identity:'sibling',frames:[frame('sibling/0','2026-10-15T00:30:00.000Z')],variables:{}};
  resume.parallel={identity:'group',nodePath:'x',cursor:0,branches:[{id:'child',context:child},{id:'sibling',context:sibling}]};
  expect(effectiveLoopDeadline(resume,child,new Date('2026-10-22T00:00:00Z')).toISOString()).toBe(outer.boundedLoop!.deadline);
  expect(expiredLoopOwner(resume,new Date('2026-10-15T03:00:00Z'),child)?.frame).toBe(outer);
});
it('keeps a resumed loop identity stable while distinguishing the next iteration',()=>{
  const current=frame('body/0','2026-10-15T01:00:00.000Z'),run={id:'run',revision:1,semantic_hash:'hash'},first=dynamicExecutionIdentity(run,[current],'draw');
  expect(dynamicExecutionIdentity(run,[structuredClone(current)],'draw')).toBe(first);
  current.boundedLoop!.completed++;
  expect(dynamicExecutionIdentity(run,[current],'draw')).not.toBe(first);
});
it('T120 exposes search positions only inside the found branch',()=>{
  const type={kind:'Record' as const,schemaId:'nexus.index-result.v1'};
  const copy:Statement={id:'copy',kind:'declare',variable:{id:'copy-value',name:'Copy',type:'Number'},value:{kind:'variable',type:'Number',variableId:'position'}};
  const search:Statement={id:'search',kind:'searchBranch',value:{kind:'expression',type,expression:{operator:'list.indexOf',args:[{kind:'literal',type:{kind:'List',element:'Number'},value:[1,2]},number(2)]}},index:{id:'position',name:'Position',type:'Number'},found:[copy],notFound:[]};
  expect(validateFlowDefinition(flow([search])).valid).toBe(true);
  const rejected=validateFlowDefinition(flow([{...search,found:[],notFound:[copy]}]));
  expect(rejected.valid).toBe(false);expect(rejected.issues.some(issue=>issue.path.includes('notFound'))).toBe(true);
});
it('validates disabled and stored new operators with their explicit flow profile',()=>{
  const stored:Statement={id:'stored',kind:'declare',enabled:false,variable:{id:'stored-value',name:'Stored',type:'Number'},value:{kind:'expression',type:'Number',expression:{operator:'number.truncate',args:[number(1.2)]}}};
  expect(validateFlowDefinition(flow([stored])).valid).toBe(true);
  const detached=flow([]);detached.detached=[stored];expect(validateFlowDefinition(detached).valid).toBe(true);
  const legacy=flow([stored]);delete legacy.semanticProfile;
  expect(validateFlowDefinition(legacy).issues.some(issue=>issue.code==='SEMANTIC_PROFILE')).toBe(true);
});
it('accepts fixed, variable and computed bounds and preserves a missing deadline as incomplete',()=>{
  const declared:Statement={id:'bound',kind:'declare',variable:{id:'n',name:'Maximum',type:'Number'},value:number(3)};
  const bounds:ValueInput[]=[number(3),{kind:'variable',type:'Number',variableId:'n'},{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[number(30),number(10)]}}];
  for(const maxBody of bounds)expect(validateFlowDefinition(flow([declared,loop({maxBody})])).valid).toBe(true);
  const incomplete=validateFlowDefinition(flow([loop({until:{kind:'missing',type:'Instant'}})]));
  expect(incomplete.complete).toBe(false);expect(incomplete.issues.some(issue=>issue.code==='MISSING_INPUT')).toBe(true);
});
it('T111 gates explicit termination by profile, branch scope and dominating output bindings',()=>{
  const end:Statement={id:'branch-end',kind:'endBranch',semanticVersion:1};
  expect(validateFlowDefinition(flow([end])).issues.some(issue=>issue.code==='END_BRANCH_SCOPE')).toBe(true);
  const definition=flow([{id:'parallel',kind:'parallel',branches:[{id:'a',name:'A',body:[end],outputs:{answer:{kind:'variable',type:'Number',variableId:'late'}}}]}]);
  expect(validateFlowDefinition(definition).valid).toBe(false);
  const old=flow([{id:'end-run',kind:'endRun',semanticVersion:1}]);delete old.semanticProfile;
  expect(validateFlowDefinition(old).issues.some(issue=>issue.code==='SEMANTIC_PROFILE')).toBe(true);
});
