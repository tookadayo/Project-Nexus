import {NextRequest,NextResponse} from 'next/server';
import {openSession,authMode} from '../../auth/session';
import {sameOrigin} from '../../auth/origin';
import {serverServices} from '../../auth/server-access';
import {scopeForGuild} from '../../../../../packages/security/src/scoping';
export async function POST(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameOrigin(req))return reply({error:'ORIGIN_REJECTED'},403);
 const session=openSession(req.cookies.get('nexus_session')?.value);
 if(!session||authMode()!=='oauth')return reply({error:'SESSION_EXPIRED'},401);
 try{
  const text=await req.text();if(text.length>1024)return reply({error:'CONNECTION_REJECTED'},400);
  const body=JSON.parse(text) as {guildId?:string;confirmation?:string};if(!body.guildId||!/^\d{17,20}$/.test(body.guildId))return reply({error:'CONNECTION_REJECTED'},400);
  const s=scopeForGuild(body.guildId),services=serverServices(),actor=await services.authority.actor(s,session.userId,'WEB_DASHBOARD','disconnect');
  if(!body.confirmation){const connection=await services.verification.connection(s);if(connection.state!=='VERIFIED')return reply({error:'CONNECTION_REJECTED'},403);return reply({confirmation:await services.tokens.issue(services.db,s,{action:'webDisconnect',version:connection.version},actor.key,120)});}
  const intent=await services.tokens.read(services.db,s,body.confirmation,actor.key);if(intent.action!=='webDisconnect'||typeof intent.version!=='string')return reply({error:'CONNECTION_REJECTED'},400);
  await services.verification.disconnect(s,session.userId,intent.version);return reply({disconnected:true});
 }catch{return reply({error:'CONNECTION_REJECTED'},403);}
}
