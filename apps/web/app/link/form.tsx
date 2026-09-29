'use client';
import {useState,type FormEvent} from 'react';
import type {SiteLocale} from '../public-ui';
export function LinkForm({locale}:{locale:SiteLocale}){
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[guildId,setGuildId]=useState<string|null>(null);
 const c=(ja:string,en:string)=>locale==='ja'?ja:en;
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');const input=code;setCode('');try{const response=await fetch('/link/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:input})});const data=await response.json() as {guildId?:string;error?:string};if(response.ok&&data.guildId){setGuildId(data.guildId);}else setError(data.error==='VERIFICATION_RATE_LIMIT'?c('試行回数の上限に達しました。10分待ってから再試行してください。','Too many attempts. Wait 10 minutes before trying again.'):c('コードを使用できません。発行したDiscordアカウントでログインし、/nexus link で新しいコードを取得してください。','This code cannot be used. Sign in with the Discord account that issued it and run /nexus link for a new code.'));}catch{setError(c('接続を確認して再試行してください。','Check your connection and try again.'));}finally{setBusy(false);}}
 if(guildId)return <section className="surface verification-result" role="status"><h2>{c('Web接続を検証しました','Web connection verified')}</h2><a className="button button-primary" href={`/dashboard/${guildId}`}>{c('Dashboardを開く','Open Dashboard')}</a></section>;
 return <form className="surface verification-form" onSubmit={event=>void submit(event)}><label htmlFor="verification-code">{c('検証コード','Verification code')}</label><input id="verification-code" value={code} onChange={event=>setCode(event.target.value)} maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} required disabled={busy}/><button className="button button-primary" type="submit" disabled={busy||!code.trim()}>{busy?c('確認中…','Verifying…'):c('サーバーを検証','Verify server')}</button>{error&&<p role="alert">{error}</p>}</form>;
}
