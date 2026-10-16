import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { operationsContext } from "../../../operations/context";
import { sameOrigin } from "../../../auth/origin";
import { assertDisplayedGuild } from "../../../auth/displayed-guild";
import { billingBody } from "../../../billing/request";
import { assert, isDomainError } from "../../../../../../packages/shared/src/index";
import { RulePlatform } from "../../../../../../packages/rules/src/service";
import { createTargetDraftAdapters } from "../../../../../../packages/rules/src/typed-drafts";
import { createOperationalCaseRuntime } from "../../../../../../packages/rules/src/operational-context";
import { catalogView } from "../../../../../../packages/rules/src/catalog";
import { expectedVersion, suggestionStates, targetTypes } from "../../../../../../packages/rules/src/domain";
import type { RuleEngineConfig } from "../../../../../../packages/rules/src/rule-config";
import {nativeSourceRequest} from "../../../../../../packages/rules/src/native-source-request";
import {evaluationRequestStatusInput} from "../../../../../../packages/rules/src/communication";
export const runtime="nodejs";
type Route={params:Promise<{path:string[]}>};
function reply(requestId:string,data:unknown,status=200){return NextResponse.json({ok:true,requestId,data,meta:{apiVersion:"1",serverTime:new Date().toISOString()}},{status,headers:{"Cache-Control":"no-store"}});}
function failure(requestId:string,error:unknown){
 const missingSchema=!!error&&typeof error==="object"&&(error as {code?:string}).code==="42P01";
 const code=isDomainError(error)?error.code:error instanceof z.ZodError||error instanceof SyntaxError?"INVALID_REQUEST":missingSchema?"SCHEMA_NOT_INSTALLED":"AUTHZ_OR_SERVICE_UNAVAILABLE";
 const status=isDomainError(error)?error.status:code==="INVALID_REQUEST"?400:503;
 return NextResponse.json({ok:false,requestId,error:{code,retryable:false},meta:{apiVersion:"1",serverTime:new Date().toISOString()}},{status,headers:{"Cache-Control":"no-store"}});
}
async function context(request:NextRequest,includeCaseRuntime=false){
 const c=await operationsContext();assertDisplayedGuild(request.headers.get("X-Nexus-Guild")??request.nextUrl.searchParams.get("guild"),c.scope.guildId);
 // No operational policy is configured by this release. Approval and alpha17
 // deployment are independent of the presence of the compiled implementation.
 const proof={scope:c.scope,actorHash:c.actor.key,expiresAt:new Date(c.snapshot.checkedAt+10000)};
 // Proposal READ remains independent of operational CASE configuration. Only
 // a new evaluation captures and validates that additional source registry.
 const caseRuntime=includeCaseRuntime?await createOperationalCaseRuntime(c.services.db,c.scope,c.actor,proof):undefined;
 return {...c,platform:new RulePlatform(c.services.db,undefined,process.env.COMPONENT_KEY,createTargetDraftAdapters(c.services.db,proof),proof,caseRuntime)};
}
export async function GET(request:NextRequest,route:Route){
 const requestId=randomUUID();try{
  const {path}=await route.params,c=await context(request),p=c.platform,s=c.scope,a=c.actor;
  let data:unknown;
  if(path.join("/")==="catalog")data={...catalogView(),readiness:await p.readiness(s,a)};
  else if(path.join("/")==="config"||path.join("/")==="config/history")data=await p.config(s,a,path.length===2);
  else if(path.join("/")==="source-config/options")data=await p.nativeSourceOptions(s,a);
  else if(path[0]==="source-config"&&path.length<=2)data=await p.nativeSourceConfigs(s,a,path[1]);
  else if(path[0]==="suggestions"&&path.length===1){const q=request.nextUrl.searchParams;data=await p.list(s,a,{state:q.has("state")?z.enum(suggestionStates).parse(q.get("state")):undefined,targetType:q.has("targetType")?z.enum(targetTypes).parse(q.get("targetType")):undefined,limit:z.coerce.number().int().min(1).max(100).parse(q.get("limit")??20),cursor:q.get("cursor")??undefined});}
  else if(path[0]==="suggestions"&&path.length===2)data=await p.detail(s,a,path[1]!);
  else if(path[0]==="suggestions"&&path.length===3&&path[2]==="history")data=await p.history(s,a,path[1]!);
  else if(path[0]==="rule-evaluations"&&path.length===2)data=await p.job(s,a,path[1]!);
  else if(path[0]==="fact-snapshots"&&path.length===2)data=await p.snapshot(s,a,path[1]!);
  else if(path[0]==="operations"&&path.length===2)data=await p.operation(s,a,path[1]!);
  else assert(false,"TARGET_NOT_FOUND",404);
  return reply(requestId,data);
 }catch(error){return failure(requestId,error);}
}
export async function POST(request:NextRequest,route:Route){
 const requestId=randomUUID();try{
  assert(sameOrigin(request),"ORIGIN_REJECTED",403);
  const {path}=await route.params,c=await context(request,["evaluation-request-key","rule-evaluations"].includes(path.join("/"))),p=c.platform,s=c.scope,a=c.actor;
  const key=["evaluation-request-key","evaluation-request-status","mutation-request-key","source-health/observations"].includes(path.join("/"))?"":z.string().regex(/^[\x21-\x7e]{1,128}$/).parse(request.headers.get("Idempotency-Key"));
  const input:unknown=JSON.parse(await billingBody(request,180000));let data:unknown;let status=200;
  if(path.join("/")==="evaluation-request-key")data=await p.evaluationRequestKey(s,a,input);
  else if(path.join("/")==="evaluation-request-status"){assert([...request.nextUrl.searchParams.keys()].length===0,"INVALID_REQUEST");data=await p.evaluationRequestStatus(s,a,evaluationRequestStatusInput.parse(input));}
  else if(path.join("/")==="source-health/observations"){const body=z.object({requests:z.array(nativeSourceRequest).min(1).max(20)}).strict().parse(input);data=await p.observeNativeSourceHealth(s,a,body.requests);}
  else if(path.join("/")==="mutation-request-key")data=await p.prepareMutationRequest(s,a,input);
  else if(path.join("/")==="rule-evaluations"){const result=await p.enqueue(s,a,key,input);data={evaluationJobId:result.job.id,status:result.job.state,evaluationAsOf:result.job.evaluation_as_of.toISOString(),inputHash:result.job.input_hash,deduplicated:result.deduplicated};status=202;}
  else if(path[0]==="rule-evaluations"&&path.length===3&&path[2]==="cancel"){z.object({}).strict().parse(input);data=await p.job(s,a,path[1]!,true,key);status=202;}
  else if(path.join("/")==="config/revisions"){
   const body=z.object({baseConfigVersion:z.number().int().nonnegative(),definition:z.unknown()}).strict().parse(input);
   const match=request.headers.get("If-Match");assert(match,"PRECONDITION_REQUIRED",428);assert(match===`"${body.baseConfigVersion}"`,"VERSION_MISMATCH",412);
   data=await p.reviseConfig(s,a,body.baseConfigVersion,body.definition as RuleEngineConfig,key);status=201;
  }else if(path.join("/")==="config/activate"){
   const body=z.object({baseConfigVersion:z.number().int().nonnegative(),draftConfigVersion:z.number().int().positive(),draftContentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input);
   const match=request.headers.get("If-Match");assert(match,"PRECONDITION_REQUIRED",428);assert(match===`"${body.baseConfigVersion}"`,"VERSION_MISMATCH",412);
   data=await p.activateConfig(s,a,body,key);
  }else if(path.join("/")==="config/retire"){
   const body=z.object({baseConfigVersion:z.number().int().nonnegative(),activeConfigVersion:z.number().int().positive(),activeContentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input);
   const match=request.headers.get("If-Match");assert(match,"PRECONDITION_REQUIRED",428);assert(match===`"${body.baseConfigVersion}"`,"VERSION_MISMATCH",412);
   data=await p.retireConfig(s,a,body,key);
  }else if(path.join("/")==="source-config/revisions"){
   const body=z.object({sourceId:z.uuid(),revisionId:z.uuid(),baseVersion:z.number().int().nonnegative(),enabled:z.boolean(),definition:z.unknown()}).strict().parse(input);
   const match=request.headers.get("If-Match");assert(match,"PRECONDITION_REQUIRED",428);assert(match===`"${body.baseVersion}"`,"VERSION_MISMATCH",412);assert(key===body.revisionId,"IDEMPOTENCY_KEY_MISMATCH",400);
   data=await p.reviseNativeSourceConfig(s,a,body);status=201;
  }else if(path[0]==="source-config"&&path.length===3&&path[2]==="disable"){
   const body=z.object({revisionId:z.uuid(),baseVersion:z.number().int().positive()}).strict().parse(input);
   const match=request.headers.get("If-Match");assert(match,"PRECONDITION_REQUIRED",428);assert(match===`"${body.baseVersion}"`,"VERSION_MISMATCH",412);assert(key===body.revisionId,"IDEMPOTENCY_KEY_MISMATCH",400);
   data=await p.disableNativeSourceConfig(s,a,path[1]!,body);
  }else if(path[0]==="suggestions"&&path.length===3){const id=path[1]!,op=path[2];
   if(op==="view"||op==="dismiss"||op==="save"){z.object({}).strict().parse(input);data=await p.userState(s,a,id,op,key);}
   else if(op==="reject"){const body=z.object({reasonCode:z.enum(["INCORRECT","NOT_APPLICABLE","OUTDATED","DUPLICATE","UNSAFE","OTHER"])}).strict().parse(input);data=await p.reject(s,a,id,expectedVersion(request.headers.get("If-Match")),body.reasonCode,key);}
   else if(op==="draft"){const body=z.object({liveVersion:z.string().min(1).max(128),changes:z.unknown()}).strict().parse(input);data=await p.createDraft(s,a,id,expectedVersion(request.headers.get("If-Match")),body,key);status=201;}
   else if(op==="apply"){data=await p.apply(s,a,id,expectedVersion(request.headers.get("If-Match")),input);}
   else assert(false,"TARGET_NOT_FOUND",404);
  }else assert(false,"TARGET_NOT_FOUND",404);
  return reply(requestId,data,status);
 }catch(error){return failure(requestId,error);}
}
