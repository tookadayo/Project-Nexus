import {readFileSync} from "node:fs";
import * as ts from "typescript";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {Database} from "../../packages/db/src/index";
import {runCommunityMaintenance} from "../../apps/worker/src/community-work";

const fence=vi.hoisted(()=>({held:false,events:[] as string[],betaWork:vi.fn()}));
vi.mock("../../packages/security/src/hosted-beta",()=>({betaWork:fence.betaWork}));
const scope={organizationId:"00000000-0000-4000-8000-000000000001",guildId:"123456789012345678"};
const db={} as Database;

beforeEach(()=>{
 fence.held=false;fence.events=[];fence.betaWork.mockReset();
 fence.betaWork.mockImplementation(async(_db:Database,_scope:typeof scope,work:()=>Promise<void>)=>{
  fence.held=true;fence.events.push("legacy-fence-acquired");
  try{return await work();}finally{fence.held=false;fence.events.push("legacy-fence-released");}
 });
});

describe("community worker privacy lock composition",()=>{
 it("releases the separate-connection legacy fence before entering canonical community work",async()=>{
  const result=await runCommunityMaintenance(db,scope,async()=>{
   expect(fence.held).toBe(true);fence.events.push("legacy-work");
  },async()=>{
   expect(fence.held).toBe(false);fence.events.push("community-canonical-work");return "completed";
  });
  expect(result).toBe("completed");
  expect(fence.betaWork).toHaveBeenCalledExactlyOnceWith(db,scope,expect.any(Function));
  expect(fence.events).toEqual(["legacy-fence-acquired","legacy-work","legacy-fence-released","community-canonical-work"]);
 });
 it("does not bypass a rejected Beta access check",async()=>{
  fence.betaWork.mockRejectedValueOnce(new Error("BETA_UNAVAILABLE"));
  const legacy=vi.fn(async()=>{}),community=vi.fn(async()=>true);
  await expect(runCommunityMaintenance(db,scope,legacy,community)).rejects.toThrow("BETA_UNAVAILABLE");
  expect(legacy).not.toHaveBeenCalled();expect(community).not.toHaveBeenCalled();
 });
 it("releases a failed legacy fence and does not start or retry community work",async()=>{
  const community=vi.fn(async()=>true);
  await expect(runCommunityMaintenance(db,scope,async()=>{throw new Error("LEGACY_FAILURE");},community)).rejects.toThrow("LEGACY_FAILURE");
  expect(fence.held).toBe(false);expect(community).not.toHaveBeenCalled();expect(fence.betaWork).toHaveBeenCalledTimes(1);
 });
 it("propagates community failure after release without automatic repetition",async()=>{
  const community=vi.fn(async()=>{expect(fence.held).toBe(false);throw new Error("COMMUNITY_FAILURE");});
  await expect(runCommunityMaintenance(db,scope,async()=>{},community)).rejects.toThrow("COMMUNITY_FAILURE");
  expect(fence.held).toBe(false);expect(community).toHaveBeenCalledTimes(1);expect(fence.betaWork).toHaveBeenCalledTimes(1);
 });
 it("keeps the actual dev composition on this tested boundary outside betaWork",()=>{
  // Importing scripts/runtime would start workers/listeners. Inspect its wiring
  // separately; the four runtime tests above exercise the callable protocol.
  const source=ts.createSourceFile("scripts/runtime.ts",readFileSync(new URL("../../scripts/runtime.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const calls:{node:ts.CallExpression;insideLegacyFence:boolean}[]=[];
  const isCall=(node:ts.Node,name:string):node is ts.CallExpression=>ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===name;
  function visit(node:ts.Node,insideLegacyFence=false){
   if(isCall(node,"runCommunityMaintenance"))calls.push({node,insideLegacyFence});
   ts.forEachChild(node,child=>visit(child,insideLegacyFence||isCall(node,"betaWork")));
  }
  visit(source);
  expect(calls).toHaveLength(1);expect(calls[0]!.insideLegacyFence).toBe(false);
  expect(calls[0]!.node.arguments).toHaveLength(4);
  let containsCommunityTick=false;
  function inspectCommunity(node:ts.Node){
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)
     &&node.expression.expression.text==="communityOperations"&&node.expression.name.text==="tick")containsCommunityTick=true;
   ts.forEachChild(node,inspectCommunity);
  }
  inspectCommunity(calls[0]!.node.arguments[3]!);expect(containsCommunityTick).toBe(true);
  expect(source.statements.some(node=>ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)
    &&node.moduleSpecifier.text==="../apps/worker/src/community-work"
    &&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)
    &&node.importClause.namedBindings.elements.some(element=>element.name.text==="runCommunityMaintenance"))).toBe(true);
 });
});
