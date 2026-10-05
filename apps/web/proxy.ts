import {NextResponse,type NextRequest} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {webAuthMode} from '../../packages/config/src/web-auth';
import {webOrigin} from '../../packages/config/src/web-origin';
export function proxy(req:NextRequest){
 const mode=webAuthMode();
 if(req.nextUrl.pathname.startsWith('/auth/')||['/','/product','/pricing','/support','/privacy','/terms','/locale','/billing/webhooks/stripe'].includes(req.nextUrl.pathname))return NextResponse.next();
 if(mode!=='development'){
  if(req.nextUrl.pathname.startsWith('/link/')&&req.method!=='GET')return NextResponse.next();
  if(!req.cookies.get('nexus_session')?.value){const login=new URL('/auth/login',webOrigin(req));if(req.nextUrl.pathname==='/link'||/^\/dashboard\/\d{17,20}$/.test(req.nextUrl.pathname))login.searchParams.set('next',req.nextUrl.pathname);return NextResponse.redirect(login);}
  return NextResponse.next();
 }
 const secret=process.env.NEXUS_WEB_PASSWORD;const header=req.headers.get('authorization')??'';
 const expected=Buffer.from(`Basic ${Buffer.from(`nexus:${secret??''}`).toString('base64')}`);const actual=Buffer.from(header);
 if(!secret||secret.length<16||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new NextResponse('Authentication required',{status:401,headers:{'WWW-Authenticate':'Basic realm="NEXUS"','Cache-Control':'no-store'}});
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|nexus/).*)']};
