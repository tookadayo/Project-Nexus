import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,json,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {AutomationAwaits,acknowledgeAutomationAwait,type AwaitRegistration} from '../../packages/automation/src/await';
import {fenceRestoredAutomations} from '../../packages/automation/src/retention';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const channel='885333333333333333';
beforeAll(async()=>{
  vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);
  await migrate(db,{throughVersion:52});
  for(const name of ['054_alpha15_automation','057_alpha15_events','058_alpha15_waits','059_alpha15_schedule_reviews'])
    await sql.raw(await readFile(new URL(`../../migrations/${name}.sql`,import.meta.url),'utf8')).execute(db);
});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(ticketId='intake:'+randomUUID(),sameScope?:ReturnType<typeof scopeForGuild>){
  const s=sameScope??scopeForGuild(String(887000000000000000n+BigInt(++serial))),flowId='await-'+randomUUID(),runId=randomUUID(),now=new Date(),deadline=new Date(now.getTime()+86400000);
  await ensureGuild(db,s);
  await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision,active_revision,state,generation) VALUES(${s.organizationId}::uuid,${s.guildId},${flowId},'Synthetic await',1,1,'ACTIVE',1)`.execute(db);
  const definition={schemaVersion:1,id:flowId,name:'Synthetic await',guildId:s.guildId,trigger:{kind:'manual',inputs:[]},variables:[],body:[{kind:'end',id:'end'}]};
  await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${s.organizationId}::uuid,${s.guildId},${flowId},1,${json(definition)},${'a'.repeat(64)},true)`.execute(db);
  await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,status,usage_month,started_at,deadline_at,resume) VALUES(${s.organizationId}::uuid,${s.guildId},${runId}::uuid,${flowId},1,${'a'.repeat(64)},${randomUUID()},${'b'.repeat(64)},'synthetic-actor','synthetic-encrypted-identity','RUNNING',${now.toISOString().slice(0,7)+'-01'}::date,${now},${deadline},${json({frames:[],variables:{},startedAt:now.toISOString(),steps:0,evaluations:0,externalActions:0})})`.execute(db);
  const panel=randomUUID();
  await db.transaction().execute(async tx=>{
    await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,state,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${panel}::uuid,'Synthetic intake','support','PUBLISHED','synthetic-actor')`.execute(tx);
    await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,evidence) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},${ticketId},now(),'OPEN','OPERATIONS_REQUEST',${json({privateBody:'NEVER_COPY_AWAIT_BODY',profile:'NEVER_COPY_AWAIT_PROFILE'})})`.execute(tx);
    await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${s.organizationId}::uuid,${s.guildId},${ticketId.slice(7)}::uuid,${panel}::uuid,${randomUUID()},'synthetic-requester','support','synthetic-secret-fields',${ticketId})`.execute(tx);
  });
  const authorize=vi.fn(async()=>({allowedChannelIds:[channel]})),waits=new AutomationAwaits(db,{authorize});
  const input:AwaitRegistration={identity:createHash('sha256').update(runId).digest('hex'),ticketId,event:'ticketUpdated',states:['RESOLVED'],expiresAt:new Date(now.getTime()+3600000)};
  return {s,flowId,runId,ticketId,deadline,input,waits,authorize};
}
async function update(f:Awaited<ReturnType<typeof fixture>>,state:string,version:number){
  await sql`UPDATE attention_items SET status=${state},version=${version} WHERE ${tenant(f.s)} AND message_id=${f.ticketId}`.execute(db);
}
async function rows(f:Awaited<ReturnType<typeof fixture>>){
  return (await sql<Record<string,unknown>>`SELECT * FROM automation_event_waits WHERE ${tenant(f.s)} AND run_id=${f.runId}::uuid`.execute(db)).rows;
}

