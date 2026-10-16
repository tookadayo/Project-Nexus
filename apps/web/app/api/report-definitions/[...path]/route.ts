import {randomUUID} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {operationsContext} from "../../../operations/context";
import {sameOrigin} from "../../../auth/origin";
import {assertDisplayedGuild} from "../../../auth/displayed-guild";
import {billingBody} from "../../../billing/request";
import {assert,isDomainError} from "../../../../../../packages/shared/src/index";
import {Reports,reportDraftCreateInput,reportDraftEditInput,reportDraftCommitInput} from "../../../../../../packages/operations/src/reports";
export const runtime="nodejs";
type Route={params:Promise<{path:string[]}>};
function reply(requestId:string,data:unknown,status=200){return NextResponse.json({ok:true,requestId,data},{status,headers:{"Cache-Control":"no-store"}});}
function failure(requestId:string,error:unknown){
 const schema=!!error&&typeof error==="object"&&["42P01","42703"].includes(String((error as {code?:string}).code));
 const code=isDomainError(error)?error.code:error instanceof z.ZodError||error instanceof SyntaxError?"INVALID_REQUEST":schema?"SCHEMA_NOT_INSTALLED":"AUTHORIZATION_OR_SERVICE_UNAVAILABLE";
 return NextResponse.json({ok:false,requestId,error:{code,retryable:false}},{status:isDomainError(error)?error.status:code==="INVALID_REQUEST"?400:503,headers:{"Cache-Control":"no-store"}});
}
async function context(request:NextRequest){const c=await operationsContext();assertDisplayedGuild(request.headers.get("X-Nexus-Guild"),c.scope.guildId);return {...c,reports:new Reports(c.services.db,{authorization:{scope:c.scope,actorHash:c.actor.key,expiresAt:new Date(c.snapshot.checkedAt+10000)}})};}
function match(request:NextRequest,value:string|number){assert(request.headers.get("If-Match"),"PRECONDITION_REQUIRED",428);assert(request.headers.get("If-Match")===`"${value}"`,"REVISION_CONFLICT",412);}
export async function GET(request:NextRequest,route:Route){const requestId=randomUUID();try{
 const {path}=await route.params,c=await context(request);assert([...request.nextUrl.searchParams.keys()].length===0,"INVALID_REQUEST");let data:unknown;
 if(path.join("/")==="templates")data=await c.reports.definitionCatalog(c.scope,c.actor);
 else if(path.length===2&&path[0]==="templates")data=await c.reports.definitionDetail(c.scope,c.actor,z.uuid().parse(path[1]));
 else if(path.length===2&&path[0]==="drafts")data=await c.reports.definitionDraftDetail(c.scope,c.actor,z.uuid().parse(path[1]));
 else if(path.length===3&&path[0]==="drafts"&&path[2]==="preview")data=await c.reports.previewDefinitionDraft(c.scope,c.actor,z.uuid().parse(path[1]));
 else assert(false,"TARGET_NOT_FOUND",404);return reply(requestId,data);
 }catch(error){return failure(requestId,error);}}
export async function POST(request:NextRequest,route:Route){const requestId=randomUUID();try{
 assert(sameOrigin(request),"ORIGIN_REJECTED",403);const {path}=await route.params,c=await context(request),raw:unknown=JSON.parse(await billingBody(request,262144));let data:unknown,status=200;
 if(path.join("/")==="drafts"){const body=reportDraftCreateInput.parse(raw);match(request,body.liveVersion);data=await c.reports.createDefinitionDraft(c.scope,c.actor,body);status=201;}
 else if(path.length===3&&path[0]==="drafts"){const id=z.uuid().parse(path[1]);
  if(path[2]==="revisions"){const body=reportDraftEditInput.parse(raw);match(request,body.version);data=await c.reports.editDefinitionDraft(c.scope,c.actor,id,body);status=201;}
  else if(path[2]==="commit"){const body=reportDraftCommitInput.parse(raw);match(request,body.version);data=await c.reports.commitDefinitionDraft(c.scope,c.actor,id,body);}
  else if(path[2]==="cancel"){const body=z.object({version:z.number().int().positive()}).strict().parse(raw);match(request,body.version);data=await c.reports.discardDefinitionDraft(c.scope,c.actor,id,body.version);}
  else assert(false,"TARGET_NOT_FOUND",404);
 }else assert(false,"TARGET_NOT_FOUND",404);return reply(requestId,data,status);
 }catch(error){return failure(requestId,error);}}
