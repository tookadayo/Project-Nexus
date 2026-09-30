import {NextRequest,NextResponse} from 'next/server';
import {openSession} from '../session';
export async function GET(req:NextRequest){
 const session=openSession(req.cookies.get('nexus_session')?.value),response=NextResponse.redirect(new URL('/auth/login',process.env.NEXUS_WEB_URL??'http://localhost:3100'));
 for(const name of ['nexus_session','nexus_guild','nexus_oauth_state','nexus_oauth_next'])response.cookies.delete(name);
 const id=process.env.DISCORD_APPLICATION_ID,secret=process.env.DISCORD_CLIENT_SECRET;
 if(session&&id&&secret)try{await fetch('https://discord.com/api/v10/oauth2/token/revoke',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:session.accessToken}),cache:'no-store',signal:AbortSignal.timeout(2000)});}catch{/* Local cookies are cleared even when Discord is unavailable. Never log credentials. */}
 return response;
}