it('captures only the first matching post-registration ticket update and fixes its result on resume',async()=>{
  const f=await fixture();await update(f,'ACKNOWLEDGED',1);
  expect(await f.waits.register(f.s,f.runId,f.input)).toMatchObject({state:'PENDING'});
  await update(f,'IN_PROGRESS',2);expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'PENDING'});
  await update(f,'RESOLVED',3);
  const first=await f.waits.resume(f.s,f.runId,f.input.identity);
  expect(first).toMatchObject({state:'MATCHED',value:{state:'RESOLVED',version:3}});
  await update(f,'OPEN',4);await update(f,'RESOLVED',5);
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toEqual(first);
  expect(await f.waits.register(f.s,f.runId,f.input)).toEqual(first);
  const stored=JSON.stringify(await rows(f));
  expect(stored).not.toContain('NEVER_COPY');expect(stored).not.toContain('synthetic-secret-fields');
  expect(stored).not.toContain('synthetic-requester');expect(f.authorize.mock.calls.length).toBeGreaterThanOrEqual(4);
});
it('does not replay old matching history or wake on another guild or ticket',async()=>{
  const f=await fixture();await update(f,'RESOLVED',1);await f.waits.register(f.s,f.runId,f.input);
  const differentGuild=await fixture(f.ticketId),differentTicket=await fixture(undefined,f.s);
  await update(differentGuild,'RESOLVED',1);await update(differentTicket,'RESOLVED',1);
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'PENDING'});
  await update(f,'ACKNOWLEDGED',2);await update(f,'RESOLVED',3);
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'MATCHED',value:{version:3}});
});
it('does not lose an event whose source transaction started before registration and commits afterwards',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  const source=db.transaction().execute(async tx=>{
    await sql`UPDATE attention_items SET status='RESOLVED',version=1 WHERE ${tenant(f.s)} AND message_id=${f.ticketId}`.execute(tx);
    entered();await gate;
  });
  await ready;
  try{expect(await f.waits.register(f.s,f.runId,f.input)).toMatchObject({state:'PENDING'});}finally{release();}
  await source;
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'MATCHED',value:{version:1}});
});
it('wakes a matching receipt even if the runtime saves its WAITING checkpoint after capture',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);await update(f,'RESOLVED',1);
  await sql`UPDATE automation_runs SET status='WAITING',wake_at=${f.input.expiresAt} WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db);
  const run=(await sql<{wake_at:Date}>`SELECT wake_at FROM automation_runs WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db)).rows[0]!;
  expect(run.wake_at.getTime()).toBeLessThanOrEqual(Date.now()+1000);
  await db.transaction().execute(async tx=>{
    await acknowledgeAutomationAwait(tx,f.s,f.runId,f.input.identity);
    await sql`UPDATE automation_runs SET status='WAITING',wake_at=${f.input.expiresAt} WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(tx);
  });
  const later=(await sql<{wake_at:Date}>`SELECT wake_at FROM automation_runs WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db)).rows[0]!;
  expect(later.wake_at).toEqual(f.input.expiresAt);
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'MATCHED',value:{version:1}});
});
it('rolls back acknowledgment together with a failed cursor checkpoint',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);await update(f,'RESOLVED',1);
  await expect(db.transaction().execute(async tx=>{
    await acknowledgeAutomationAwait(tx,f.s,f.runId,f.input.identity);
    await sql`UPDATE automation_runs SET status='WAITING',wake_at=${f.input.expiresAt} WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(tx);
    throw new Error('SYNTHETIC_CHECKPOINT_FAILURE');
  })).rejects.toThrow('SYNTHETIC_CHECKPOINT_FAILURE');
  expect((await rows(f))[0]).toMatchObject({state:'MATCHED',consumed_at:null});
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'MATCHED',value:{version:1}});
});
it('preserves the event wake when a parallel approval branch checkpoints WAITING_APPROVAL after capture',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);await update(f,'RESOLVED',1);
  const captured=(await sql<{wake_at:Date}>`SELECT wake_at FROM automation_runs WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db)).rows[0]!.wake_at;
  await sql`UPDATE automation_runs SET status='WAITING_APPROVAL',wake_at=${f.input.expiresAt} WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db);
  const checkpoint=(await sql<{status:string;wake_at:Date}>`SELECT status,wake_at FROM automation_runs WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db)).rows[0]!;
  expect(checkpoint.status).toBe('WAITING_APPROVAL');
  expect(checkpoint.wake_at.getTime()).toBeLessThanOrEqual(Date.now()+1000);
  expect(checkpoint.wake_at.getTime()).toBeLessThan(f.input.expiresAt.getTime());
  expect(checkpoint.wake_at.getTime()).toBeLessThanOrEqual(captured.getTime());
  await db.transaction().execute(async tx=>{
    await acknowledgeAutomationAwait(tx,f.s,f.runId,f.input.identity);
    await sql`UPDATE automation_runs SET status='WAITING_APPROVAL',wake_at=${f.input.expiresAt} WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(tx);
  });
  const consumed=(await sql<{wake_at:Date}>`SELECT wake_at FROM automation_runs WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db)).rows[0]!;
  expect(consumed.wake_at).toEqual(f.input.expiresAt);
});
it('requires current authorization on registration and after a matching event',async()=>{
  const f=await fixture();f.authorize.mockRejectedValueOnce(new Error('SYNTHETIC_READ_DENIED'));
  await expect(f.waits.register(f.s,f.runId,f.input)).rejects.toThrow('SYNTHETIC_READ_DENIED');expect(await rows(f)).toEqual([]);
  await f.waits.register(f.s,f.runId,f.input);await update(f,'RESOLVED',1);
  f.authorize.mockRejectedValueOnce(new Error('SYNTHETIC_READ_DENIED'));
  await expect(f.waits.resume(f.s,f.runId,f.input.identity)).rejects.toThrow('SYNTHETIC_READ_DENIED');
  f.authorize.mockResolvedValueOnce({allowedChannelIds:[]});
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'MATCHED',allowedChannelIds:[]});
  const invalid=await fixture();invalid.authorize.mockResolvedValueOnce(undefined as never);
  await expect(invalid.waits.register(invalid.s,invalid.runId,invalid.input)).rejects.toThrow('AUTOMATION_AWAIT_AUTHORIZATION_REQUIRED');
});
it('times out at the registered deadline and erases the ticket correlation without matching late events',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);
  const late=new AutomationAwaits(db,{authorize:f.authorize,now:()=>f.input.expiresAt});
  expect(await late.resume(f.s,f.runId,f.input.identity)).toEqual({state:'TIMED_OUT'});
  expect((await rows(f))[0]).toMatchObject({state:'TIMED_OUT',ticket_id:null,matched_version:null});
  await update(f,'RESOLVED',1);expect(await late.resume(f.s,f.runId,f.input.identity)).toEqual({state:'TIMED_OUT'});
});
it('does not capture a trusted update after expiry even before a worker polls the timeout',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);
  await sql`UPDATE automation_event_waits SET registered_at=registered_at-interval '2 hours',expires_at=expires_at-interval '2 hours' WHERE ${tenant(f.s)} AND run_id=${f.runId}::uuid`.execute(db);
  await update(f,'RESOLVED',1);
  expect((await rows(f))[0]).toMatchObject({state:'PENDING',matched_version:null});
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toEqual({state:'TIMED_OUT'});
});
it('refuses an ordinary attention event after the correlated item is no longer an OperationsIntake request',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);
  await sql`UPDATE attention_items SET item_type='FORUM_SUPPORT' WHERE ${tenant(f.s)} AND message_id=${f.ticketId}`.execute(db);
  await update(f,'RESOLVED',1);
  expect((await rows(f))[0]).toMatchObject({state:'PENDING',matched_version:null});
});
it('rejects arbitrary references, event kinds, forged eligibility and beyond-Run deadlines',async()=>{
  const f=await fixture();
  await expect(f.waits.register(f.s,f.runId,{...f.input,ticketId:'885111111111111111'})).rejects.toThrow('AUTOMATION_AWAIT_INVALID');
  await expect(f.waits.register(f.s,f.runId,{...f.input,event:'interaction' as never})).rejects.toThrow('AUTOMATION_AWAIT_INVALID');
  await expect(f.waits.register(f.s,f.runId,{...f.input,states:['ADMIN' as never]})).rejects.toThrow('AUTOMATION_AWAIT_STATES_INVALID');
  await expect(f.waits.register(f.s,f.runId,{...f.input,states:['OPEN','OPEN']})).rejects.toThrow('AUTOMATION_AWAIT_STATES_INVALID');
  await expect(f.waits.register(f.s,f.runId,{...f.input,expiresAt:new Date(f.deadline.getTime()+1)})).rejects.toThrow('AUTOMATION_AWAIT_DEADLINE_INVALID');
  await f.waits.register(f.s,f.runId,f.input);
  await expect(f.waits.register(f.s,f.runId,{...f.input,states:['OPEN']})).rejects.toThrow('AUTOMATION_AWAIT_INPUT_MISMATCH');
});
it('cancels pending and matched receipts atomically when the Run is cancelled',async()=>{
  for(const matched of [false,true]){
    const f=await fixture();await f.waits.register(f.s,f.runId,f.input);if(matched)await update(f,'RESOLVED',1);
    await sql`UPDATE automation_runs SET cancel_requested_at=now() WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db);
    expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toEqual({state:'CANCELLED'});
    expect((await rows(f))[0]).toMatchObject({ticket_id:null,matched_state:null,matched_version:null,occurred_at:null});
  }
});
it('fences a stop and immediate resume between worker passes',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);
  await sql`INSERT INTO guild_settings(organization_id,guild_id,settings) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${json({enabled:false})}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET settings=EXCLUDED.settings`.execute(db);
  await sql`UPDATE guild_settings SET settings=${json({enabled:true})} WHERE ${tenant(f.s)}`.execute(db);
  await update(f,'RESOLVED',1);
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toEqual({state:'CANCELLED'});
});
it('fences a disabled definition and restored continuations',async()=>{
  const changed=await fixture();await changed.waits.register(changed.s,changed.runId,changed.input);
  await sql`UPDATE automation_flows SET state='DISABLED',generation=generation+1 WHERE ${tenant(changed.s)} AND id=${changed.flowId}`.execute(db);
  expect(await changed.waits.resume(changed.s,changed.runId,changed.input.identity)).toEqual({state:'CANCELLED'});
  const restored=await fixture();await restored.waits.register(restored.s,restored.runId,restored.input);await update(restored,'RESOLVED',1);
  await db.transaction().execute(tx=>fenceRestoredAutomations(tx));
  expect(await restored.waits.resume(restored.s,restored.runId,restored.input.identity)).toEqual({state:'CANCELLED'});
});
it('keeps the original Run revision when a newer revision is enabled before or during a wait',async()=>{
  for(const registered of [false,true]){
    const f=await fixture();if(registered)await f.waits.register(f.s,f.runId,f.input);
    await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) SELECT organization_id,guild_id,flow_id,2,definition,semantic_hash,complete FROM automation_revisions WHERE ${tenant(f.s)} AND flow_id=${f.flowId} AND revision=1`.execute(db);
    await sql`UPDATE automation_flows SET active_revision=2,draft_revision=2,generation=generation+1 WHERE ${tenant(f.s)} AND id=${f.flowId}`.execute(db);
    if(!registered)await f.waits.register(f.s,f.runId,f.input);
    await update(f,'RESOLVED',1);
    expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toMatchObject({state:'MATCHED',value:{version:1}});
    expect((await rows(f))[0]).toMatchObject({revision:1});
  }
});
it('erases a deleted ticket correlation immediately and inherits Run retention cascading deletion',async()=>{
  const f=await fixture();await f.waits.register(f.s,f.runId,f.input);await update(f,'RESOLVED',1);
  await sql`DELETE FROM operations_requests WHERE ${tenant(f.s)} AND id=${f.ticketId.slice(7)}::uuid`.execute(db);
  expect((await rows(f))[0]).toMatchObject({state:'CANCELLED',ticket_id:null,matched_state:null,matched_version:null});
  expect(await f.waits.resume(f.s,f.runId,f.input.identity)).toEqual({state:'CANCELLED'});
  await sql`DELETE FROM automation_runs WHERE ${tenant(f.s)} AND id=${f.runId}::uuid`.execute(db);
  expect(await rows(f)).toEqual([]);
});
