import {NextRequest,NextResponse} from 'next/server';
import {openSession,authMode} from '../../auth/session';
import {sameOrigin} from '../../auth/origin';
import {serverServices} from '../../auth/server-access';
import {DomainError} from '../../../../../packages/shared/src/index';
export async function POST(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameOrigin(req))return reply({error:'ORIGIN_REJECTED'},403);
 const session=openSession(req.cookies.get('nexus_session')?.value);
 if(!session||authMode()!=='oauth')return reply({error:'SESSION_EXPIRED'},401);
 try{const text=await req.text();if(text.length>1024)return reply({error:'VERIFICATION_INVALID'},400);const body=JSON.parse(text) as {code?:unknown};return reply(await serverServices().verification.redeem(session.userId,body.code));}
 catch(error){const limited=error instanceof DomainError&&error.code==='VERIFICATION_RATE_LIMIT';return reply({error:limited?'VERIFICATION_RATE_LIMIT':'VERIFICATION_INVALID'},limited?429:400);}
}
