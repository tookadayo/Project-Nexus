import {NextRequest,NextResponse} from 'next/server';
import {publicSessions} from '../public-session-store';
import {webOrigin} from '../../../../../packages/config/src/web-origin';
import {sameOrigin} from '../origin';
export async function GET(){return new NextResponse('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS</title><main><h1>ログアウト / Sign out</h1><form method="post"><button>ログアウト / Sign out</button></form><p>このセッションを終了します。他の管理者やサーバーのデータは削除しません。 / Ends this session. Other administrators and server data are kept.</p><a href="/servers">戻る / Back</a></main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});}
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return NextResponse.json({error:'FORBIDDEN'},{status:403});
 await publicSessions().revoke(req.cookies.get('nexus_session')?.value);
 const response=NextResponse.redirect(new URL('/auth/login',webOrigin(req)),303);
 for(const name of ['nexus_session','nexus_guild','nexus_oauth_state','nexus_oauth_next','nexus_checkout_login','nexus_checkout_receipt'])response.cookies.delete(name);
 return response;
}
