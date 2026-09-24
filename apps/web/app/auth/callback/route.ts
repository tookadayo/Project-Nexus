import {NextRequest,NextResponse} from 'next/server';
import {oauthRedirectUri,sealSession,secureCookies,validOAuthState} from '../session';
export async function GET(req:NextRequest){
 const state=req.nextUrl.searchParams.get('state'),code=req.nextUrl.searchParams.get('code');
 if(!code||!validOAuthState(req.cookies.get('nexus_oauth_state')?.value,state))return new NextResponse('Sign-in state rejected',{status:403});
 const clientId=process.env.DISCORD_APPLICATION_ID,secret=process.env.DISCORD_CLIENT_SECRET;if(!clientId||!secret)return new NextResponse('Sign-in is not configured',{status:503});
 try{
  const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:oauthRedirectUri()});
  const exchanged=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!exchanged.ok)return new NextResponse('Discord sign-in failed',{status:401});
  const token=await exchanged.json() as {access_token:string;expires_in:number;scope:string};
  if(!token.access_token||!Number.isFinite(token.expires_in)||token.expires_in<=0||!token.scope.split(' ').includes('identify')||!token.scope.split(' ').includes('guilds'))return new NextResponse('Required access was not granted',{status:403});
  const identified=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!identified.ok)return new NextResponse('Discord identity unavailable',{status:401});
  const user=await identified.json() as {id:string};if(!/^\d{17,20}$/.test(user.id))return new NextResponse('Invalid Discord identity',{status:401});
  const response=NextResponse.redirect(new URL('/',process.env.NEXUS_WEB_URL));
  response.cookies.set('nexus_session',sealSession({accessToken:token.access_token,userId:user.id,expiresAt:Date.now()+Math.min(token.expires_in,604800)*1000}),{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:Math.min(token.expires_in,604800)});
  response.cookies.delete('nexus_oauth_state');return response;
 }catch{return new NextResponse('Discord sign-in unavailable',{status:503});}
}
