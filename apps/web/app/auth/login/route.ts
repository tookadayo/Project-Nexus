import {randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {authMode,oauthRedirectUri,secureCookies} from '../session';
import {authProblem} from '../problem-response';
import {DomainError} from '../../../../../packages/shared/src/index';
import {webOrigin} from '../../../../../packages/config/src/web-origin';
import {checkoutLoginIntent} from '../checkout-intent';
import {publicBillingCatalog} from '../../billing/catalog';
export async function GET(req:NextRequest){
 if(authMode()==='development')return NextResponse.redirect(new URL('/dashboard',webOrigin(req)));
 if(!process.env.DISCORD_APPLICATION_ID||!process.env.DISCORD_CLIENT_SECRET||(process.env.NEXUS_SESSION_SECRET?.length??0)<32||!process.env.NEXUS_WEB_URL)return authProblem(new DomainError('WEB_CONNECTION_UNAVAILABLE',503));
 const state=randomBytes(24).toString('base64url'),url=new URL('https://discord.com/oauth2/authorize');
 url.searchParams.set('response_type','code');url.searchParams.set('client_id',process.env.DISCORD_APPLICATION_ID);url.searchParams.set('redirect_uri',oauthRedirectUri());url.searchParams.set('scope','identify guilds');url.searchParams.set('state',state);
 const next=req.nextUrl.searchParams.get('next');
 const response=NextResponse.redirect(url);response.cookies.set('nexus_oauth_state',state,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:600});
 const offeringId=req.nextUrl.searchParams.get('offering');
 if(offeringId){
  try{const catalog=await publicBillingCatalog();if(!catalog.offerings.some(row=>row.id===offeringId))return authProblem(new DomainError('BILLING_OFFERING_UNAVAILABLE',409));response.cookies.set('nexus_checkout_login',checkoutLoginIntent(offeringId,state),{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:600});}catch{return authProblem(new DomainError('BILLING_OFFERING_UNAVAILABLE',409));}
 }else response.cookies.delete('nexus_checkout_login');
 if(next&&(next==='/link'||next==='/billing/manage'||next==='/billing/payments'||/^\/dashboard\/\d{17,20}$/.test(next)))response.cookies.set('nexus_oauth_next',next,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:600});
 else response.cookies.delete('nexus_oauth_next');
 return response;
}
