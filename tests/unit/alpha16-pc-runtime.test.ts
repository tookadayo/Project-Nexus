import {expect,it,vi} from "vitest";
import type {Database} from "../../packages/db/src/index";
import {Alpha16PcRuntime,type Alpha16PcRuntimeOptions} from "../../apps/worker/src/alpha16-pc-runtime";

const scope={organizationId:"11111111-1111-4111-8111-111111111111",guildId:"123456789012345678"};
function options():Alpha16PcRuntimeOptions {
  const expiresAt=new Date(Date.now()+60000);
  return {
    profile:async()=>({enabled:true,revision:"synthetic-supervisor",expiresAt,maxEvaluationJobsPerScope:1,maxTrackedScopes:1}),
    operator:{startupPass:vi.fn(async()=>({ready:false,processed:0,blockers:["DELETION_PURGE_PENDING"]})),tick:vi.fn(async()=>({ready:false,processed:0,blockers:["DELETION_PURGE_PENDING"]}))},
    retention:{tickGlobal:vi.fn(async()=>({ready:false,reason:"GLOBAL_RETENTION_ENFORCEMENT_NOT_CONFIGURED"})),tick:vi.fn(async()=>({ready:false,reason:"RETENTION_ENFORCEMENT_NOT_CONFIGURED"}))},
    // No Rule claim can be reached while either preceding privacy gate is
    // closed; this fixture supplies no operational authorization or policy.
    rules:{} as Alpha16PcRuntimeOptions["rules"],
  };
}
it("keeps an unconfigured host inert without requiring database access",async()=>{
  const runtime=new Alpha16PcRuntime({} as Database);
  expect(await runtime.tick(scope)).toEqual({enabled:false,processed:0,reasonCode:"PC_RULE_RUNTIME_UNCONFIGURED"});
  expect(await runtime.tickGlobal()).toEqual({enabled:false,reasonCode:"PC_RULE_RUNTIME_UNCONFIGURED"});
});
it("keeps generation closed while independent retention can inspect its own deletion prerequisite",async()=>{
  const configured=options(),runtime=new Alpha16PcRuntime({} as Database,configured);
  expect(await runtime.tick(scope)).toMatchObject({processed:0,reasonCode:"DELETION_RECONCILIATION_REQUIRED"});
  expect(configured.retention.tick).toHaveBeenCalledWith(scope);
  expect(await runtime.tickGlobal()).toMatchObject({deletionReady:false,reasonCode:"DELETION_RECONCILIATION_REQUIRED"});
  expect(configured.retention.tickGlobal).toHaveBeenCalled();
});
it("requires scope retention before discovering queued evaluations",async()=>{
  const configured=options();configured.operator.tick=vi.fn(async()=>({ready:true,processed:0,blockers:[]}));
  const runtime=new Alpha16PcRuntime({} as Database,configured);
  expect(await runtime.tick(scope)).toMatchObject({processed:0,reasonCode:"RETENTION_ENFORCEMENT_REQUIRED"});
  expect(configured.retention.tick).toHaveBeenCalledWith(scope);
});
it("does not turn unconfirmed publication withdrawal into a global deletion failure",async()=>{
  const configured=options();configured.operator.startupPass=vi.fn(async()=>({ready:true,processed:0,blockers:[]}));
  configured.retention.tickGlobal=vi.fn(async()=>({ready:false,cleanupComplete:true,externalPublicationReady:false,withdrawalRequirements:[]}));
  const result=await new Alpha16PcRuntime({} as Database,configured).tickGlobal();
  expect(result).toMatchObject({enabled:true,deletionReady:true,publication:{externalPublicationReady:false}});
});
it("continues independently approved maintenance after generation is disabled",async()=>{
  const configured=options();configured.profile=async()=>null;
  configured.operator.tick=vi.fn(async()=>({ready:true,processed:0,blockers:[]}));
  configured.retention.tick=vi.fn(async()=>({ready:true}));
  expect(await new Alpha16PcRuntime({} as Database,configured).tick(scope)).toMatchObject({enabled:false,processed:0});
  expect(configured.operator.tick).toHaveBeenCalled();expect(configured.retention.tick).toHaveBeenCalledWith(scope);
});
it("still checks independent expiry when the operator dependency throws",async()=>{
  const configured=options();configured.operator.tick=vi.fn(async()=>{throw new Error("SYNTHETIC_OPERATOR_OUTAGE");});
  configured.operator.startupPass=vi.fn(async()=>{throw new Error("SYNTHETIC_OPERATOR_OUTAGE");});
  const runtime=new Alpha16PcRuntime({} as Database,configured);
  expect(await runtime.tick(scope)).toMatchObject({processed:0,reasonCode:"DELETION_RECONCILIATION_REQUIRED"});
  expect(configured.retention.tick).toHaveBeenCalledWith(scope);
  expect(await runtime.tickGlobal()).toMatchObject({deletionReady:false});
  expect(configured.retention.tickGlobal).toHaveBeenCalled();
});
