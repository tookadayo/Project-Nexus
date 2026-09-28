import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authorizedGuilds,openSession,authMode,installUrl} from '../auth/session';

export const dynamic='force-dynamic';
export default async function Servers(){
 if(authMode()==='development')redirect('/');
 const session=openSession((await cookies()).get('nexus_session')?.value);if(!session)redirect('/auth/expired');
 let guilds;try{guilds=await authorizedGuilds(session.accessToken);}catch(error){if(error instanceof Error&&error.message==='SESSION_EXPIRED')redirect('/auth/expired');return <main className="legal-page"><h1>Servers unavailable / サーバー一覧を取得できません</h1><p>Please try again shortly. / 少し待ってから再試行してください。</p><a href="/servers">Retry / 再試行</a></main>;}
 const installed=guilds.filter(g=>g.installed),available=guilds.filter(g=>!g.installed);
 return <main className="legal-page"><h1>NEXUS servers / サーバー</h1><h2>NEXUSを使用中 / Using NEXUS</h2>{installed.length?installed.map(g=><p key={g.id}><a href={`/auth/select?guild=${encodeURIComponent(g.id)}`}>{g.name}</a></p>):<p>導入済みサーバーはありません。 / No installed servers yet.</p>}<h2>未導入 / Not installed</h2>{available.map(g=><p key={g.id}>{g.name} {g.installUrl&&<a href={g.installUrl}>NEXUSを追加 / Add NEXUS</a>}</p>)}{!guilds.length&&<p>管理可能なサーバーがありません。 / No manageable servers found.</p>}<p>{installUrl()&&<a href={installUrl()!}>Install URL / インストール URL</a>}</p><a href="/auth/logout">別のアカウントでログイン / Sign in with another account</a></main>;
}
