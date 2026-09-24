import {NextRequest,NextResponse} from 'next/server';
import {dashboardContext,secureCookies} from '../session';
export async function GET(req:NextRequest){
 const guild=req.nextUrl.searchParams.get('guild');if(!guild)return new NextResponse('Guild required',{status:400});
 try{const context=await dashboardContext(req.cookies.get('nexus_session')?.value,guild);if(!context||context.guildId!==guild)return new NextResponse('Guild access denied',{status:403});
  const response=NextResponse.redirect(new URL('/',req.url));response.cookies.set('nexus_guild',guild,{httpOnly:true,secure:secureCookies(),sameSite:'lax',path:'/',maxAge:604800});return response;
 }catch{return new NextResponse('Guild access unavailable',{status:503});}
}
