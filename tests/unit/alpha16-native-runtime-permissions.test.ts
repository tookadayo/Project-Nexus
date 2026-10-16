import {describe,it,expect} from 'vitest';
import {nativeExecutionObservations,nativeFlowPermissionRequirements,nativePermissionCounts} from '../../packages/rules/src/native-execution-permission-projections';
import {projectRuntimeAnomalies} from '../../packages/rules/src/source-adapters';
import type {FlowDefinition,Statement} from '../../packages/automation/src/types';
import {nativeExecutionFixture,nativeObservationAsOf,nativePermissionFixture} from '../fixtures/alpha16-native-runtime-permissions';

describe('AUTO002 native Run observations (source-only fixtures)',()=>{
 it('counts one Run once, excludes a future wait and unions overdue/heartbeat/deadline causes',()=>{
  const due=new Date('2026-10-16T11:00:00Z'),future=new Date('2026-10-16T13:00:00Z');
  const rows=[nativeExecutionFixture('running'),nativeExecutionFixture('queued','QUEUED',{heartbeat_at:null,due_at:due}),nativeExecutionFixture('future','WAITING',{due_at:future,wake_at:future}),nativeExecutionFixture('overdue','WAITING_APPROVAL',{due_at:due,wake_at:due})];
  const result=nativeExecutionObservations(rows,nativeObservationAsOf);
  // Grace periods are fixture inputs only, never app defaults.
  expect(projectRuntimeAnomalies(result.observed,nativeObservationAsOf,60,1,result.expected)).toMatchObject({expected:'4',observed:'4',eligible:'3',anomalous:'3',projectionAsOf:nativeObservationAsOf});
  expect(result.observed.every(row=>row.leaseExpiresAt===null)).toBe(true);
 });
 it('does not use updated_at or an old unobserved row as heartbeat, and preserves UNKNOWN coverage',()=>{
  const terminal=new Date('2026-10-16T11:30:00Z');
  const rows=[nativeExecutionFixture('legacy','RUNNING',{observation_revision:null,heartbeat_at:null}),nativeExecutionFixture('missing-heartbeat','RUNNING',{heartbeat_at:null}),nativeExecutionFixture('unknown','UNKNOWN',{ended_at:terminal,terminal_at:terminal}),nativeExecutionFixture('known')];
  const result=nativeExecutionObservations(rows,nativeObservationAsOf);
  expect(result.expected).toBe('4');expect(result.observed.map(row=>row.executionRef)).toEqual(['known']);
 });
 it('rejects duplicate execution identities and excludes contradictory/future source rows',()=>{
  expect(()=>nativeExecutionObservations([nativeExecutionFixture('one'),nativeExecutionFixture('one')],nativeObservationAsOf)).toThrow('RULE_NATIVE_EXECUTION_ROWS_INVALID');
  expect(nativeExecutionObservations([nativeExecutionFixture('future','RUNNING',{observed_at:new Date('2026-10-16T13:00:00Z')})],nativeObservationAsOf).observed).toEqual([]);
  expect(nativeExecutionObservations([nativeExecutionFixture('bad','WAITING',{due_at:new Date('2026-10-19T00:00:00Z'),wake_at:new Date('2026-10-19T00:00:00Z')})],nativeObservationAsOf).observed).toEqual([]);
 });
 it('keeps empty execution coverage empty, never a fabricated healthy denominator',()=>{
  const result=nativeExecutionObservations([],nativeObservationAsOf);
  expect(projectRuntimeAnomalies(result.observed,nativeObservationAsOf,0,0,result.expected)).toMatchObject({expected:'0',observed:'0',eligible:'0',anomalous:'0'});
 });
});
describe('PERM current native requirement/observation pairing',()=>{
 const guildId='123456789012345678',channel='123456789012345679',role='123456789012345682';
 const action=(id:string,operation:'discord.addRole'|'discord.sendMessage',target:string):Statement=>({id,kind:'action',operation,inputs:operation==='discord.addRole'?{role:{kind:'literal',type:'RoleRef',value:{id:target,guildId}}}:{channel:{kind:'literal',type:'ChannelRef',value:{id:target,guildId}}}});
 const flow=(body:Statement[]):FlowDefinition=>({schemaVersion:1,id:'flow',guildId,name:'fixture',trigger:{kind:'manual',inputs:[]},variables:[],body,targets:{roleIds:[role],channelIds:[channel],parentCategoryIds:[]}});
 it('reads only reachable enabled statements/procedures and deduplicates permission atoms',()=>{
  const source=flow([action('send','discord.sendMessage',channel),{...action('off','discord.addRole',role),enabled:false},{id:'call',kind:'call',procedureId:'reachable',revision:1,args:{},outputs:{}}]);
  source.procedures=[{id:'reachable',revision:1,name:'one',inputs:[],outputs:[],body:[action('grant','discord.addRole',role),action('send-again','discord.sendMessage',channel)]},{id:'unused',revision:1,name:'two',inputs:[],outputs:[],body:[{id:'edit',kind:'action',operation:'discord.editOwnMessage',inputs:{}}]}];
  expect(nativeFlowPermissionRequirements(source)).toEqual([{kind:'BOT_MANAGE_ROLES',targetId:guildId},{kind:'CHANNEL_SEND_MESSAGES',targetId:channel},{kind:'CHANNEL_VIEW',targetId:channel},{kind:'ROLE_ASSIGNABLE',targetId:role}]);
 });
 it('does not turn missing finite target binding or a recursive procedure into an implicit global permission',()=>{
  const source=flow([action('unbound','discord.addRole','123456789012345699'),{id:'call',kind:'call',procedureId:'missing',revision:1,args:{},outputs:{}}]);
  expect(nativeFlowPermissionRequirements(source)).toContainEqual({kind:'UNRESOLVED_NATIVE_REQUIREMENT',targetId:'flow'});
 });
 it('confirms only saved capabilities and keeps channel overwrites, role hierarchy and obfuscated visibility UNKNOWN',()=>{
  const result=nativePermissionCounts([{kind:'BOT_MANAGE_ROLES',targetId:guildId},{kind:'CHANNEL_VIEW',targetId:channel},{kind:'CHANNEL_SEND_MESSAGES',targetId:channel},{kind:'CHANNEL_VIEW',targetId:'123456789012345680'},{kind:'ROLE_ASSIGNABLE',targetId:role},{kind:'NATIVE_ONBOARDING',targetId:guildId}],nativePermissionFixture());
  expect(result).toEqual({kind:'permissions',required:'6',allowed:'1',denied:'2',unknown:'3',suppressed:'0',requirementRegistered:true});
 });
 it('keeps suppressed and empty observations distinct from confirmed deny/healthy',()=>{
  expect(nativePermissionCounts([{kind:'CHANNEL_VIEW',targetId:'123456789012345681'}],nativePermissionFixture())).toMatchObject({denied:'0',suppressed:'1'});
  expect(nativePermissionCounts([],nativePermissionFixture())).toMatchObject({required:'0',allowed:'0',denied:'0'});
 });
});
