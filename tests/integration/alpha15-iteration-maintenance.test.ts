import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { iterationList, iterationResultType, iterationRow } from "../../packages/automation/src/iteration-results";
import { dynamicExecutionIdentity } from "../../packages/automation/src/runtime";
import { fenceRestoredAutomations, sweepAutomationRetention } from "../../packages/automation/src/retention";
import { AutomationService } from "../../packages/automation/src/service";
import type { Actor } from "../../packages/settings/src/index";
import type { ResumeState, RuntimeContext } from "../../packages/automation/src/store";
import type { FlowDefinition, JsonValue, Statement } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
function branch(identity: string, path: string): RuntimeContext {
  const results = iterationList("Number", 3, "884111111111111111");
  (results.value as JsonValue[])[0] = iterationRow(1, "SUCCEEDED", { type: "Number", value: 7, provenance: [] });
  return { identity, variables: { [`${identity}-results`]: results }, frames: [
    { path, index: 1, locals: [`${identity}-results`] },
    { path: `${path}/0/body`, index: 0, locals: [], loop: { nodePath: `${path}/0`, items: [1, 2, 3].map((value) => ({ type: "Number", value, provenance: [] })), iteration: 1, resultIds: [`${identity}-results`], resultIdentity: identity } },
  ] };
}
async function fixture(interrupted: boolean, consumed = true) {
  const scope = scopeForGuild(String(884880000000000000n + BigInt(++serial))), id = randomUUID(), now = new Date(), deadline = new Date(now.getTime() + 3600000);
  await ensureGuild(db, scope);
  const a = branch("branch-a", "body/0/branches/0/body"), b = branch("branch-b", "body/0/branches/1/body");
  const state: ResumeState = { frames: [{ path: "body", index: 1, locals: [] }], variables: {}, startedAt: now.toISOString(), steps: 10, evaluations: 10, externalActions: 1,
    parallel: { identity: "parallel", nodePath: "body/0", cursor: 0, branches: [{ id: "a", context: a }, { id: "b", context: b }] },
    iterations: [a, b].map((context) => ({ blockId: context.identity!, identity: context.identity!, states: ["SUCCEEDED", "NOT_STARTED", "NOT_STARTED"] })) };
  const body = (name: string): Statement[] => [{ id: `${name}-loop`, kind: "repeat", count: { kind: "literal", type: "Number", value: 3 }, itemVariable: { id: `${name}-item`, name: "item", type: "Number" },
    results: [{ output: { id: `${name}-results`, name: "results", type: { kind: "List", element: iterationResultType("Number") } }, value: { kind: "literal", type: "Number", value: 7 } }],
    body: name === "a" ? [{ id: "a-send", kind: "action", operation: "discord.sendMessage", inputs: { channel: { kind: "literal", type: "ChannelRef", value: { id: "884222222222222222", guildId: scope.guildId } }, content: { kind: "literal", type: "PlainText", value: "Synthetic template" } } }] : [{ id: "b-wait", kind: "wait", duration: { kind: "literal", type: "Duration", value: 10 } }],
  }];
  const definition: FlowDefinition = { schemaVersion: 1, id: "maintenance", guildId: scope.guildId, name: "Maintenance fixture", trigger: { kind: "manual", inputs: [] }, variables: [], body: [{ id: "parallel", kind: "parallel", branches: [{ id: "a", name: "A", body: body("a") }, { id: "b", name: "B", body: body("b") }] }] };
  const hash = "a".repeat(64);
  const checkpoint:ResumeState=consumed?state:{frames:[{path:'body',index:0,locals:[]}],variables:{},startedAt:now.toISOString(),steps:0,evaluations:0,externalActions:0};
  await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,state,draft_revision,active_revision,generation) VALUES(${scope.organizationId}::uuid,${scope.guildId},'maintenance','Maintenance fixture','ACTIVE',1,1,1)`.execute(db);
  await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${scope.organizationId}::uuid,${scope.guildId},'maintenance',1,${JSON.stringify(definition)}::jsonb,${hash},true)`.execute(db);
  await sql`INSERT INTO automation_usage_months(organization_id,guild_id,month,reserved,consumed) VALUES(${scope.organizationId}::uuid,${scope.guildId},date_trunc('month',${now}::timestamptz)::date,${consumed ? 0 : 1},${consumed ? 1 : 0})`.execute(db);
  await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,status,usage_state,usage_month,started_at,deadline_at,resume) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,'maintenance',1,${hash},'maintenance','synthetic','synthetic','synthetic',${consumed?'WAITING':'QUEUED'},${consumed ? "CONSUMED" : "RESERVED"},date_trunc('month',${now}::timestamptz)::date,${now},${deadline},${JSON.stringify(checkpoint)}::jsonb)`.execute(db);
  const operation = dynamicExecutionIdentity({ id, revision: 1, semantic_hash: hash }, a.frames, "a-send", a.identity);
  if (interrupted) await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,${operation},'discord.sendMessage','synthetic','STARTED')`.execute(db);
  if(consumed)await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state,result) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,'confirmed-previous','discord.sendMessage','synthetic','SUCCEEDED','{"type":"Number","value":7,"provenance":[]}'::jsonb)`.execute(db);
  return { scope, id, now, deadline, operation };
}
async function saved(f: Awaited<ReturnType<typeof fixture>>) {
  return (await sql<{ status: string; usage_state: string; resume: ResumeState; reason: string }>`SELECT status,usage_state,resume,reason FROM automation_runs WHERE ${tenant(f.scope)} AND id=${f.id}::uuid`.execute(db)).rows[0]!;
}
function states(state: ResumeState, index: number) {
  const context = state.parallel!.branches[index]!.context;
  return (context.variables[`${context.identity}-results`]!.value as { state: string }[]).map((row) => row.state);
}
it("deadline maintenance cancels unfinished items without fabricating confirmed failures or refunding consumed usage", async () => {
  const f = await fixture(false);
  await sweepAutomationRetention(db, new Date(f.deadline.getTime() + 1));
  const row = await saved(f);
  expect(row).toMatchObject({ status: "EXPIRED", reason: "RUN_DEADLINE", usage_state: "CONSUMED" });
  expect(states(row.resume, 0)).toEqual(["SUCCEEDED", "CANCELLED", "NOT_STARTED"]);
  expect(states(row.resume, 1)).toEqual(["SUCCEEDED", "CANCELLED", "NOT_STARTED"]);
});
it("deadline maintenance identifies the exact interrupted branch before a result checkpoint", async () => {
  const f = await fixture(true);
  await sweepAutomationRetention(db, new Date(f.deadline.getTime() + 1));
  const row = await saved(f);
  expect(row.status).toBe("UNKNOWN");
  expect(states(row.resume, 0)).toEqual(["SUCCEEDED", "UNKNOWN", "NOT_STARTED"]);
  expect(states(row.resume, 1)).toEqual(["SUCCEEDED", "CANCELLED", "NOT_STARTED"]);
  expect((await sql`SELECT state,result FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.id}::uuid AND identity='confirmed-previous'`.execute(db)).rows[0]).toEqual({ state: "SUCCEEDED", result: { type: "Number", value: 7, provenance: [] } });
});
it("restore fences only the genuinely interrupted branch while retaining previous confirmed results", async () => {
  const f = await fixture(true);
  await db.transaction().execute((tx) => fenceRestoredAutomations(tx, f.now));
  const row = await saved(f);
  expect(row).toMatchObject({ status: "UNKNOWN", reason: "RESTORE_REVIEW_REQUIRED" });
  expect(states(row.resume, 0)).toEqual(["SUCCEEDED", "UNKNOWN", "NOT_STARTED"]);
  expect(states(row.resume, 1)).toEqual(["SUCCEEDED", "CANCELLED", "NOT_STARTED"]);
  expect((await sql`SELECT identity,state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.id}::uuid ORDER BY identity`.execute(db)).rows).toEqual(expect.arrayContaining([{ identity: f.operation, state: "UNKNOWN" }, { identity: "confirmed-previous", state: "SUCCEEDED" }]));
});
it("restore cancels unstarted work and releases only its reserved quota", async () => {
  const f = await fixture(false, false);
  await db.transaction().execute((tx) => fenceRestoredAutomations(tx, f.now));
  const row = await saved(f);
  expect(row).toMatchObject({ status: "CANCELLED", usage_state: "RELEASED" });
  expect(row.resume.iterations).toBeUndefined();
  expect(row.resume.parallel).toBeUndefined();
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{ reserved: 0, consumed: 0 }]);
});
it("restore invalidates prior checks and old enable receipts until fresh review and explicit activation", async () => {
  const scope=scopeForGuild(String(884890000000000000n+BigInt(++serial)));
  await ensureGuild(db,scope);
  const actor:Actor={key:createHash('sha256').update('synthetic-reviewer').digest('hex'),encryptedUserId:'synthetic-ciphertext',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
  const service=new AutomationService(db,{authorize:async()=>{},admission:{activeFlows:20,monthlyRuns:100,guildConcurrent:1,globalConcurrent:2,guildPending:20,globalPending:100,measurementId:'isolated-maintenance'}});
  const definition:FlowDefinition={schemaVersion:1,id:'restore-review',guildId:scope.guildId,name:'Restore review fixture',trigger:{kind:'manual',inputs:[]},variables:[],body:[{kind:'end',id:'end'}]};
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(scope,actor,definition.id,1,kind);
  const input={revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()};
  await service.enable(scope,actor,definition.id,input);
  await db.transaction().execute(tx=>fenceRestoredAutomations(tx));
  await expect(service.enable(scope,actor,definition.id,input)).rejects.toThrow('AUTOMATION_REQUEST_STALE');
  const fresh={...input,requestId:randomUUID()};
  await expect(service.enable(scope,actor,definition.id,fresh)).rejects.toThrow('AUTOMATION_REVIEW_REQUIRED');
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(scope,actor,definition.id,1,kind);
  await expect(service.enable(scope,actor,definition.id,fresh)).resolves.toMatchObject({state:'ACTIVE',activeRevision:1});
  expect((await sql`SELECT count(*)::integer AS n FROM automation_runs WHERE ${tenant(scope)}`.execute(db)).rows).toEqual([{n:0}]);
});
