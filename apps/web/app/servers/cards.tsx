import type {AuthorizedGuild} from '../auth/session';
import type {SiteLocale} from '../public-ui';

export function ServerCards({locale,guilds}:{locale:SiteLocale;guilds:AuthorizedGuild[]}){
 const copy=(ja:string,en:string)=>locale==='ja'?ja:en;
 return <div className="server-list">{guilds.map(g=><article className="server-card" key={g.id}><div className="server-icon" aria-hidden="true">{g.name.trim().slice(0,1).toUpperCase()}</div><div><h2>{g.name}</h2><p>{g.installed?copy('● NEXUS導入済み','● NEXUS installed'):copy('○ NEXUS未導入','○ NEXUS not installed')}</p></div>{g.installed?<a className="button button-primary" href={`/auth/select?guild=${encodeURIComponent(g.id)}`}>{copy('Dashboardを開く','Open Dashboard')}</a>:g.installUrl&&<a className="button button-discord" href={g.installUrl}>{copy('NEXUSを追加','Add NEXUS')}</a>}</article>)}{!guilds.length&&<div className="server-empty"><h2>{copy('管理できるサーバーがありません','No manageable servers found')}</h2><p>{copy('Discordでサーバー所有者、Manage Guild、またはAdministrator権限が必要です。','You need server ownership, Manage Guild, or Administrator permission in Discord.')}</p></div>}</div>;
}
