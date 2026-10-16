"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import Image from "next/image";
import {csrfHeaders} from "../../auth/csrf-client";
import {safeError} from "../../safe-error";
import type {ReportDefinition,ReportDefinitionCurrent} from "../../../../../packages/operations/src/reports";
import type {ChartQuery} from "../../../../../packages/analytics/src/chart-spec";
type Draft={draftId:string;templateId:string;version:number;headRevisionId:string;state:"DRAFT"|"COMMITTED";definition:ReportDefinition;contentHash:string;baseLiveVersion:string};
type Catalog={templates:{id:string;title:string;revision:number}[];drafts:{id:string;template_id:string;version:number;state:string}[];views:{id:string;name:string}[];permissions:string[];canConfigure:boolean};
type Preview={draft:Draft;current:ReportDefinitionCurrent;changedFields:string[];blockers:string[];canCommit:boolean;confirmationHash:string};
type Intent={path:string;body:unknown;expected:string|number;draftId:string;kind:"create"|"edit"|"commit"|"cancel"};
class RequestError extends Error {constructor(code:string,readonly status:number){super(code);}}
const metrics:ChartQuery["metric"][]=["reply","forum","voice","event","reaction","poll"];
const blankQuery=():ChartQuery=>({metric:"reply",days:7,timezone:"UTC",compare:false,filter:{channelIds:[],categoryIds:[],roleIds:[],surface:"ALL",recipeVersionId:null}});
export function ReportDefinitionsWorkspace({guildId,locale}:{guildId:string;locale:"ja"|"en"}){
 const t=(en:string,ja:string)=>locale==="ja"?ja:en;
 const metricName:Record<ChartQuery["metric"],string>={reply:t("Direct replies","直接の返信"),forum:t("Forum responses","フォーラムの返信"),voice:t("Voice co-presence","ボイスで同席"),event:t("Event signups","イベント参加登録"),reaction:t("Reactions","リアクション"),poll:t("Poll participation","投票への参加")};
 const [catalog,setCatalog]=useState<Catalog|null>(null),[current,setCurrent]=useState<ReportDefinitionCurrent|null>(null),[draft,setDraft]=useState<Draft|null>(null),[form,setForm]=useState<ReportDefinition|null>(null),[preview,setPreview]=useState<Preview|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[unknown,setUnknown]=useState(false),[confirmed,setConfirmed]=useState(false),[discard,setDiscard]=useState(false),[leaving,setLeaving]=useState(false);
 const inFlight=useRef(false),selection=useRef(0),intent=useRef<Intent|null>(null);
 const call=useCallback(async<T,>(path:string,body?:unknown,expected?:string|number):Promise<T>=>{
  const response=await fetch("/api/report-definitions/"+path,{method:body===undefined?"GET":"POST",cache:"no-store",headers:csrfHeaders({"X-Nexus-Guild":guildId,...(body===undefined?{}:{"Content-Type":"application/json","If-Match":`"${expected}"`})}),...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok||!result.ok)throw new RequestError(result.error?.code??"SERVICE_UNAVAILABLE",response.status);return result.data as T;
 },[guildId]);
 const refresh=useCallback(async()=>{setCatalog(await call<Catalog>("templates"));},[call]);
 useEffect(()=>{let live=true;setLoading(true);call<Catalog>("templates").then(value=>{if(live)setCatalog(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE");}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;selection.current++;};},[call]);
 const canConfigure=!!catalog?.canConfigure&&catalog.permissions.includes("CONFIGURE"),blocked=busy||unknown;
 function message(code:string){
  if(["REPORT_DEFINITION_CONFLICT","REPORT_DRAFT_CONFLICT","REVISION_CONFLICT"].includes(code))return t("The definition changed. Reload it and review your changes.","定義が変更されています。再読み込みして変更内容を確認してください。");
  if(code==="REPORT_DRAFT_REFERENCE_CHANGED"||code==="SAVED_VIEW_NOT_FOUND")return t("A saved view changed or was removed. Review the selected views before committing.","保存ビューが変更または削除されています。選択したビューを確認してください。");
  if(code==="CHOOSE_ONE_TO_FOUR_CHARTS")return t("Choose one to four charts and saved views in total.","グラフと保存ビューを合計1〜4件選択してください。");
  if(code==="REPORT_DRAFT_ALREADY_COMMITTED")return t("This draft has been committed. Create a new draft from the current template to make another change.","この下書きは確定済みです。変更する場合は現在のテンプレートから新しい下書きを作成してください。");
  if(code==="SCHEMA_NOT_INSTALLED")return t("Report definition editing is not yet available on this server.","このサーバーではレポート定義の編集準備が完了していません。");
  if(code==="REPORT_DRAFT_NOT_FOUND")return t("This draft is no longer available. Reload the list.","この下書きは利用できません。一覧を読み直してください。");
  return safeError(code,locale);
 }
 function change(value:ReportDefinition){setForm(value);setDirty(true);setPreview(null);setConfirmed(false);setError("");}
 async function selectTemplate(id:string){if(inFlight.current||blocked||dirty)return;inFlight.current=true;const epoch=++selection.current;setBusy(true);setError("");try{const value=await call<ReportDefinitionCurrent>("templates/"+id);if(epoch===selection.current){setCurrent(value);setDraft(null);setForm(value.definition);setDirty(false);setPreview(null);setConfirmed(false);setDiscard(false);setNotice("");}}catch(e){setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE");}finally{inFlight.current=false;setBusy(false);}}
 async function selectDraft(id:string){if(inFlight.current||blocked||dirty)return;inFlight.current=true;const epoch=++selection.current;setBusy(true);setError("");try{const value=await call<Draft>("drafts/"+id);if(epoch===selection.current){setDraft(value);setForm(value.definition);setCurrent(null);setDirty(false);setPreview(null);setConfirmed(false);setDiscard(false);setNotice("");}}catch(e){setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE");}finally{inFlight.current=false;setBusy(false);}}
 function close(){setCurrent(null);setDraft(null);setForm(null);setPreview(null);setDirty(false);setConfirmed(false);setDiscard(false);setLeaving(false);setNotice("");selection.current++;}
 async function mutate(value:Intent){
  if(inFlight.current||unknown)return;inFlight.current=true;intent.current=value;setBusy(true);setError("");setNotice("");
  try{const result=await call<Draft|{state:string}>(value.path,value.body,value.expected);intent.current=null;
   if(value.kind==="create"||value.kind==="edit"){const next=result as Draft;setDraft(next);setForm(next.definition);setDirty(false);setPreview(null);setConfirmed(false);setNotice(t("Draft saved.","下書きを保存しました。"));}
   else if(value.kind==="commit"){if(draft)setDraft({...draft,state:"COMMITTED",version:draft.version+1});setPreview(null);setConfirmed(false);setNotice(t("The report definition was committed. Reload the template to view its current version.","レポート定義を確定しました。現在の内容はテンプレートを読み直して確認できます。"));}
   else {close();setNotice(t("Draft discarded.","下書きを破棄しました。"));}
   void refresh().catch(e=>setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE"));
  }catch(e){if(!(e instanceof RequestError)||e.status>=500){setUnknown(true);setError("");}else{intent.current=null;setError(e.message);}}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function recover(){const pending=intent.current;if(!pending||inFlight.current)return;inFlight.current=true;setBusy(true);setError("");try{
  const value=await call<Draft>("drafts/"+pending.draftId);setDraft(value);setForm(value.definition);setDirty(false);setPreview(null);setUnknown(false);intent.current=null;setNotice(t("The saved state has been loaded. Review it before another change.","保存されている状態を読み込みました。次の変更前に確認してください。"));
 }catch(e){if(e instanceof RequestError&&e.message==="REPORT_DRAFT_NOT_FOUND"){setUnknown(false);intent.current=null;close();setNotice(t("No saved draft was found. Reload the template to continue.","保存済みの下書きはありません。テンプレートを読み直して続けてください。"));}else setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE");}finally{inFlight.current=false;setBusy(false);}}
 function save(event:FormEvent){event.preventDefault();if(!form||!canConfigure||blocked)return;
  if(draft){if(draft.state!=="DRAFT")return;void mutate({kind:"edit",path:`drafts/${draft.draftId}/revisions`,expected:draft.version,draftId:draft.draftId,body:{version:draft.version,sourceRevisionId:draft.headRevisionId,revisionId:crypto.randomUUID(),definition:form}});}
  else if(current){const id=crypto.randomUUID();void mutate({kind:"create",path:"drafts",expected:current.liveVersion,draftId:id,body:{draftId:id,revisionId:crypto.randomUUID(),templateId:current.templateId,liveVersion:current.liveVersion,definition:form}});}
 }
 async function showPreview(){if(inFlight.current||!draft||dirty||blocked)return;inFlight.current=true;setBusy(true);setError("");try{setPreview(await call<Preview>(`drafts/${draft.draftId}/preview`));setConfirmed(false);}catch(e){setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE");}finally{inFlight.current=false;setBusy(false);}}
 function loadLogo(file:File|undefined){if(!form||!file||inFlight.current)return;if(file.size>100000){setError("INVALID_PNG_LOGO");return;}const selected=selection.current;inFlight.current=true;setBusy(true);const reader=new FileReader();reader.onload=()=>{if(selected===selection.current)change({...form,logoBase64:String(reader.result).split(",")[1]??null});inFlight.current=false;setBusy(false);};reader.onerror=()=>{setError("INVALID_PNG_LOGO");inFlight.current=false;setBusy(false);};reader.readAsDataURL(file);}
 function querySummary(query:ChartQuery){return `${metricName[query.metric]} · ${query.days} ${t("days","日")} · ${query.timezone}${query.compare?` · ${t("previous period comparison","前期間との比較")}`:""}${query.filter.channelIds.length?` · ${t("channels","チャンネル")}: ${query.filter.channelIds.join(", ")}`:""}${query.filter.categoryIds.length?` · ${t("categories","カテゴリ")}: ${query.filter.categoryIds.join(", ")}`:""}${query.filter.roleIds.length?` · ${t("roles","ロール")}: ${query.filter.roleIds.join(", ")}`:""}`;}
 const fields:Record<string,string>={title:t("Title","タイトル"),footer:t("Footer","フッター"),logoBase64:t("Logo","ロゴ"),queries:t("Charts","グラフ"),viewIds:t("Saved views","保存ビュー"),includeAttention:t("Attention summary","対応状況の集計"),includeInterventions:t("Improvement reviews","施策レビュー")};
 return <>
  <header className="surface"><h1>{t("Report definitions","レポート定義")}</h1><p>{t("Save a draft, review the changes, then choose when to use it for future reports.","下書きを保存し、変更内容を確認してから、今後のレポートに使う定義を確定します。")}</p></header>
  {loading&&<p role="status">{t("Loading…","読み込み中…")}</p>}
  {error&&<><p role="alert">{message(error)}</p>{!catalog&&<button disabled={blocked} onClick={()=>{setLoading(true);setError("");void refresh().catch(e=>setError(e instanceof Error?e.message:"SERVICE_UNAVAILABLE")).finally(()=>setLoading(false));}}>{t("Reload list","一覧を再読み込み")}</button>}</>}{notice&&<p role="status">{notice}</p>}
  {unknown&&<section className="surface" role="alert"><p>{t("The response was lost. Check the saved state before continuing.","応答を確認できませんでした。保存されている状態を確認してから続けてください。")}</p><button disabled={busy} onClick={()=>void recover()}>{t("Check saved state","保存状態を確認")}</button></section>}
  {!loading&&catalog&&<section className="surface"><h2>{t("Saved templates","保存済みテンプレート")}</h2>
   {!catalog.templates.length&&<p>{t("Create a report template to begin.","レポートのテンプレートを作成すると編集を始められます。 ")}<a href="/operations?view=reports">{t("Create template","テンプレートを作成")}</a></p>}
   {catalog.templates.map(row=><button key={row.id} disabled={blocked||dirty} onClick={()=>void selectTemplate(row.id)}>{row.title}</button>)}
   <h2>{t("Drafts and committed definitions","下書きと確定済みの定義")}</h2>{!catalog.drafts.length&&<p>{t("No drafts yet.","下書きはまだありません。")}</p>}
   {catalog.drafts.map(row=><button key={row.id} disabled={blocked||dirty} onClick={()=>void selectDraft(row.id)}>{catalog.templates.find(template=>template.id===row.template_id)?.title??t("Report","レポート")} · {row.state==="DRAFT"?t("Draft","下書き"):t("Committed","確定済み")}</button>)}
   {!canConfigure&&<p>{!catalog.permissions.includes("CONFIGURE")?t("You can view definitions. Editing requires configuration access.","定義を閲覧できます。編集には設定権限が必要です。"):t("Editing report definitions is unavailable under the current access conditions.","現在の利用条件ではレポート定義を編集できません。")}</p>}
  </section>}
  {form&&<section className="surface"><h2>{draft?t("Edit draft","下書きを編集"):t("Create draft from template","テンプレートから下書きを作成")}</h2>
   <form onSubmit={save}><fieldset disabled={!canConfigure||blocked||draft?.state==="COMMITTED"}>
    <label>{fields.title}<input required maxLength={120} value={form.title} onChange={event=>change({...form,title:event.target.value})}/></label>
    <label>{fields.footer}<input maxLength={200} value={form.footer} onChange={event=>change({...form,footer:event.target.value})}/></label>
    <h3>{fields.queries}</h3>{form.queries.map((query,index)=><div className="operations-fields" key={index}>
     <label>{t("Metric","指標")}<select value={query.metric} onChange={event=>change({...form,queries:form.queries.map((value,i)=>i===index?{...value,metric:event.target.value as ChartQuery["metric"]}:value)})}>{metrics.map(metric=><option key={metric} value={metric}>{metricName[metric]}</option>)}</select></label>
     <label>{t("Period","期間")}<select value={query.days} onChange={event=>change({...form,queries:form.queries.map((value,i)=>i===index?{...value,days:Number(event.target.value) as ChartQuery["days"]}:value)})}>{[7,30,90].map(days=><option key={days} value={days}>{days} {t("days","日")}</option>)}</select></label>
     <label>{t("Time zone","タイムゾーン")}<input required maxLength={80} value={query.timezone} onChange={event=>change({...form,queries:form.queries.map((value,i)=>i===index?{...value,timezone:event.target.value}:value)})}/></label>
     <label><input type="checkbox" checked={query.compare} onChange={event=>change({...form,queries:form.queries.map((value,i)=>i===index?{...value,compare:event.target.checked}:value)})}/>{t("Compare previous period","前の期間と比較")}</label>
     <button type="button" onClick={()=>change({...form,queries:form.queries.filter((_,i)=>i!==index)})}>{t("Remove chart","グラフを外す")}</button>
    </div>)}
    <button type="button" disabled={form.queries.length+form.viewIds.length>=4} onClick={()=>change({...form,queries:[...form.queries,blankQuery()]})}>{t("Add chart","グラフを追加")}</button>
    <label>{fields.viewIds}<select multiple value={form.viewIds} onChange={event=>change({...form,viewIds:[...event.target.selectedOptions].map(option=>option.value)})}>{[...new Set([...(catalog?.views.map(view=>view.id)??[]),...form.viewIds])].map(id=><option key={id} value={id}>{catalog?.views.find(view=>view.id===id)?.name??t("Saved view","保存ビュー")}</option>)}</select></label>
    <p>{t("Choose one to four charts and saved views in total.","グラフと保存ビューを合計1〜4件選択してください。")}</p>
    <label><input type="checkbox" checked={form.includeAttention} onChange={event=>change({...form,includeAttention:event.target.checked})}/>{fields.includeAttention}</label>
    <label><input type="checkbox" checked={form.includeInterventions} onChange={event=>change({...form,includeInterventions:event.target.checked})}/>{fields.includeInterventions}</label>
    <label>{t("Logo · PNG up to 100 KB","ロゴ · PNG 100 KBまで")}<input type="file" accept="image/png" onChange={event=>loadLogo(event.target.files?.[0])}/></label>
    <p>{form.logoBase64?t("A logo is saved.","ロゴが保存されています。"):t("No logo.","ロゴは未設定です。")}</p>{form.logoBase64&&<><Image unoptimized src={`data:image/png;base64,${form.logoBase64}`} alt={t("Draft report logo","下書きのレポートロゴ")} width={96} height={96}/><button type="button" onClick={()=>change({...form,logoBase64:null})}>{t("Remove logo","ロゴを外す")}</button></>}
    <button type="submit" disabled={form.queries.length+form.viewIds.length<1||form.queries.length+form.viewIds.length>4}>{draft?t("Save draft changes","下書きの変更を保存"):t("Save draft","下書きを保存")}</button>
   </fieldset></form>
   {dirty&&<p>{t("Save changes before previewing or switching definitions.","プレビューや定義の切替前に変更を保存してください。")}</p>}
   {draft&&<button disabled={blocked||dirty} onClick={()=>void showPreview()}>{t("Preview changes","変更をプレビュー")}</button>}
   <button disabled={blocked} onClick={()=>dirty?setLeaving(true):close()}>{t("Back to list","一覧へ戻る")}</button>
   {leaving&&<div role="dialog" aria-label={t("Unsaved changes","未保存の変更")}><p>{t("Discard the unsaved edits? The saved draft will remain.","未保存の編集を破棄しますか。保存済みの下書きは残ります。")}</p><button onClick={()=>setLeaving(false)}>{t("Keep editing","編集を続ける")}</button><button onClick={close}>{t("Discard edits and return","編集を破棄して戻る")}</button></div>}
   {draft?.state==="DRAFT"&&canConfigure&&<><button disabled={blocked} onClick={()=>setDiscard(!discard)}>{t("Discard saved draft","保存済みの下書きを破棄")}</button>{discard&&<div role="dialog" aria-label={t("Discard draft","下書きを破棄")}><p>{t("This removes the draft and its saved revisions.","この下書きと保存済みの編集履歴を削除します。")}</p><button disabled={blocked} onClick={()=>setDiscard(false)}>{t("Keep draft","下書きを残す")}</button><button disabled={blocked} onClick={()=>void mutate({kind:"cancel",path:`drafts/${draft.draftId}/cancel`,expected:draft.version,draftId:draft.draftId,body:{version:draft.version}})}>{t("Discard draft","下書きを破棄")}</button></div>}</>}
  </section>}
  {preview&&<section className="surface"><h2>{t("Review changes","変更内容を確認")}</h2><p>{preview.changedFields.length?preview.changedFields.map(field=>fields[field]??field).join(" · "):t("No content changes.","内容の変更はありません。")}</p>
   <table><thead><tr><th>{t("Field","項目")}</th><th>{t("Current","現在")}</th><th>{t("Draft","下書き")}</th></tr></thead><tbody><tr><th>{fields.title}</th><td>{preview.current.definition.title}</td><td>{preview.draft.definition.title}</td></tr><tr><th>{fields.footer}</th><td>{preview.current.definition.footer}</td><td>{preview.draft.definition.footer}</td></tr><tr><th>{fields.queries}</th><td>{preview.current.definition.queries.map(querySummary).join(" / ")}</td><td>{preview.draft.definition.queries.map(querySummary).join(" / ")}</td></tr><tr><th>{fields.viewIds}</th><td>{preview.current.definition.viewIds.map(id=>catalog?.views.find(view=>view.id===id)?.name??t("Saved view","保存ビュー")).join(" / ")}</td><td>{preview.draft.definition.viewIds.map(id=>catalog?.views.find(view=>view.id===id)?.name??t("Saved view","保存ビュー")).join(" / ")}</td></tr>{(["includeAttention","includeInterventions"] as const).map(field=><tr key={field}><th>{fields[field]}</th><td>{preview.current.definition[field]?t("Included","含める"):t("Excluded","含めない")}</td><td>{preview.draft.definition[field]?t("Included","含める"):t("Excluded","含めない")}</td></tr>)}<tr><th>{fields.logoBase64}</th><td>{preview.current.definition.logoBase64&&<Image unoptimized src={`data:image/png;base64,${preview.current.definition.logoBase64}`} alt={t("Current logo","現在のロゴ")} width={96} height={96}/>}</td><td>{preview.draft.definition.logoBase64&&<Image unoptimized src={`data:image/png;base64,${preview.draft.definition.logoBase64}`} alt={t("Draft logo","下書きのロゴ")} width={96} height={96}/>}</td></tr></tbody></table>
   {preview.blockers.map(code=><p key={code} role="alert">{message(code)}</p>)}
   <p>{t("Committing updates the definition used by future reports. Existing delivery times stay as configured.","確定すると今後のレポートで使う定義が更新されます。設定済みの送信時刻はそのままです。")}</p>
   <label><input type="checkbox" disabled={!canConfigure||!preview.canCommit||blocked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{t("Use this definition for future reports","今後のレポートでこの定義を使う")}</label>
   <button disabled={!canConfigure||!preview.canCommit||!confirmed||blocked} onClick={()=>void mutate({kind:"commit",path:`drafts/${preview.draft.draftId}/commit`,expected:preview.draft.version,draftId:preview.draft.draftId,body:{version:preview.draft.version,headRevisionId:preview.draft.headRevisionId,confirmationHash:preview.confirmationHash,liveVersion:preview.current.liveVersion}})}>{t("Commit definition","定義を確定")}</button>
  </section>}
 </>;
}
