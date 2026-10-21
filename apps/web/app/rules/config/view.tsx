"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {csrfHeaders} from "../../auth/csrf-client";
import {safeError} from "../../safe-error";
import {useUnsavedChanges} from "../../navigation-safety";
import {configMutation,configDraftMutation,emptyConfigDraft,editConfigDraft,type ConfigDraftForm,type ConfigChoice,type RuleConfigHistory} from "./model";
import {RuleDraftEditor} from "./draft-editor";
type Readiness = {permissions: string[]; evaluation?: {enabled: boolean; reasonCode?: string | null}};
export function RuleConfigWorkspace({guildId, locale}: {guildId: string; locale: "ja" | "en"}) {
  const text = (en: string, ja: string) => locale === "ja" ? ja : en;
  const [history, setHistory] = useState<RuleConfigHistory | null>(null), [readiness, setReadiness] = useState<Readiness | null>(null), [choice, setChoice] = useState<ConfigChoice | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [uncertain, setUncertain] = useState(false), [clock, setClock] = useState(Date.now);
  const [draftForm,setDraftForm]=useState<ConfigDraftForm|null>(null),[sourceTypes,setSourceTypes]=useState<string[]>([]);
  const lock = useRef(false), reader = useRef<AbortController | null>(null), generation = useRef(0), allowLeave = useUnsavedChanges(choice !== null || draftForm!==null || busy, locale);
  const canGovern = readiness?.permissions.includes("GOVERN") === true;
  const canConfigure=readiness?.permissions.includes("CONFIGURE")===true;
  const read = useCallback(async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setMessage(""); setHistory(null); setReadiness(null); setChoice(null);setDraftForm(null);setSourceTypes([]);
    const controller = new AbortController(), token = ++generation.current; reader.current = controller;
    async function get(path: string) {const response = await fetch(`/api/rules/${path}`, {headers: {"X-Nexus-Guild": guildId}, cache: "no-store", signal: controller.signal}), body = await response.json(); if (!response.ok || body.ok !== true) throw new Error(body.error?.code ?? "RULE_CONFIG_UNAVAILABLE"); return body.data;}
    try {const [configs, catalog] = await Promise.allSettled([get("config/history"), get("catalog")]); if (token === generation.current) {
      if (configs.status === "fulfilled") {setHistory(configs.value as RuleConfigHistory); setUncertain(false);} else setError(configs.reason instanceof Error ? configs.reason.message : "RULE_CONFIG_UNAVAILABLE");
      if (catalog.status === "fulfilled") {setReadiness(catalog.value.readiness as Readiness);setSourceTypes(Array.isArray(catalog.value.sourceTypes)?catalog.value.sourceTypes.filter((source:unknown):source is string=>typeof source==="string"):[]);} else if (configs.status === "fulfilled") setError(catalog.reason instanceof Error ? catalog.reason.message : "RULE_CONFIG_UNAVAILABLE");
    }} catch (cause) {if (token === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "RULE_CONFIG_UNAVAILABLE");}
    finally {if (token === generation.current) {lock.current = false; reader.current = null; setBusy(false);}}
  }, [guildId]);
  useEffect(() => {void read(); return () => {generation.current++; reader.current?.abort(); reader.current = null; lock.current = false;};}, [read]);
  useEffect(() => {const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer);}, []);
  const selected = choice ? history?.items.find(item => item.configVersion === choice.configVersion && item.contentHash === choice.contentHash) : undefined, envelope = choice && history ? configMutation(choice, history.currentVersion) : null;
  const gate = choice?.operation === "CONFIG_ACTIVATE" ? history?.mutationReadiness?.activation : history?.mutationReadiness?.retirement;
  const draftBuild=draftForm&&history?configDraftMutation(draftForm,history.currentVersion,sourceTypes):null;
  async function saveDraft(){
    if(lock.current||!history||!draftBuild?.ok||!canConfigure||uncertain)return;
    lock.current=true;setBusy(true);setError("");setMessage("");let sent=false;
    try{
      const envelope=draftBuild.envelope,headers=csrfHeaders({"Content-Type":"application/json","X-Nexus-Guild":guildId});
      const prepared=await fetch("/api/rules/mutation-request-key",{method:"POST",headers,body:JSON.stringify(envelope)}),keyBody=await prepared.json();
      if(!prepared.ok||keyBody.ok!==true||typeof keyBody.data?.key!=="string")throw new Error(keyBody.error?.code??"REQUEST_PREPARATION_UNAVAILABLE");
      headers.set("Idempotency-Key",keyBody.data.key);headers.set("If-Match",`"${envelope.expectedVersion}"`);sent=true;
      const response=await fetch("/api/rules/config/revisions",{method:"POST",headers,body:JSON.stringify(envelope.payload)}),body=await response.json();
      if(!response.ok||body.ok!==true||body.data?.status!=="DRAFT")throw new Error(body.error?.code??"RESULT_UNKNOWN");
      setDraftForm(null);setChoice(null);setHistory(null);setReadiness(null);
      setMessage(text("The new disabled draft was saved. The active version was not changed. Refresh to inspect the saved version.","新しい無効な下書きを保存しました。有効な版は変わっていません。再取得して保存済みの版を確認してください。"));
    }catch(cause){setError(cause instanceof Error?cause.message:"RULE_CONFIG_UNAVAILABLE");if(sent)setUncertain(true);}
    finally{lock.current=false;setBusy(false);}
  }
  async function confirm() {
    if (lock.current || draftForm!==null || !history || !choice || !selected || !envelope || !canGovern || !gate?.enabled || uncertain || Date.parse(selected.expiresAt) <= Date.now()) return;
    lock.current = true; setBusy(true); setError(""); setMessage(""); let sent = false;
    try {
      const headers = csrfHeaders({"Content-Type": "application/json", "X-Nexus-Guild": guildId});
      const prepared = await fetch("/api/rules/mutation-request-key", {method: "POST", headers, body: JSON.stringify(envelope)}), preparedBody = await prepared.json();
      if (!prepared.ok || preparedBody.ok !== true || typeof preparedBody.data?.key !== "string") throw new Error(preparedBody.error?.code ?? "REQUEST_PREPARATION_UNAVAILABLE");
      headers.set("Idempotency-Key", preparedBody.data.key); headers.set("If-Match", `"${history.currentVersion}"`); sent = true;
      const response = await fetch(`/api/rules/config/${choice.operation === "CONFIG_ACTIVATE" ? "activate" : "retire"}`, {method: "POST", headers, body: JSON.stringify(envelope.payload)}), body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(body.error?.code ?? "RESULT_UNKNOWN");
      setChoice(null); setHistory(null); setReadiness(null); setMessage(text("The operation was confirmed. Refresh to inspect the current active version and evaluation prerequisites.", "操作結果を確認しました。再取得して現在の有効な版と評価の前提を確認してください。"));
    } catch (cause) {setError(cause instanceof Error ? cause.message : "RULE_CONFIG_UNAVAILABLE"); if (sent) setUncertain(true);}
    finally {lock.current = false; setBusy(false);}
  }
  function cancelRead() {generation.current++; reader.current?.abort(); reader.current = null; lock.current = false; setBusy(false); setMessage(text("Reading canceled.", "取得を取り消しました。"));}
  return <section aria-busy={busy}><h1>{text("Rule evaluation settings", "ルールの評価設定")}</h1>
    <p>{text("Inspect saved immutable definitions, then select an exact draft or active version. Activation requires a server-verified measured operating profile, current authority and storage/source prerequisites. It does not enable external application or posting.", "保存済みの変更不可の定義を確認し、下書きまたは有効な版を選択します。有効化には、サーバーで検証する測定済み稼働profile、現在の権限、保持・情報源の前提が必要です。外部への適用や投稿は有効になりません。")}</p>
    <p>{text("Recommended responses remain readable with current read permission independently from these operating controls.", "推奨される対応は、この運用設定とは独立して現在の閲覧権限で確認できます。")}</p>
    <button disabled={busy} onClick={() => {if (allowLeave()) void read();}}>{text("Refresh saved versions", "保存済みの版を再取得")}</button>{reader.current && busy && <button onClick={cancelRead}>{text("Cancel reading", "取得を取り消す")}</button>}
    {busy && <p role="status">{text("Working…", "処理中…")}</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{safeError(error, locale)} <code>{/^[A-Z][A-Z0-9_]{0,79}$/.test(error) ? error : "RULE_CONFIG_UNAVAILABLE"}</code></p>}
    {uncertain && <p role="alert">{text("The outcome is unknown. Do not repeat a save, activation or retirement automatically. Refresh and reconcile the current version first.", "結果が不明です。保存・有効化・停止を自動で繰り返さず、再取得して現在の版を照合してください。")}</p>}
    {history && <><p>{text("Current configuration head", "現在の設定head")}: {history.currentVersion}</p><p>{text("Evaluation prerequisites", "評価の前提")}: {readiness?.evaluation?.enabled ? text("Currently satisfied; checked again on each request", "現時点では成立・実行ごとに再確認") : text("Not established", "未成立")} {readiness?.evaluation?.reasonCode && <code>{readiness.evaluation.reasonCode}</code>}</p>
      {!canGovern && <p>{text("Saved definitions are readable. Activation and retirement require the existing Govern permission.", "保存済み定義は閲覧できます。有効化と停止には既存の運営管理権限が必要です。")}</p>}
      {!canConfigure&&<p>{text("Creating or editing a draft requires the existing Configure permission.","下書きの作成・編集には既存の設定権限が必要です。")}</p>}
      <button disabled={busy||uncertain||!canConfigure||draftForm!==null} onClick={()=>{setChoice(null);setDraftForm(emptyConfigDraft());setError("");setMessage("");}}>{text("Create a blank disabled draft","空の無効な下書きを作成")}</button>
      {history.items.length === 0 ? <p>{text("No unexpired saved definition is available. No operating values or profile will be invented by this page.", "期限内の保存済み定義がありません。この画面で運用値やprofileを補完することはありません。")}</p> : <ul>{history.items.map(item => <li key={item.configVersion}><h2>{text("Version", "版")} {item.configVersion} · {item.status}</h2><p>{text("Expires", "期限")}: <time>{item.expiresAt}</time> · {text("Engine", "評価器")}: {item.engineVersion}</p><p>{text("Content hash", "内容ハッシュ")}: <code>{item.contentHash}</code></p>
        <p>{text("Operating profile", "稼働profile")}: {item.operatingProfileRevision ?? text("Not bound", "未束縛")} {item.operatingProfileExpiresAt && <time>{item.operatingProfileExpiresAt}</time>}</p>
        <button disabled={busy||uncertain||!canConfigure||draftForm!==null||Date.parse(item.expiresAt)<=clock} onClick={()=>{setChoice(null);setDraftForm(editConfigDraft(item.definition));setError("");setMessage("");}}>{text("Edit a copy as a disabled draft","コピーを無効な下書きとして編集")}</button>
        <details><summary>{text("Inspect saved definition", "保存済み定義を確認")}</summary><p>{text("Declared source types", "定義された情報源の型")}: {item.definition.approvedSourceTypes.join(", ") || text("None", "なし")}</p><p>{text("Execution limits", "実行の上限")}: {item.definition.budget ? Object.entries(item.definition.budget).map(([name, value]) => `${name}: ${value}`).join(" / ") : text("Unconfigured", "未設定")}</p><ul>{Object.entries(item.definition.rules).map(([ruleId, rule]) => rule && <li key={ruleId}>{ruleId} · {rule.enabled ? text("Configured enabled", "設定上は有効") : text("Disabled", "無効")} · {text("Minimum sample", "最小件数")} {rule.minimumN} · {text("Threshold", "閾値")} {rule.threshold} · {text("Coverage", "網羅率")} {rule.minimumCoverage} · {rule.windowDays} {text("days", "日")} · {text("Freshness seconds", "鮮度・秒")} {rule.freshnessSeconds}</li>)}</ul></details>
        {item.status === "DRAFT" && <><button disabled={busy || uncertain || draftForm!==null || !canGovern || !history.mutationReadiness?.activation.enabled || Date.parse(item.expiresAt) <= clock} onClick={() => setChoice({operation: "CONFIG_ACTIVATE", configVersion: item.configVersion, contentHash: item.contentHash})}>{text("Review activation", "有効化を確認")}</button>{history.mutationReadiness?.activation.reasonCode && <p>{text("Activation prerequisite", "有効化の前提")}: <code>{history.mutationReadiness.activation.reasonCode}</code></p>}</>}
        {item.status === "ACTIVE" && <><button disabled={busy || uncertain || draftForm!==null || !canGovern || !history.mutationReadiness?.retirement.enabled || Date.parse(item.expiresAt) <= clock} onClick={() => setChoice({operation: "CONFIG_RETIRE", configVersion: item.configVersion, contentHash: item.contentHash})}>{text("Review retirement", "停止を確認")}</button>{history.mutationReadiness?.retirement.reasonCode && <p>{text("Retirement prerequisite", "停止の前提")}: <code>{history.mutationReadiness.retirement.reasonCode}</code></p>}</>}
      </li>)}</ul>}
    </>}
    {draftForm&&<RuleDraftEditor form={draftForm} sourceTypes={sourceTypes} locale={locale} disabled={busy||uncertain||!canConfigure} canSave={!!draftBuild?.ok} errorField={draftBuild&&!draftBuild.ok?draftBuild.field:null} onChange={value=>{if(!lock.current&&!uncertain)setDraftForm(value);}} onSave={()=>void saveDraft()} onCancel={()=>{if(allowLeave()){setDraftForm(null);setError("");}}}/>}
    {choice && selected && <fieldset disabled={busy || uncertain}><legend>{choice.operation === "CONFIG_ACTIVATE" ? text("Confirm exact draft activation", "下書きの有効化を確認") : text("Confirm exact active version retirement", "有効な版の停止を確認")}</legend><p>{text("Selected version and hash", "選択した版とハッシュ")}: {selected.configVersion} / <code>{selected.contentHash}</code></p><p>{text("The server rechecks the current head, measured profile, current permission, source authority and retention. This confirmation cannot replace those proofs.", "サーバーは現在のhead、測定済みprofile、現在権限、情報源の認可、保持を再確認します。この確認操作で証明を代用することはできません。")}</p><button disabled={!envelope || !gate?.enabled || !canGovern} onClick={() => void confirm()}>{text("Confirm this version", "この版で確定")}</button><button onClick={() => setChoice(null)}>{text("Cancel", "取り消す")}</button></fieldset>}
    <p><a href="/rules" onClick={event => {if (!allowLeave(true)) event.preventDefault();}}>{text("Back to recommended responses", "推奨される対応へ戻る")}</a></p>
  </section>;
}
