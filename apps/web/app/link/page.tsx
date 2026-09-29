import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {openSession,authMode} from '../auth/session';
import {SiteHeader,siteLocale,copy} from '../public-ui';
import {LinkForm} from './form';
export const dynamic='force-dynamic';
export default async function LinkPage(){
 const locale=await siteLocale();
 if(authMode()==='development')return <div className="servers-page"><SiteHeader locale={locale}/><main className="servers-content"><h1>DEVELOPMENT AUTH MODE</h1><p>{copy(locale,'サーバー検証にはOAuthモードでDiscordログインが必要です。','Server verification requires Discord sign-in in OAuth mode.')}</p><a href="/dashboard">Development Dashboard</a></main></div>;
 if(!openSession((await cookies()).get('nexus_session')?.value))redirect('/auth/login?next=/link');
 return <div className="servers-page"><SiteHeader locale={locale}/><main className="servers-content"><h1>{copy(locale,'Web Dashboardを接続','Connect Web Dashboard')}</h1><p>{copy(locale,'接続するDiscordサーバーで /nexus link を実行し、表示されたコードを入力してください。コードは10分間有効で、発行した本人だけが使用できます。','Run /nexus link in the Discord server you want to connect, then enter its code. Codes expire after 10 minutes and can only be used by the person who issued them.')}</p><LinkForm locale={locale}/><p><a href="/servers">{copy(locale,'サーバー一覧に戻る','Back to servers')}</a></p></main></div>;
}
