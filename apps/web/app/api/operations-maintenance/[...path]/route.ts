import { randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { operationsContext } from "../../../operations/context";
import { sameOrigin } from "../../../auth/origin";
import { assertDisplayedGuild } from "../../../auth/displayed-guild";
import { billingBody } from "../../../billing/request";
import { assert,isDomainError } from "../../../../../../packages/shared/src/index";
import { actorPermissions } from "../../../../../../packages/operations/src/policy";
import { EventOperations } from "../../../../../../packages/operations/src/events";
import { OperationsIntake } from "../../../../../../packages/operations/src/intake";
import { InterventionReview } from "../../../../../../packages/operations/src/intervention-review";
import { AttentionInbox } from "../../../../../../packages/operations/src/inbox";
import { Reports } from "../../../../../../packages/operations/src/reports";
import { OperationsOrganization } from "../../../../../../packages/operations/src/organization";
import { Destinations } from "../../../../../../packages/operations/src/destinations";
import { ApiCredentials } from "../../../../../../packages/operations/src/credentials";
import { Webhooks } from "../../../../../../packages/operations/src/webhooks";
export const runtime="nodejs";
type Route={params:Promise<{path:string[]}>};
const precondition=z.object({id:z.uuid(),revision:z.number().int().positive()}).strict();
function response(requestId:string,data:unknown,status=200){return NextResponse.json({ok:true,requestId,data},{status,headers:{"Cache-Control":"no-store"}});}
function failure(requestId:string,error:unknown){
 const missing=!!error&&typeof error==='object'&&(error as {code?:string}).code==='42P01';
 const code=isDomainError(error)?error.code:error instanceof z.ZodError||error instanceof SyntaxError?'INVALID_REQUEST':missing?'SCHEMA_NOT_INSTALLED':'AUTHORIZATION_OR_SERVICE_UNAVAILABLE';
 return NextResponse.json({ok:false,requestId,error:{code,retryable:false}},{status:isDomainError(error)?error.status:code==='INVALID_REQUEST'?400:503,headers:{"Cache-Control":"no-store"}});
}
async function context(request:NextRequest){
 const c=await operationsContext();assertDisplayedGuild(request.headers.get('X-Nexus-Guild'),c.scope.guildId);
 const {db,vault,discord,tokens,authority}=c.services;
 const proof={scope:c.scope,actorHash:c.actor.key,expiresAt:new Date(c.snapshot.checkedAt+10000)};
 return {...c,d:{events:new EventOperations(db,proof),intake:new OperationsIntake(db,vault,discord,tokens,proof),
  interventions:new InterventionReview(db,proof),attention:new AttentionInbox(db,proof),reports:new Reports(db,{authorization:proof}),
  organization:new OperationsOrganization(db,vault,discord,authority,{authorization:proof}),
  destinations:new Destinations(db,discord,proof),credentials:new ApiCredentials(db,vault,proof),webhooks:new Webhooks(db,vault,proof)}};
}
export async function GET(request:NextRequest,route:Route){
 const requestId=randomUUID();try{
  const c=await context(request),{path}=await route.params,{scope:s,actor:a,d}=c;
  assert([...request.nextUrl.searchParams.keys()].length===0,'INVALID_REQUEST');let data:unknown;
  if(path.length===1){
   const key=path[0];
   if(key==='events')data=await d.events.list(s,a);
   else if(key==='intake')data=await d.intake.list(s,a);
   else if(key==='reports')data=await d.reports.list(s,a);
   else if(key==='teams'||key==='organization')data=await d.organization.detail(s,a);
   else if(key==='interventions')data=await d.interventions.list(s,a);
   else if(key==='destinations')data=await d.destinations.list(s,a);
   else if(key==='credentials')data=await d.credentials.list(s,a);
   else if(key==='webhooks')data=await d.webhooks.list(s,a);
   else assert(false,'TARGET_NOT_FOUND',404);
  }else if(path.length===3&&path[0]==='reports'&&path[1]==='result')data=await d.reports.resultDetail(s,a,z.uuid().parse(path[2]));
  else if(path.length===3&&path[0]==='interventions'&&path[1]==='detail')data=await d.interventions.detail(s,a,z.uuid().parse(path[2]));
  else assert(false,'TARGET_NOT_FOUND',404);
  return response(requestId,{value:data,permissions:await actorPermissions(c.services.db,s,a)});
 }catch(error){return failure(requestId,error);}
}
export async function POST(request:NextRequest,route:Route){
 const requestId=randomUUID();try{
  assert(sameOrigin(request),'ORIGIN_REJECTED',403);
  const c=await context(request),{path}=await route.params,{scope:s,actor:a,d}=c;
  const body:unknown=JSON.parse(await billingBody(request,24000));let data:unknown;
  const versionBody=z.object({revision:z.number().int().nonnegative().optional(),version:z.number().int().nonnegative().optional(),templateRevision:z.number().int().positive().optional()}).passthrough().parse(body);
  const version=versionBody.revision??versionBody.version??versionBody.templateRevision;
  assert(version!==undefined,'PRECONDITION_REQUIRED',428);
  assert(request.headers.get('If-Match'),'PRECONDITION_REQUIRED',428);
  assert(request.headers.get('If-Match')===`"${version}"`,'REVISION_CONFLICT',412);
  assert(path.length===2,'TARGET_NOT_FOUND',404);
  const action=path.join('/');
  // Domain methods own strict input validation and scope/version/plan checks.
  if(action==='events/delete')data=await d.events.remove(s,a,body);
  else if(action==='events/enabled')data=await d.events.setEnabled(s,a,body);
  else if(action==='intake/delete-request')data=await d.intake.removeRequest(s,a,body);
  else if(action==='intake/delete-panel')data=await d.intake.removePanel(s,a,body);
  else if(action==='intake/state')data=await d.attention.action(s,a,body);
  else if(action==='reports/generate')data=await d.reports.requestGeneration(s,a,body);
  else if(action==='reports/delete-result')data=await d.reports.deleteResult(s,a,body);
  else if(action==='reports/delete-template')data=await d.reports.removeTemplate(s,a,body);
  else if(action==='reports/delete-schedule')data=await d.reports.removeSchedule(s,a,body);
  else if(action==='teams/update')data=await d.organization.updateTeam(s,a,body);
  else if(action==='teams/delete')data=await d.organization.deleteTeam(s,a,body);
  else if(action==='organization/rename')data=await d.organization.renameOrganization(s,a,body);
  else if(action==='organization/close')data=await d.organization.closeOrganization(s,a,body);
  else if(action==='organization/unlink')data=await d.organization.unlinkGuild(s,a,c.userId,body);
  else if(action==='organization/relink')data=await d.organization.relinkGuild(s,a,c.userId,body);
  else if(action==='interventions/update')data=await d.interventions.update(s,a,body);
  else if(action==='interventions/end')data=await d.interventions.end(s,a,body);
  else if(action==='destinations/update'){
   const b=z.object({id:z.uuid(),revision:z.number().int().positive(),input:z.unknown()}).strict().parse(body);data=await d.destinations.update(s,a,b.id,b.revision,b.input);
  }else if(action==='destinations/delete'){const b=precondition.parse(body);data=await d.destinations.delete(s,a,b.id,b.revision);}
  else if(action==='credentials/update'){
   const b=z.object({id:z.uuid(),revision:z.number().int().positive(),input:z.unknown()}).strict().parse(body);data=await d.credentials.update(s,a,b.id,b.revision,b.input);
  }else if(action==='credentials/rotate'){const b=precondition.parse(body);data=await d.credentials.rotate(s,a,b.id,b.revision);}
  else if(action==='webhooks/update'){
   const b=z.object({id:z.uuid(),revision:z.number().int().positive(),input:z.unknown()}).strict().parse(body);data=await d.webhooks.update(s,a,b.id,b.revision,b.input);
  }else if(action==='webhooks/delete'){const b=precondition.parse(body);data=await d.webhooks.delete(s,a,b.id,b.revision);}
  else assert(false,'TARGET_NOT_FOUND',404);
  return response(requestId,data);
 }catch(error){return failure(requestId,error);}
}
