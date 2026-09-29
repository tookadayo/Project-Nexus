import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authorizedGuilds,openSession,authMode} from '../auth/session';
import {SiteHeader,copy,siteLocale} from '../public-ui';
import {ServerCards} from './cards';

export const dynamic='force-dynamic';
export default async function Servers(){
 if(authMode()==='development')redirect('/dashboard');
 const locale=await siteLocale(),session=openSession((await cookies()).get('nexus_session')?.value);if(!session)redirect('/auth/login');
 let guilds;try{guilds=await authorizedGuilds(session.accessToken);}catch(error){if(error instanceof Error&&error.message==='SESSION_EXPIRED')redirect('/auth/expired');return <div className="servers-page"><SiteHeader locale={locale}/><main className="servers-content"><h1>{copy(locale,'サーバー一覧を取得できません','Servers are unavailable')}</h1><p>{copy(locale,'少し待ってから再試行してください。','Please try again shortly.')}</p><a className="button button-primary" href="/servers">{copy(locale,'再試行','Retry')}</a></main></div>;}
 return <div className="servers-page"><SiteHeader locale={locale}/><main className="servers-content"><p className="site-eyebrow">YOUR DISCORD SERVERS</p><h1>{copy(locale,'管理するサーバーを選ぶ','Choose a server to manage')}</h1><p>{copy(locale,'DiscordログインとBotの導入は別の操作です。導入済みのサーバーは管理画面を開けます。','Signing in and installing the bot are separate steps. Open a dashboard for an installed server.')}</p><ServerCards locale={locale} guilds={guilds}/><p><a href="/auth/logout">{copy(locale,'別のアカウントでログイン','Sign in with another account')}</a></p></main></div>;
}
