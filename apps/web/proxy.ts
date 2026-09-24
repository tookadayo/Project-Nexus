import {NextResponse,type NextRequest} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
export function proxy(req:NextRequest){
 if(req.nextUrl.pathname.startsWith('/auth/'))return NextResponse.next();
 if(process.env.NEXUS_WEB_AUTH_MODE!=='development'){
  if(!req.cookies.get('nexus_session')?.value)return NextResponse.redirect(new URL('/auth/login',req.url));
  return NextResponse.next();
 }
 const secret=process.env.NEXUS_WEB_PASSWORD;const header=req.headers.get('authorization')??'';
 const expected=Buffer.from(`Basic ${Buffer.from(`nexus:${secret??''}`).toString('base64')}`);const actual=Buffer.from(header);
 if(!secret||secret.length<16||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new NextResponse('Authentication required',{status:401,headers:{'WWW-Authenticate':'Basic realm="NEXUS"','Cache-Control':'no-store'}});
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
