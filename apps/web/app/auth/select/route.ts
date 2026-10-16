import {NextRequest,NextResponse} from 'next/server';
import {setupContext,secureCookies,authMode,dashboardContext} from '../session';
import {manageableConnection,serverServices} from '../server-access';
import {scopeForGuild} from '../../../../../packages/security/src/scoping';
import {SettingsService} from '../../../../../packages/settings/src/index';
import {authProblem} from '../problem-response';
import {webOrigin} from '../../../../../packages/config/src/web-origin';
import {sameOrigin} from '../origin';
import {csrfCookieName,csrfFormField} from '../csrf';
export async function GET(req:NextRequest){
 const guild=req.nextUrl.searchParams.get('guild');if(!guild||!/^\d{17,20}$/.test(guild))return new NextResponse('Guild required',{status:400});
 return new NextResponse(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS</title><main><h1>サーバーを開く / Open server</h1><form method="post">${csrfFormField(req.cookies.get(csrfCookieName)?.value)}<input type="hidden" name="guild" value="${guild}"><button>開く / Open</button></form><a href="/servers">戻る / Back</a></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return new NextResponse('Forbidden',{status:403});
 const guild=(await req.formData()).get('guild');if(typeof guild!=='string'||!/^\d{17,20}$/.test(guild))return new NextResponse('Guild required',{status:400});
 const base=webOrigin(req);
 try{if(authMode()==='development'){
   const local=await dashboardContext(req.cookies.get('nexus_session')?.value,guild);if(!local||local.guildId!==guild)return NextResponse.redirect(new URL('/servers',base),303);
   const response=NextResponse.redirect(new URL(`/dashboard/${guild}`,base),303);response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
  }
  const context=await setupContext(req.cookies.get('nexus_session')?.value,guild);if(!context||context.guildId!==guild)return NextResponse.redirect(new URL('/servers',base),303);
  const connection=await manageableConnection(guild,context.userId);
  const complete=connection?.state==='VERIFIED'&&(await new SettingsService(serverServices().db).get(scopeForGuild(guild))).setupVersion>=3;
  const target=connection?.state==='VERIFIED'&&!connection.operationsCanConfigure?'/operations?view=attention':complete?`/dashboard/${guild}`:`/setup?guild=${guild}`;
  const response=NextResponse.redirect(new URL(target,base),303);response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
 }catch(error){if(error instanceof Error&&error.message==='SESSION_EXPIRED')return NextResponse.redirect(new URL('/auth/expired',base),303);return authProblem(error);}
}
