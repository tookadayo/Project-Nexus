import {NextRequest,NextResponse} from 'next/server';
import {oauthRedirectUri,sealSession,secureCookies,validOAuthState} from '../session';
import {authProblem} from '../problem-response';
import {DomainError} from '../../../../../packages/shared/src/index';
export async function GET(req:NextRequest){
 const state=req.nextUrl.searchParams.get('state'),code=req.nextUrl.searchParams.get('code');
 if(!code||!validOAuthState(req.cookies.get('nexus_oauth_state')?.value,state))return authProblem(new DomainError('SESSION_EXPIRED',403));
 const clientId=process.env.DISCORD_APPLICATION_ID,secret=process.env.DISCORD_CLIENT_SECRET;if(!clientId||!secret)return authProblem(new DomainError('WEB_CONNECTION_UNAVAILABLE',503));
 try{
  const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:oauthRedirectUri()});
  const exchanged=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!exchanged.ok)return authProblem(new DomainError('SESSION_EXPIRED',401));
  const token=await exchanged.json() as {access_token:string;expires_in:number;scope:string};
  if(!token.access_token||!Number.isFinite(token.expires_in)||token.expires_in<=0||typeof token.scope!=='string'||!token.scope.split(' ').includes('identify')||!token.scope.split(' ').includes('guilds'))return authProblem(new DomainError('SESSION_EXPIRED',403));
  const identified=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!identified.ok)return authProblem(new DomainError('SESSION_EXPIRED',401));
  const user=await identified.json() as {id:string};if(!/^\d{17,20}$/.test(user.id))return authProblem(new DomainError('SESSION_EXPIRED',401));
  const next=req.cookies.get('nexus_oauth_next')?.value;
  const response=NextResponse.redirect(new URL(next&&(next==='/link'||/^\/dashboard\/\d{17,20}$/.test(next))?next:'/servers',process.env.NEXUS_WEB_URL));
  response.cookies.set('nexus_session',sealSession({accessToken:token.access_token,userId:user.id,expiresAt:Date.now()+Math.min(token.expires_in,604800)*1000}),{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:Math.min(token.expires_in,604800)});
  response.cookies.delete('nexus_oauth_state');response.cookies.delete('nexus_oauth_next');return response;
 }catch{return authProblem(new DomainError('DISCORD_UNAVAILABLE',503));}
}
