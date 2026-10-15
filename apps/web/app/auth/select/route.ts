import {NextRequest,NextResponse} from 'next/server';
import {setupContext,secureCookies,authMode,dashboardContext} from '../session';
import {manageableConnection,serverServices} from '../server-access';
import {scopeForGuild} from '../../../../../packages/security/src/scoping';
import {SettingsService} from '../../../../../packages/settings/src/index';
import {authProblem} from '../problem-response';
import {webOrigin} from '../../../../../packages/config/src/web-origin';
export async function GET(req:NextRequest){
 const guild=req.nextUrl.searchParams.get('guild');if(!guild)return new NextResponse('Guild required',{status:400});
 const base=webOrigin(req);
 try{if(authMode()==='development'){
   const local=await dashboardContext(req.cookies.get('nexus_session')?.value,guild);if(!local||local.guildId!==guild)return NextResponse.redirect(new URL('/servers',base));
   const response=NextResponse.redirect(new URL(`/dashboard/${guild}`,base));response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
  }
  const context=await setupContext(req.cookies.get('nexus_session')?.value,guild);if(!context||context.guildId!==guild)return NextResponse.redirect(new URL('/servers',base));
  const connection=await manageableConnection(guild,context.userId);
  const complete=connection?.state==='VERIFIED'&&(await new SettingsService(serverServices().db).get(scopeForGuild(guild))).setupVersion>=3;
  const target=connection?.state==='VERIFIED'&&!connection.operationsCanConfigure?'/operations?view=attention':complete?`/dashboard/${guild}`:`/setup?guild=${guild}`;
  const response=NextResponse.redirect(new URL(target,base));response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
 }catch(error){if(error instanceof Error&&error.message==='SESSION_EXPIRED')return NextResponse.redirect(new URL('/auth/expired',base));return authProblem(error);}
}
