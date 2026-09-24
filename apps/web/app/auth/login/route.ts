import {randomBytes} from 'node:crypto';
import {NextResponse} from 'next/server';
import {authMode,oauthRedirectUri,secureCookies} from '../session';
export async function GET(){
 if(authMode()==='development')return NextResponse.redirect(new URL('/',process.env.NEXUS_WEB_URL??'http://localhost:3100'));
 if(!process.env.DISCORD_APPLICATION_ID||!process.env.DISCORD_CLIENT_SECRET||(process.env.NEXUS_SESSION_SECRET?.length??0)<32||!process.env.NEXUS_WEB_URL)return new NextResponse('Discord sign-in is not configured',{status:503});
 const state=randomBytes(24).toString('base64url'),url=new URL('https://discord.com/oauth2/authorize');
 url.searchParams.set('response_type','code');url.searchParams.set('client_id',process.env.DISCORD_APPLICATION_ID);url.searchParams.set('redirect_uri',oauthRedirectUri());url.searchParams.set('scope','identify guilds');url.searchParams.set('state',state);
 const response=NextResponse.redirect(url);response.cookies.set('nexus_oauth_state',state,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:600});return response;
}
