import {NextRequest,NextResponse} from 'next/server';
import {dashboardContext,secureCookies} from '../session';
export async function GET(req:NextRequest){
 const guild=req.nextUrl.searchParams.get('guild');if(!guild)return new NextResponse('Guild required',{status:400});
 try{const context=await dashboardContext(req.cookies.get('nexus_session')?.value,guild);if(!context||context.guildId!==guild)return NextResponse.redirect(new URL('/servers',req.url));
  const response=NextResponse.redirect(new URL('/',req.url));response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
 }catch(error){if(error instanceof Error&&error.message==='SESSION_EXPIRED')return NextResponse.redirect(new URL('/auth/expired',req.url));return new NextResponse('Guild access unavailable',{status:503});}
}
