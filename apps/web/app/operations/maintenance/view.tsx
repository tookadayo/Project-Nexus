"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {csrfHeaders} from "../../auth/csrf-client";
import {safeError} from "../../safe-error";
import {ConfirmationDialog} from "../../confirmation-dialog";
import {ObservationChart} from "../../observation-chart";
import type {ChartSpec} from "../../../../../packages/analytics/src/chart-spec";
type Row=Record<string,unknown>;
const isRow=(value:unknown):value is Row=>value!==null&&typeof value==="object"&&!Array.isArray(value);
type Resource="events"|"intake"|"reports"|"teams"|"organization"|"interventions"|"destinations"|"credentials"|"webhooks";
const resources:Resource[]=['events','intake','reports','teams','organization','interventions','destinations','credentials','webhooks'];
const names:Record<Resource,[string,string]>={events:['Events','イベント'],intake:['Intake','相談受付'],reports:['Reports','レポート'],teams:['Teams','チーム'],organization:['Organization','組織'],interventions:['Improvement reviews','改善の振り返り'],destinations:['Destinations','送信先'],credentials:['API credentials','API認証情報'],webhooks:['Webhooks','Webhook']};
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[];
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.filter((v):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v)):[];
const text=(row:Row,key:string)=>typeof row[key]==='string'?row[key] as string:'';
const number=(row:Row,key='revision')=>Number.isSafeInteger(Number(row[key]))?Number(row[key]):0;
const label=(row:Row)=>text(row,'name')||text(row,'title')||text(row,'category')||text(row,'id');
type Selection={row:Row;action:string;mode:'delete'|'edit'|'rotate'|'state'|'generate'|'end'|'detach'|'relink'};
export function MaintenanceWorkspace({guildId,locale}:{guildId:string;locale:'ja'|'en'}){
 const ja=locale==='ja',t=(en:string,jp:string)=>ja?jp:en;
 const [resource,setResource]=useState<Resource>('events'),[value,setValue]=useState<unknown>(null),[permissions,setPermissions]=useState<string[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selection,setSelection]=useState<Selection|null>(null),[detail,setDetail]=useState<Row|null>(null),[token,setToken]=useState('');
 const pending=useRef(false),generation=useRef(0),intent=useRef<string|null>(null);
 const call=useCallback(async(path:string,body?:unknown)=>{
  const version=body&&typeof body==='object'?((body as Row).revision??(body as Row).version??(body as Row).templateRevision):undefined;
  const response=await fetch('/api/operations-maintenance/'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:csrfHeaders({'X-Nexus-Guild':guildId,...(body===undefined?{}:{'Content-Type':'application/json','If-Match':`"${version}"`})}),...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error?.code||'SERVICE_UNAVAILABLE');return data.data;
 },[guildId]);
 const load=useCallback(async()=>{const data=await call(resource);setValue(data.value);setPermissions(strings(data.permissions));},[call,resource]);
 useEffect(()=>{let live=true;const current=++generation.current;setLoading(true);setValue(null);setSelection(null);setDetail(null);setToken('');setError('');setNotice('');intent.current=null;
  call(resource).then(data=>{if(live&&current===generation.current){setValue(data.value);setPermissions(strings(data.permissions));}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'SERVICE_UNAVAILABLE');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[call,resource]);
 async function perform(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(e instanceof Error?e.message:'RESULT_UNKNOWN');}finally{pending.current=false;setBusy(false);}}
 const object=value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
 const configure=permissions.includes('CONFIGURE'),operate=permissions.includes('OPERATE'),govern=permissions.includes('GOVERN');
 function select(row:Row,action:string,mode:Selection['mode']){setSelection({row,action,mode});setDetail(null);setNotice('');intent.current=mode==='generate'?crypto.randomUUID():null;}
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selection)return;const form=new FormData(event.currentTarget),row=selection.row;
  const field=(key:string)=>String(form.get(key)??'').trim();let input:unknown={id:text(row,'id'),revision:number(row)};
  if(selection.mode==='edit'){
    if(resource==='organization')input={revision:number(row),name:field('name')};
    else if(resource==='teams')input={id:text(row,'id'),revision:number(row),name:field('name'),memberIds:form.getAll('members').map(String)};
   else if(resource==='interventions')input={id:text(row,'id'),revision:number(row),title:field('name'),teamId:field('teamId')||null};
   else if(resource==='credentials')input={id:text(row,'id'),revision:number(row),input:{name:field('name'),scopes:form.getAll('scopes').map(String)}};
   else if(resource==='webhooks')input={id:text(row,'id'),revision:number(row),input:{name:field('name'),url:field('url'),events:form.getAll('events').map(String)}};
   else if(resource==='destinations'){
    const kind=field('kind');input={id:text(row,'id'),revision:number(row),input:{name:field('name'),kind,...(kind==='DISCORD'?{channelId:field('channelId'),roleId:field('roleId')||null}:kind==='TEAM'?{teamId:field('teamId')}:{endpointId:field('endpointId')})}};
   }
  }else if(resource==='intake')input=selection.mode==='state'?{key:text(row,'attention_key'),channelId:text(row,'channel_id'),version:number(row,'version'),state:field('state')}:{id:text(row,'id'),version:number(row,'version')};
  if(selection.mode==='generate')input={templateId:text(row,'id'),templateRevision:number(row),requestId:intent.current};
  if(selection.action==='organization/close')input={revision:number(row)};
  if(selection.action==='organization/unlink'||selection.action==='organization/relink')input={guildId:text(row,'guild_id'),revision:number(row)};
  if(selection.action==='events/enabled')input={id:text(row,'id'),revision:number(row),enabled:text(row,'state')!=='ENABLED'};
  await perform(async()=>{const result=await call(selection.action,input);setSelection(null);intent.current=null;if(typeof result.token==='string')setToken(result.token);setNotice(t('Operation completed.','操作が完了しました。'));await load();});
 }
 const button=(row:Row,action:string,mode:Selection['mode'],en:string,jp:string,allowed:boolean)=> <button disabled={busy||!allowed} onClick={()=>select(row,action,mode)}>{t(en,jp)}</button>;
 function cards(items:Row[],kind:string){return items.length?<ul className="maintenance-list">{items.map(row=><li key={text(row,'id')}><h3>{label(row)}</h3><dl><dt>ID</dt><dd><code>{text(row,'id')}</code></dd><dt>{t('Status','状態')}</dt><dd>{text(row,'state')||text(row,'status')||'—'}</dd><dt>{t('Revision','更新番号')}</dt><dd>{number(row,resource==='intake'?'version':'revision')||'—'}</dd></dl>
  <div className="maintenance-actions">
  {resource==='events'&&<>{button(row,'events/enabled','state',text(row,'state')==='ENABLED'?'Disable':'Enable',text(row,'state')==='ENABLED'?'無効にする':'有効にする',configure)}{button(row,'events/delete','delete','Delete saved event','保存イベントを削除',configure)}</>}
  {resource==='intake'&&(kind==='requests'?<>{button(row,'intake/state','state','Change status','状態変更',operate)}{button(row,'intake/delete-request','delete','Erase request','相談を削除',configure)}</>:button(row,'intake/delete-panel','delete','Delete panel','受付パネルを削除',configure))}
  {resource==='reports'&&(kind==='templates'?<>{button(row,'reports/generate','generate','Generate result','結果を生成',permissions.includes('ANALYZE')&&!!(object.manualGeneration as Row|undefined)?.enabled)}{button(row,'reports/delete-template','delete','Delete template','テンプレートを削除',configure)}</>:kind==='schedules'?button(row,'reports/delete-schedule','delete','Delete schedule','予定を削除',configure):text(row,'run_kind')==='MANUAL'?<><button disabled={busy} onClick={()=>void perform(async()=>setDetail((await call('reports/result/'+text(row,'id'))).value))}>{t('View result','結果を見る')}</button>{button(row,'reports/delete-result','delete','Delete result','結果を削除',configure)}</>:null)}
  {resource==='teams'&&<>{button(row,'teams/update','edit','Edit team','チームを編集',govern)}{button(row,'teams/delete','delete','Delete team','チームを削除',govern)}</>}
  {resource==='interventions'&&<><button disabled={busy} onClick={()=>void perform(async()=>setDetail((await call('interventions/detail/'+text(row,'id'))).value))}>{t('View comparison','比較を見る')}</button>{button(row,'interventions/update','edit','Edit details','詳細を編集',operate&&text(row,'state')!=='ARCHIVED')}{button(row,'interventions/end','end','End review','振り返りを終了',operate&&text(row,'state')!=='ARCHIVED')}</>}
  {['destinations','credentials','webhooks'].includes(resource)&&<>{button(row,resource+'/update','edit','Edit','編集',configure)}{resource==='credentials'?button(row,'credentials/rotate','rotate','Rotate token','トークンを更新',configure&&text(row,'state')==='ENABLED'):button(row,resource+'/delete','delete','Delete','削除',configure)}</>}
  </div></li>)}</ul>:<p>{t('No saved items.','保存された項目はありません。')}</p>;}
 const dialogTitles:Record<Selection['mode'],[string,string]>={edit:['Edit saved settings','保存済みの設定を編集'],rotate:['Replace API token','APIトークンを置換'],generate:['Generate a saved report','保存レポートを生成'],state:['Change status','状態を変更'],end:['End this review','この振り返りを終了'],delete:['Delete this saved item','この保存項目を削除'],detach:['Stop server link','サーバー連携を停止'],relink:['Reauthorize server link','サーバー連携を再開']};
 return <section aria-busy={loading||busy}><h1>{t('Manage saved operations','保存済みの運用を管理')}</h1>
  <p>{t('Select an item to change its saved configuration. Existing setup and creation tools remain available from Operations.','項目を選んで保存済みの設定を変更できます。新規作成や初期設定は運用画面から開けます。')}</p>
  <p><a href="/operations">{t('Back to Operations','運用画面に戻る')}</a></p>
  <nav aria-label={t('Resource','管理対象')} className="maintenance-tabs">{resources.map(r=><button key={r} aria-pressed={resource===r} disabled={busy} onClick={()=>setResource(r)}>{names[r][ja?1:0]}</button>)}</nav>
  {error&&<div role="alert"><p>{safeError(error,locale)} <code>{/^[A-Z_]{1,80}$/.test(error)?error:'SERVICE_UNAVAILABLE'}</code></p><p>{t('A lost response may mean the operation completed. Reload to inspect the saved state before another action.','応答が失われても操作が完了している場合があります。再実行する前に再読込で保存状態を確認してください。')}</p></div>}
  {notice&&<p role="status">{notice}</p>}
  <button disabled={busy||loading} onClick={()=>void perform(load)}>{t('Reload saved state','保存状態を再読込')}</button>
  {loading?<p role="status">{t('Loading…','読み込み中…')}</p>:value===null?<p>{t('Data is unavailable.','データを取得できません。')}</p>:<>
   <h2>{names[resource][ja?1:0]}</h2>
   {resource==='organization'?<>
    {object.organization&&typeof object.organization==='object'?<article><h3>{label(object.organization as Row)}</h3><p>{text(object.organization as Row,'id')}</p>{button(object.organization as Row,'organization/rename','edit','Rename organization','組織名を変更',govern)}{button(object.organization as Row,'organization/close','delete','Close organization','組織を閉鎖',govern&&!!((object.maintenance as Row|undefined)?.close as Row|undefined)?.enabled)}</article>:<p>{t('No linked organization.','連携された組織はありません。')}</p>}
    <p>{t('Closing or unlinking requires verified ownership and removal of references. Unresolved safety or authorization records keep the operation unavailable.','閉鎖・連携解除には所有権と参照関係の確認が必要です。安全状態や権限の記録が未解決の場合は利用できません。')}</p>
    <ul>{rows(object.guilds).map(g=><li key={text(g,'guild_id')}><code>{text(g,'guild_id')}</code> {text(g,'state')} {text(g,'state')==='DETACHED'?button(g,'organization/relink','relink','Reauthorize server link','権限を確認して連携を再開',govern&&!!((object.maintenance as Row|undefined)?.relink as Row|undefined)?.enabled):button(g,'organization/unlink','detach','Stop server link','サーバー連携を停止',govern&&!!((object.maintenance as Row|undefined)?.unlink as Row|undefined)?.enabled)}</li>)}</ul>
   </>:resource==='intake'?<><h3>{t('Panels','受付パネル')}</h3>{cards(rows(object.panels),'panels')}<h3>{t('Requests','相談')}</h3>{cards(rows(object.requests),'requests')}</>:resource==='reports'?<>
    {(object.manualGeneration as Row|undefined)?.enabled!==true&&<p>{t('Manual generation is unavailable until its retention, runtime and privacy profile is configured.','手動生成は、保持期間・実行条件・プライバシー保護が設定されるまで利用できません。')}</p>}
    <h3>{t('Templates','テンプレート')}</h3>{cards(rows(object.templates),'templates')}<h3>{t('Schedules','予定')}</h3>{cards(rows(object.schedules),'schedules')}<h3>{t('Results','結果')}</h3>{cards(rows(object.runs),'runs')}</>:resource==='teams'?cards(rows(object.teams),'teams'):resource==='webhooks'?cards(rows(object.endpoints),'endpoints'):cards(rows(value),resource)}
  </>}
  {selection&&<ConfirmationDialog label={t('Confirm operation','操作の確認')} className="maintenance-dialog" busy={busy} onCancel={()=>{setSelection(null);intent.current=null;}}><h2 id="maintenance-confirm">{dialogTitles[selection.mode][ja?1:0]}</h2><p>{label(selection.row)}</p><p><code>{guildId} / {text(selection.row,'id')||text(selection.row,'guild_id')}</code></p>
   <form key={selection.action+text(selection.row,'id')} onSubmit={event=>void submit(event)}>
    {selection.mode==='edit'&&<>
     <label>{t('Name','名前')}<input name="name" required maxLength={resource==='interventions'?120:80} defaultValue={label(selection.row)}/></label>
     {resource==='teams'&&<fieldset><legend>{t('Members','メンバー')}</legend>{rows(object.members).filter(m=>text(m,'state')==='ACTIVE').map(m=><label key={text(m,'id')}><input type="checkbox" name="members" value={text(m,'id')} defaultChecked={strings(selection.row.member_ids).includes(text(m,'id'))}/>{label(m)}</label>)}</fieldset>}
     {resource==='interventions'&&<label>{t('Team ID (optional)','チームID（任意）')}<input name="teamId" defaultValue={text(selection.row,'assigned_team_id')} pattern="[a-fA-F0-9-]{36}"/></label>}
     {resource==='credentials'&&<fieldset><legend>{t('Allowed scopes','許可するスコープ')}</legend>{['guild:read','metrics:read','attention:read','interventions:read','attention:write','organization:read'].map(scope=><label key={scope}><input type="checkbox" name="scopes" value={scope} defaultChecked={strings(selection.row.scopes).includes(scope)}/>{scope}</label>)}</fieldset>}
     {resource==='webhooks'&&<><label>HTTPS URL<input name="url" type="url" required maxLength={2048} placeholder="https://"/></label><p>{t('Enter the complete URL again. Saved URL secrets are never displayed.','URL全体を再入力してください。保存済みURLに含まれる秘密情報は表示しません。')}</p><fieldset><legend>{t('Events','イベント')}</legend>{['attention.created','attention.resolved','playbook.executed','intervention.review_ready','coverage.changed','aggregate.export'].map(name=><label key={name}><input type="checkbox" name="events" value={name} defaultChecked={strings(selection.row.event_types).includes(name)}/>{name}</label>)}</fieldset></>}
     {resource==='destinations'&&<><label>{t('Destination type','送信先の種類')}<select name="kind" defaultValue={text(selection.row,'kind')}><option value="DISCORD">Discord</option><option value="TEAM">{t('Team','チーム')}</option><option value="WEBHOOK">Webhook</option></select></label><label>{t('Channel ID','チャンネルID')}<input name="channelId" inputMode="numeric" pattern="[0-9]{17,20}" defaultValue={text(selection.row,'channel_id')}/></label><label>{t('Role ID (optional)','ロールID（任意）')}<input name="roleId" inputMode="numeric" pattern="[0-9]{17,20}" defaultValue={text(selection.row,'role_id')}/></label><label>{t('Team ID','チームID')}<input name="teamId" defaultValue={text(selection.row,'team_id')}/></label><label>{t('Webhook endpoint ID','Webhook接続先ID')}<input name="endpointId" defaultValue={text(selection.row,'endpoint_id')}/></label></>}
    </>}
    {selection.mode==='state'&&resource==='intake'&&<label>{t('New status','新しい状態')}<select name="state" defaultValue={text(selection.row,'status')}>{['OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DISMISSED'].map(s=><option key={s}>{s}</option>)}</select></label>}
    {selection.mode==='rotate'&&<p>{t('The old token is revoked atomically. The new token is shown once. A lost response cannot reveal it again.','旧トークンを同じ処理で失効させ、新しいトークンを一度だけ表示します。応答を失った場合は再表示できません。')}</p>}
    {selection.mode==='delete'&&<p>{t('This removes the saved item. Referenced items and unresolved deliveries cannot be deleted. Published Discord messages are not removed.','保存済みの項目を削除します。参照中の項目や結果未確定の配信がある場合は削除できません。公開済みのDiscordメッセージは削除しません。')}</p>}
    {selection.mode==='generate'&&<p>{t('Generates a Web result without sending a message. The first accepted input is fixed.','メッセージ送信を行わず、Webで閲覧する結果を生成します。最初に受け付けた入力を固定します。')}</p>}
    {selection.mode==='detach'&&<p>{t('Stop operations for this linked server. Resuming requires a fresh check of the organization owner and server administrator permissions.','この連携サーバーの運用を停止します。再開には組織の所有権とサーバー管理権限の再確認が必要です。')}</p>}
    {selection.mode==='relink'&&<p>{t('Recheck organization ownership, current server administrators and retained assignments before resuming this server link.','組織の所有権・現在のサーバー管理者・保持された権限の割り当てを再確認し、このサーバー連携を再開します。')}</p>}
    <button type="button" disabled={busy} onClick={()=>{setSelection(null);intent.current=null;}}>{t('Cancel','取消')}</button><button type="submit" disabled={busy}>{t('Confirm','確定')}</button>
   </form></ConfirmationDialog>}
  {token&&<ConfirmationDialog label={t('New API token','新しいAPIトークン')} className="maintenance-dialog" onCancel={()=>setToken('')}><p>{t('Copy this token now. It is shown once.','トークンを今コピーしてください。一度だけ表示されます。')}</p><input readOnly aria-label="API token" value={token}/><button onClick={()=>void navigator.clipboard.writeText(token).catch(()=>setError('CLIPBOARD_UNAVAILABLE'))}>{t('Copy','コピー')}</button><button onClick={()=>setToken('')}>{t('Close and clear','閉じて消去')}</button></ConfirmationDialog>}
  {detail&&<section className="maintenance-detail"><h2>{t('Saved result','保存された結果')}</h2><p>{text(detail,'state')} · {text(detail,'asOf')||text(detail,'started_at')}</p><p>{text(detail,'unavailableReason')}</p><p>{t('Aggregate comparison describes an observation, without a causal claim.','集計の比較は観測内容を示し、因果関係を断定しません。')}</p>
   {isRow(detail.artifact)&&typeof detail.artifact==='object'&&<><h3>{text(detail.artifact as Row,'title')}</h3>{(Array.isArray((detail.artifact as Row).charts)?(detail.artifact as {charts:ChartSpec[]}).charts:[]).map((chart,index)=><ObservationChart key={index} spec={chart} locale={locale}/>)}<p>{text(detail.artifact as Row,'footer')}</p></>}
   {isRow(detail.baseline)&&<><h3>{t('Before','実施前')}</h3><ObservationChart spec={detail.baseline as ChartSpec} locale={locale}/></>}
   {isRow(detail.after_snapshot)&&<><h3>{t('After','実施後')}</h3><ObservationChart spec={detail.after_snapshot as ChartSpec} locale={locale}/></>}
   {isRow(detail.comparison)&&typeof detail.comparison==='object'&&<p>{(detail.comparison as Row).comparable===true?t('Comparable observation periods.','観測期間は比較条件を満たしています。'):t('The periods cannot be compared. Check coverage and window conditions.','期間を比較できません。観測範囲と期間の条件を確認してください。')}</p>}
   <button onClick={()=>setDetail(null)}>{t('Back','戻る')}</button></section>}
 </section>;
}
