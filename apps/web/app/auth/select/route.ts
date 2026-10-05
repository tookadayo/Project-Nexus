import {NextRequest,NextResponse} from 'next/server';
import {dashboardContext,secureCookies} from '../session';
import {authProblem} from '../problem-response';
import {webOrigin} from '../../../../../packages/config/src/web-origin';
export async function GET(req:NextRequest){
 const guild=req.nextUrl.searchParams.get('guild');if(!guild)return new NextResponse('Guild required',{status:400});
 const base=webOrigin(req);
 try{const context=await dashboardContext(req.cookies.get('nexus_session')?.value,guild);if(!context||context.guildId!==guild)return NextResponse.redirect(new URL('/servers',base));
  const response=NextResponse.redirect(new URL(`/dashboard/${guild}`,base));response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
 }catch(error){if(error instanceof Error&&error.message==='SESSION_EXPIRED')return NextResponse.redirect(new URL('/auth/expired',base));return authProblem(error);}
}
