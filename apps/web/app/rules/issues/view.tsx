"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {csrfHeaders} from "../../auth/csrf-client";
import {useUnsavedChanges} from "../../navigation-safety";
import {safeError} from "../../safe-error";
import type {RuleIssueEntry, RuleIssueList, IssueTarget} from "./model";
type Form = {id: string; expectedVersion: number; candidate: string; experimentIds: string[]; playbookIds: string[]; experimentsComplete: boolean; playbooksComplete: boolean; validForSeconds: string};
const empty = (): Form => ({id: "", expectedVersion: 0, candidate: "", experimentIds: [], playbookIds: [], experimentsComplete: false, playbooksComplete: false, validForSeconds: ""});
const candidateKey = (issueCode: string, target: IssueTarget) => JSON.stringify([issueCode, target.targetType, target.targetId, target.liveVersion]);
export function RuleIssuesWorkspace({guildId, locale}: {guildId: string; locale: "ja" | "en"}) {
  const ja = locale === "ja", text = (en: string, japanese: string) => ja ? japanese : en;
  const [data, setData] = useState<RuleIssueList | null>(null), [permissions, setPermissions] = useState<string[]>([]), [form, setForm] = useState<Form>(empty), [baseline, setBaseline] = useState(() => JSON.stringify(empty()));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [uncertain, setUncertain] = useState(false), [clock, setClock] = useState(Date.now);
  const inFlight = useRef(false), reader = useRef<AbortController | null>(null), generation = useRef(0), allowLeave = useUnsavedChanges(JSON.stringify(form) !== baseline || busy, locale);
  const canConfigure = permissions.includes("CONFIGURE"), candidate = data?.baseTargets.find(c => candidateKey(c.issueCode, c.baseTarget) === form.candidate);
  const duration = Number(form.validForSeconds), validDuration = form.validForSeconds !== "" && Number.isSafeInteger(duration) && duration >= 1 && duration <= 172800;
  const reset = (value: Form) => {setForm(value); setBaseline(JSON.stringify(value)); setError("");};
  const read = useCallback(async () => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); setMessage(""); setData(null);
    const controller = new AbortController(), token = ++generation.current; reader.current = controller;
    try {
      const response = await fetch("/api/rule-issues", {headers: {"X-Nexus-Guild": guildId}, signal: controller.signal, cache: "no-store"}), body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "ISSUE_REGISTRY_UNAVAILABLE");
      if (token === generation.current) {setData(body.data as RuleIssueList); setPermissions(body.permissions ?? []); setUncertain(false); setForm(empty()); setBaseline(JSON.stringify(empty()));}
    } catch (cause) {if (token === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ISSUE_REGISTRY_UNAVAILABLE");}
    finally {if (token === generation.current) {inFlight.current = false; reader.current = null; setBusy(false);}}
  }, [guildId]);
  useEffect(() => {void read(); return () => {generation.current++; reader.current?.abort(); reader.current = null; inFlight.current = false;};}, [read]);
  useEffect(() => {const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer);}, []);
  function edit(item: RuleIssueEntry) {if (!allowLeave()) return; reset({id: item.id, expectedVersion: item.version, candidate: candidateKey(item.issueCode, item.baseTarget), experimentIds: [...item.experimentIds], playbookIds: [...item.playbookIds], experimentsComplete: item.experimentsComplete, playbooksComplete: item.playbooksComplete, validForSeconds: ""}); setMessage("");}
  function create() {if (!allowLeave()) return; reset({...empty(), id: crypto.randomUUID()}); setMessage("");}
  function toggle(field: "experimentIds" | "playbookIds", id: string, checked: boolean) {setForm(previous => ({...previous, [field]: checked ? [...new Set([...previous[field], id])] : previous[field].filter(value => value !== id)}));}
  const missingReferences = (field: "experimentIds" | "playbookIds") => data && form[field].filter(id => !(field === "experimentIds" ? data.inventory.experiments : data.inventory.playbooks).some(item => item.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={event => toggle(field, id, event.target.checked)}/>{id} · {text("No longer in the current inventory; remove this reference before saving.", "現在の一覧にありません。保存するには、この参照を外してください。")}</label>);
  async function mutate(operation: "UPSERT" | "DELETE") {
    if (inFlight.current || !canConfigure || !form.id || uncertain) return;
    if (operation === "UPSERT" && (!data || !candidate || !validDuration)) return;
    if (operation === "DELETE" && !window.confirm(text("Remove this mapping? Experiments and playbooks are not deleted.", "この対応表を削除しますか？実験やPlaybook自体は削除しません。"))) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const input = operation === "DELETE" ? {operation, id: form.id, expectedVersion: form.expectedVersion} : {operation, id: form.id, expectedVersion: form.expectedVersion, issueCode: candidate!.issueCode, baseTarget: candidate!.baseTarget, experimentIds: form.experimentIds, playbookIds: form.playbookIds, experimentsComplete: form.experimentsComplete, playbooksComplete: form.playbooksComplete, validForSeconds: duration, inventoryHashes: data!.inventoryHashes};
    try {
      const response = await fetch("/api/rule-issues", {method: "POST", headers: csrfHeaders({"Content-Type": "application/json", "X-Nexus-Guild": guildId, "If-Match": `"${form.expectedVersion}"`}), body: JSON.stringify(input)}), body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "ISSUE_REGISTRY_UNAVAILABLE");
      reset(empty()); setData(null); setMessage(operation === "DELETE" ? text("Removed. Refresh the registry to see its current state.", "削除しました。対応表を再取得して現在の状態を確認してください。") : text("Saved. Refresh the registry to see its current state.", "保存しました。対応表を再取得して現在の状態を確認してください。"));
    } catch (cause) {setError(cause instanceof Error ? cause.message : "ISSUE_REGISTRY_UNAVAILABLE"); setUncertain(true);}
    finally {inFlight.current = false; setBusy(false);}
  }
  function cancelRead() {generation.current++; reader.current?.abort(); reader.current = null; inFlight.current = false; setBusy(false); setData(null); setMessage(text("Reading canceled.", "取得を取り消しました。"));}
  return <section aria-busy={busy}><h1>{text("Issue mappings and coverage", "課題と対応施策の対応表")}</h1>
    <p>{text("Explicitly relate a saved base issue and target to experiment and playbook definitions. This config does not run actions or establish a causal effect.", "保存済みの元の課題・対象と、実験やPlaybookの定義を明示的に対応付けます。操作の実行や、因果効果の保証は行いません。")}</p>
    <button disabled={busy} onClick={() => {if (allowLeave()) void read();}}>{text("Refresh saved registry", "保存済み対応表を再取得")}</button><button disabled={busy || !canConfigure || uncertain || !data} onClick={create}>{text("New mapping", "対応表を作成")}</button>
    {reader.current && busy && <button onClick={cancelRead}>{text("Cancel reading", "取得を取り消す")}</button>}
    {busy && <p role="status">{text("Working…", "処理中…")}</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{safeError(error, locale)} <code>{/^[A-Z][A-Z0-9_]{0,79}$/.test(error) ? error : "ISSUE_REGISTRY_UNAVAILABLE"}</code></p>}
    {uncertain && <p role="alert">{text("The result may be unknown. Do not repeat the change automatically. Refresh and reconcile this mapping before another change.", "結果が不明な可能性があります。変更を自動で繰り返さず、対応表を再取得して照合してから次の変更を行ってください。")}</p>}
    {error === "ISSUE_REGISTRY_INVENTORY_CHANGED" && <p role="status">{text("The experiment or playbook inventory changed after it was displayed. Refresh and review the current inventory before declaring completeness.", "表示後に実験またはPlaybookの一覧が変わりました。再取得して現在の一覧を確認してから、網羅を明示してください。")}</p>}
    {data && <><p>{text("Read at", "取得時刻")}: <time>{data.observedAt}</time></p>{!canConfigure && <p>{text("You can read this registry. Editing requires the existing Configure permission and feature access.", "この対応表は閲覧できます。編集には既存の設定権限と機能の利用条件が必要です。")}</p>}
      {data.items.length === 0 ? <p>{text("No mapping is saved. This does not mean no experiment or playbook covers an issue.", "対応表は保存されていません。課題に対応する実験やPlaybookがないという意味ではありません。")}</p> : <ul>{data.items.map(item => <li key={item.id}><strong>{item.issueCode}</strong> · {item.baseTarget.targetType} / {item.baseTarget.targetId} / {item.baseTarget.liveVersion ?? text("Unknown version", "版は未確認")} · {text("Version", "版")} {item.version}<br/>
        {text("Valid until", "有効期限")}: {item.expiresAt} · {Date.parse(item.expiresAt) <= clock ? text("Expired; no absence claim is usable", "期限切れ。対応なしとは判断できません") : text("Current config; native census is rechecked separately", "有効な設定。元の一覧との一致は別に再確認します")}<br/>
        {text("Declared complete inventory", "一覧の網羅を明示")}: {text("Experiments", "実験")} {item.experimentsComplete ? text("Yes", "あり") : text("Not declared", "未宣言")} / Playbook {item.playbooksComplete ? text("Yes", "あり") : text("Not declared", "未宣言")}
        <button disabled={busy || !canConfigure || uncertain} onClick={() => edit(item)}>{text("Edit mapping", "対応表を編集")}</button></li>)}</ul>}
    </>}
    {form.id && data && <form onSubmit={event => {event.preventDefault(); void mutate("UPSERT");}}><fieldset disabled={busy || !canConfigure || uncertain}><legend>{form.expectedVersion === 0 ? text("New mapping", "新しい対応表") : text("Edit mapping", "対応表を編集")}</legend>
      <label>{text("Saved issue and target candidate", "保存済みの課題と対象の候補")}<select required value={form.candidate} onChange={event => setForm(previous => ({...previous, candidate: event.target.value}))}><option value="">{text("Choose a saved candidate", "保存済み候補を選択")}</option>{data.baseTargets.map(c => <option key={candidateKey(c.issueCode, c.baseTarget)} value={candidateKey(c.issueCode, c.baseTarget)}>{c.issueCode} · {c.baseTarget.targetType} / {c.baseTarget.targetId} / {c.baseTarget.liveVersion ?? text("Unknown version", "版は未確認")}</option>)}</select></label>
      {!candidate && <p>{text("A currently retained saved candidate is required. Missing or expired candidates cannot be invented here.", "現在保持されている保存済み候補が必要です。不足・期限切れの候補をこの画面で補完することはできません。")}</p>}
      <fieldset><legend>{text("Experiment definitions (up to 100)", "実験の定義（最大100件）")}</legend>{data.inventory.experiments.map(item => <label key={item.id}><input type="checkbox" checked={form.experimentIds.includes(item.id)} disabled={!form.experimentIds.includes(item.id) && form.experimentIds.length >= 100} onChange={event => toggle("experimentIds", item.id, event.target.checked)}/>{item.id} · {item.version} · {item.state}</label>)}{missingReferences("experimentIds")}{data.inventory.experiments.length === 0 && <p>{text("The current inventory is empty; completeness still requires an explicit declaration.", "現在の一覧は空です。網羅の判断には明示が必要です。")}</p>}<label><input type="checkbox" checked={form.experimentsComplete} onChange={event => setForm(previous => ({...previous, experimentsComplete: event.target.checked}))}/>{text("I explicitly declare that this current inventory is complete for the selected issue and target.", "選択した課題・対象について、現在の一覧を網羅したことを明示します。")}</label></fieldset>
      <fieldset><legend>{text("Playbooks (up to 100)", "Playbook（最大100件）")}</legend>{data.inventory.playbooks.map(item => <label key={item.id}><input type="checkbox" checked={form.playbookIds.includes(item.id)} disabled={!form.playbookIds.includes(item.id) && form.playbookIds.length >= 100} onChange={event => toggle("playbookIds", item.id, event.target.checked)}/>{item.id} · {item.version} · {item.state}</label>)}{missingReferences("playbookIds")}{data.inventory.playbooks.length === 0 && <p>{text("The current inventory is empty; absence is not assumed.", "現在の一覧は空です。対応なしとは推定しません。")}</p>}<label><input type="checkbox" checked={form.playbooksComplete} onChange={event => setForm(previous => ({...previous, playbooksComplete: event.target.checked}))}/>{text("I explicitly declare that this current inventory is complete for the selected issue and target.", "選択した課題・対象について、現在の一覧を網羅したことを明示します。")}</label></fieldset>
      <p>{text("New definitions or changes in version/state invalidate a previous completeness claim until it is reconciled.", "定義の追加や版・状態の変更があれば、以前の網羅宣言からは判断できず、再照合が必要になります。")}</p>
      <label>{text("Validity in seconds (1–172800; at most 48 hours)", "有効期間・秒（1〜172800、最大48時間）")}<input required inputMode="numeric" type="number" min="1" max="172800" step="1" value={form.validForSeconds} onChange={event => setForm(previous => ({...previous, validForSeconds: event.target.value}))}/></label>
      <button type="submit" disabled={!candidate || !validDuration}>{text("Save mapping only", "対応表だけを保存")}</button>{form.expectedVersion > 0 && <button type="button" onClick={() => void mutate("DELETE")}>{text("Delete mapping only", "対応表だけを削除")}</button>}<button type="button" onClick={() => {if (allowLeave()) reset(empty());}}>{text("Cancel editing", "編集を取り消す")}</button>
    </fieldset></form>}
    <p><a href="/rules" onClick={event => {if (!allowLeave(true)) event.preventDefault();}}>{text("Back to rule suggestions", "ルールからの提案へ戻る")}</a></p>
  </section>;
}
