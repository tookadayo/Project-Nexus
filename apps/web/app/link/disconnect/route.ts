import {NextRequest,NextResponse} from 'next/server';
import {openSession,authMode,validateOAuthSession} from '../../auth/session';
import {DomainError} from '../../../../../packages/shared/src/index';
import {sameOrigin} from '../../auth/origin';
import {serverServices} from '../../auth/server-access';
import {scopeForGuild} from '../../../../../packages/security/src/scoping';
import {failureResponse} from '../../auth/failure-response';
export async function POST(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameOrigin(req))return failureResponse(new DomainError('ORIGIN_REJECTED',403),'NOT_STARTED');
 const session=openSession(req.cookies.get('nexus_session')?.value);
 if(!session||authMode()!=='oauth')return failureResponse(new DomainError('SESSION_EXPIRED',401),'NOT_STARTED');
 try{await validateOAuthSession(session);}catch(error){return failureResponse(error,'NOT_STARTED');}
 try{
  const text=await req.text();if(text.length>1024)return reply({error:'CONNECTION_REJECTED'},400);
  const body=JSON.parse(text) as {guildId?:string;confirmation?:string};if(!body.guildId||!/^\d{17,20}$/.test(body.guildId))return reply({error:'CONNECTION_REJECTED'},400);
  const s=scopeForGuild(body.guildId),services=serverServices(),authorization=await services.authority.snapshot(s,session.userId,'WEB_DASHBOARD','disconnect'),actor=services.authority.require(authorization);
  if(!body.confirmation){const connection=await services.verification.connection(s);if(connection.state!=='VERIFIED')return reply({error:'CONNECTION_REJECTED'},403);return reply({confirmation:await services.tokens.issue(services.db,s,{action:'webDisconnect',version:connection.version},actor.key,120)});}
  const intent=await services.tokens.read(services.db,s,body.confirmation,actor.key);if(intent.action!=='webDisconnect'||typeof intent.version!=='string')return reply({error:'CONNECTION_REJECTED'},400);
  await services.verification.disconnect(s,session.userId,intent.version,'WEB_DASHBOARD',authorization);return reply({disconnected:true});
 }catch(error){return failureResponse(error);}
}
