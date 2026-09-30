import {NextRequest,NextResponse} from 'next/server';
import {openSession,authMode,validateOAuthSession} from '../../auth/session';
import {sameOrigin} from '../../auth/origin';
import {serverServices} from '../../auth/server-access';
import {isDomainError,DomainError} from '../../../../../packages/shared/src/index';
import {failureResponse} from '../../auth/failure-response';
export async function POST(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameOrigin(req))return failureResponse(new DomainError('ORIGIN_REJECTED',403),'NOT_STARTED');
 const session=openSession(req.cookies.get('nexus_session')?.value);
 if(!session||authMode()!=='oauth')return failureResponse(new DomainError('SESSION_EXPIRED',401),'NOT_STARTED');
 try{await validateOAuthSession(session);}catch(error){return failureResponse(error,'NOT_STARTED');}
 try{const text=await req.text();if(text.length>1024)return reply({error:'VERIFICATION_INVALID'},400);const body=JSON.parse(text) as {code?:unknown};return reply(await serverServices().verification.redeem(session.userId,body.code));}
 catch(error){if(error instanceof SyntaxError)return reply({error:'VERIFICATION_INVALID'},400);if(isDomainError(error)&&['VERIFICATION_INVALID','VERIFICATION_RATE_LIMIT'].includes(error.code))return reply({error:error.code},error.code==='VERIFICATION_RATE_LIMIT'?429:400);return failureResponse(error);}
}
