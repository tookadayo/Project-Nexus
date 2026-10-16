"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { csrfHeaders } from "../auth/csrf-client";
import type { PersonalizationMutation, PreferenceSettings } from "../../../../packages/operations/src/alpha16-personalization";
type Template = {templateId: string; name: string; version: number; updatedAt: string; expiresAt: string};
interface Readiness {enabled: boolean; reasonCode: string | null; missingClasses: string[];}
interface PreferenceView {version: number; settings: PreferenceSettings; source: string; updatedAt: string | null; expiresAt: string | null; readiness: Readiness; observedAt: string; permissions: string[];}
interface TemplateView {items: Template[]; definition?: {id: string; name: string; body: unknown[]}; readiness: Readiness; status: string; observedAt: string; permissions: string[];}
type Form = {mode: "CREATE" | "EDIT" | "COPY" | "DRAFT" | "DELETE"; item?: Template};
type Problem = "PERMISSION" | "CONFLICT" | "RETENTION" | "COMMUNICATION" | "UNKNOWN" | "CANCELLED";
class ApiFailure extends Error {constructor(readonly problem: Problem) {super(problem);}}
const defaults: PreferenceSettings = {suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

export function PersonalizationWorkspace({kind, locale, guildId}: {kind: "templates" | "preferences"; locale: "ja" | "en"; guildId: string}) {
  const ja = locale === "ja", t = (en: string, jp: string) => ja ? jp : en;
  const [templates, setTemplates] = useState<TemplateView | null>(null), [preference, setPreference] = useState<PreferenceView | null>(null);
  const [settings, setSettings] = useState<PreferenceSettings>(defaults), [form, setForm] = useState<Form | null>(null);
  const [flows, setFlows] = useState<{id: string; name: string; draftRevision: number}[]>([]);
  const [name, setName] = useState(""), [sourceFlow, setSourceFlow] = useState(""), [sourceRevision, setSourceRevision] = useState(0), [replaceSource, setReplaceSource] = useState(false);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [problem, setProblem] = useState<Problem | null>(null);
  const [message, setMessage] = useState<string | null>(null), [draftLink, setDraftLink] = useState<string | null>(null);
  const [inspection, setInspection] = useState<TemplateView | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), mutationLock = useRef(false);
  const unresolved = useRef<{key: string; mutation: PersonalizationMutation} | null>(null);
  const [hasUnresolved, setHasUnresolved] = useState(false);
  const endpoint = `/${kind}/data`;
  const request = useCallback(async <T,>(url: string, input?: RequestInit): Promise<T> => {
    const response = await fetch(url, {credentials: "same-origin", cache: "no-store", ...input, headers: input?.headers ?? {"X-Nexus-Guild": guildId}});
    const value: unknown = await response.json();
    if (!response.ok || !record(value) || value.ok !== true) {
      const code = record(value) && record(value.error) && typeof value.error.code === "string" ? value.error.code : "UNAVAILABLE";
      throw new ApiFailure(response.status === 401 || response.status === 403 ? "PERMISSION" : code.includes("RESULT_UNKNOWN") ? "UNKNOWN" : code.includes("RETENTION") ? "RETENTION" : [409, 410, 412, 428].includes(response.status) ? "CONFLICT" : "COMMUNICATION");
    }
    return value.data as T;
  }, [guildId]);
  const load = useCallback(async () => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    const serial = ++generation.current; setLoading(true); setProblem(null); setInspection(null);
    try {
      const value = await request<PreferenceView | TemplateView>(endpoint, {signal: current.signal});
      if (serial !== generation.current || current.signal.aborted) return;
      if (kind === "preferences") {const next = value as PreferenceView; setPreference(next); setSettings({...next.settings});}
      else setTemplates(value as TemplateView);
    } catch (error) {if (serial === generation.current && !current.signal.aborted) {setProblem(error instanceof ApiFailure ? error.problem : "COMMUNICATION"); setPreference(null); setTemplates(null);}}
    finally {if (serial === generation.current && !current.signal.aborted) setLoading(false);}
  }, [endpoint, kind, request]);
  useEffect(() => {void load(); return () => {++generation.current; controller.current?.abort();};}, [load]);
  const ready = kind === "templates" ? templates?.readiness : preference?.readiness;
  const permissions = kind === "templates" ? templates?.permissions : preference?.permissions;
  const writable = ready?.enabled === true && (kind === "preferences" ? permissions?.includes("READ") : permissions?.includes("CONFIGURE")) && !pending && !loading && !hasUnresolved;
  const problems: Record<Problem, string> = {
    PERMISSION: t("Your current access could not be confirmed. Select the server again.", "現在の権限を確認できません。サーバーを選び直してください。"),
    CONFLICT: t("The saved version or request has changed or expired. Read the latest state before choosing again.", "保存版または要求が変更・失効しています。最新の状態を確認してください。"),
    RETENTION: t("The lifetime for this data purpose is not configured. Nothing was saved.", "この保存目的の保持期間が未設定のため、保存していません。"),
    COMMUNICATION: t("Current information could not be loaded. This is not a successful empty result.", "現在の情報を取得できませんでした。正常な空状態ではありません。"),
    UNKNOWN: t("The result is unconfirmed. Check this request's result without sending a new operation.", "結果を確認できません。新しい操作を送らず、この要求の結果を照合してください。"),
    CANCELLED: t("Loading was cancelled.", "読込を取り消しました。"),
  };
  const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(ja ? "ja-JP" : "en-US", {timeZone: "UTC"}) + " UTC" : t("Not saved", "未保存");
  const openForm = async (next: Form) => {
    setForm(next); setName(next.mode === "EDIT" ? next.item!.name : ""); setSourceFlow(""); setSourceRevision(0); setReplaceSource(false); setProblem(null); setMessage(null);
    if (next.mode === "CREATE" || next.mode === "EDIT") {
      try {setFlows((await request<{items: typeof flows}>(`${endpoint}?op=sources`)).items);}
      catch (error) {setProblem(error instanceof ApiFailure ? error.problem : "COMMUNICATION");}
    }
  };
  const mutate = async (mutation: PersonalizationMutation) => {
    if (mutationLock.current || !writable) return;
    mutationLock.current = true; setPending(true); setProblem(null); setMessage(null); setDraftLink(null);
    let sending = false;
    try {
      const headers = csrfHeaders({"X-Nexus-Guild": guildId, "Content-Type": "application/json"});
      const prepared = await request<{key: string; expiresAt: string}>(`${endpoint}?op=request-key`, {method: "POST", headers, body: JSON.stringify(mutation)});
      unresolved.current = {key: prepared.key, mutation}; setHasUnresolved(true);
      const actual = new Headers(headers); actual.set("Idempotency-Key", prepared.key);
      if ("expectedVersion" in mutation) actual.set("If-Match", `"${mutation.expectedVersion}"`);
      sending = true;
      const result = await request<{flowId?: string}>(endpoint, {method: "POST", headers: actual, body: JSON.stringify(mutation)});
      unresolved.current = null; setHasUnresolved(false); setForm(null);
      if (result.flowId) setDraftLink(`/automation?flow=${encodeURIComponent(result.flowId)}`);
      setMessage(mutation.operation === "TEMPLATE_DRAFT" ? t("A new draft was created. The live flow was not activated.", "新しい下書きを作成しました。稼働中のフローは有効化していません。") : t("Your changes were saved.", "変更を保存しました。"));
      await load();
    } catch (error) {
      const known = error instanceof ApiFailure;
      if (!sending || known && error.problem !== "UNKNOWN") {unresolved.current = null; setHasUnresolved(false);}
      setProblem(known ? error.problem : sending ? "UNKNOWN" : "COMMUNICATION");
    } finally {mutationLock.current = false; setPending(false);}
  };
  const reconcile = async () => {
    if (!unresolved.current || mutationLock.current) return;
    mutationLock.current = true; setPending(true);
    try {
      const result = await request<{state: string; result: {flowId?: string} | null}>(`${endpoint}?op=request&key=${encodeURIComponent(unresolved.current.key)}`);
      if (result.state === "COMPLETED") {
        unresolved.current = null; setHasUnresolved(false); setForm(null); setProblem(null);
        if (result.result?.flowId) setDraftLink(`/automation?flow=${encodeURIComponent(result.result.flowId)}`);
        setMessage(t("The saved result was confirmed.", "保存された結果を確認しました。")); await load();
      } else setProblem("UNKNOWN");
    } catch (error) {setProblem(error instanceof ApiFailure ? error.problem : "UNKNOWN");}
    finally {mutationLock.current = false; setPending(false);}
  };
  const submitTemplate = () => {
    if (!form) return;
    const item = form.item;
    if (form.mode === "DELETE") return void mutate({operation: "TEMPLATE_DELETE", templateId: item!.templateId, expectedVersion: item!.version});
    if (!name.trim()) return;
    if (form.mode === "CREATE" && sourceFlow && sourceRevision > 0) return void mutate({operation: "TEMPLATE_CREATE", name: name.trim(), sourceFlowId: sourceFlow, sourceRevision});
    if (form.mode === "EDIT") return void mutate({operation: "TEMPLATE_UPDATE", templateId: item!.templateId, expectedVersion: item!.version, name: name.trim(), ...(replaceSource && sourceFlow && sourceRevision > 0 ? {sourceFlowId: sourceFlow, sourceRevision} : {})});
    if (form.mode === "COPY") return void mutate({operation: "TEMPLATE_COPY", templateId: item!.templateId, expectedVersion: item!.version, name: name.trim()});
    if (form.mode === "DRAFT") return void mutate({operation: "TEMPLATE_DRAFT", templateId: item!.templateId, expectedVersion: item!.version, draftName: name.trim()});
  };
  const title = kind === "templates" ? t("Saved templates", "保存テンプレート") : t("My preferences", "自分の設定");
  return <section className="personalization-workspace" aria-labelledby="personalization-title">
    <header><div><p className="personalization-eyebrow">NEXUS</p><h1 id="personalization-title">{title}</h1><p>{kind === "templates" ? t("Keep a reusable snapshot of a saved flow version. Using it creates a new draft.", "保存済みフローの版を再利用できる形で残します。利用時には新しい下書きを作成します。") : t("These settings belong to you in the currently selected server. Administrators cannot overwrite another person's preferences here.", "選択中のサーバーにおける自分の設定です。ここから管理者が他人の設定を上書きすることはできません。")}</p></div><a href="/dashboard">{t("Back to dashboard", "ダッシュボードへ戻る")}</a></header>
    {ready && !ready.enabled && <aside className="personalization-policy" role="status"><strong>{t("Saving is not active", "保存は未有効化です")}</strong><p>{t("This data purpose needs its own configured lifetime. The 48-hour evidence and 14-day recommendation limits do not define template or personal-setting lifetimes. Existing readable data remains visible.", "この保存目的に対応した保持期間が必要です。根拠の48時間・提案の14日は、テンプレートや本人設定の期間を定めるものではありません。閲覧できる既存データは表示します。")}</p></aside>}
    {problem && <div role="alert" className="personalization-problem"><p>{problems[problem]}</p>{hasUnresolved ? <button type="button" disabled={pending} onClick={() => void reconcile()}>{t("Check this request's result", "この要求の結果を照合")}</button> : <button type="button" disabled={loading || pending} onClick={() => void load()}>{t("Reload", "読み直す")}</button>}<a href="/servers">{t("Select server", "サーバーを選ぶ")}</a></div>}
    {message && <p role="status">{message}</p>}{draftLink && <a href={draftLink}>{t("Open the new draft", "新しい下書きを開く")}</a>}
    {loading && <p role="status">{t("Loading current information…", "現在の情報を読み込んでいます…")}<button type="button" onClick={() => {++generation.current; controller.current?.abort(); setLoading(false); setProblem("CANCELLED");}}>{t("Cancel loading", "読込を取り消す")}</button></p>}
    {kind === "preferences" && preference && <div className="personalization-settings">
      <label>{t("Recommended responses in my list", "自分の一覧の推奨される対応")}<select value={settings.suggestionDisplay} disabled={!writable} onChange={(event) => setSettings({...settings, suggestionDisplay: event.target.value as "SHOW" | "HIDE"})}><option value="SHOW">{t("Show", "表示する")}</option><option value="HIDE">{t("Hide for me", "自分だけ非表示")}</option></select></label>
      <label>{t("NEXUS personal notifications", "NEXUSの自分宛て通知")}<select value={settings.personalNotifications} disabled={!writable} onChange={(event) => setSettings({...settings, personalNotifications: event.target.value as "UNCHANGED" | "MUTED"})}><option value="UNCHANGED">{t("Keep current choices", "現在の許可設定を維持")}</option><option value="MUTED">{t("Mute personal notifications", "自分宛て通知を停止")}</option></select></label>
      <p>{t("This does not opt you into a new message or DM, change a shared recommendation, or change Discord channel notifications.", "新しい通知やDMを許可したり、共有の対応案やDiscordのチャンネル通知を変更したりする設定ではありません。")}</p>
      <div className="personalization-buttons"><button type="button" disabled={!writable} onClick={() => void mutate({operation: "PREFERENCE_SAVE", expectedVersion: preference.version, settings})}>{pending ? t("Saving…", "保存中…") : t("Save my preferences", "自分の設定を保存")}</button><button type="button" disabled={!writable} onClick={() => void mutate({operation: "PREFERENCE_RESET", expectedVersion: preference.version})}>{t("Reset my preferences", "自分の設定を初期化")}</button><button type="button" disabled={pending} onClick={() => setSettings({...preference.settings})}>{t("Discard edits", "編集を取り消す")}</button></div>
      <p className="personalization-meta">{t("Last saved", "最終保存")}: {date(preference.updatedAt)} · {t("Version", "版")}: {preference.version}</p>
    </div>}
    {kind === "templates" && templates && <>
      <div className="personalization-toolbar"><h2>{t("Templates", "テンプレート")}</h2><button type="button" disabled={!writable} onClick={() => void openForm({mode: "CREATE"})}>{t("Create from a saved flow", "保存済みフローから作る")}</button></div>
      {!loading && templates.items.length === 0 && <div className="personalization-empty"><h2>{t("No saved templates", "保存テンプレートはありません")}</h2><p>{t("Save a flow version in Automation before creating a reusable template.", "再利用するテンプレートを作る前に、オートメーションでフローの版を保存してください。")}</p><a href="/automation">{t("Open Automation", "オートメーションを開く")}</a></div>}
      {templates.items.map((item) => <article className="personalization-template" key={item.templateId}><div><h3>{item.name}</h3><p>{t("Version", "版")} {item.version} · {date(item.updatedAt)}</p></div><div className="personalization-buttons"><button type="button" disabled={pending || loading} onClick={() => {void request<TemplateView>(`${endpoint}?id=${encodeURIComponent(item.templateId)}`).then(setInspection).catch((error) => setProblem(error instanceof ApiFailure ? error.problem : "COMMUNICATION"));}}>{t("View", "閲覧")}</button>{([ ["EDIT", "Edit", "編集"], ["COPY", "Duplicate", "複製"], ["DRAFT", "Create a new draft", "新しい下書きを作る"], ["DELETE", "Delete", "削除"] ] as const).map(([mode, en, jp]) => <button type="button" key={mode} disabled={!writable} onClick={() => void openForm({mode, item})}>{t(en, jp)}</button>)}</div></article>)}
      {inspection && <section className="personalization-inspection"><h2>{inspection.items[0]?.name}</h2><p>{t("Saved block count", "保存されたブロック数")}: {inspection.definition?.body.length ?? 0}</p><p>{t("This snapshot is not a live activation.", "この保存版を閲覧しても、フローは有効化されません。")}</p><button type="button" onClick={() => setInspection(null)}>{t("Back to templates", "一覧へ戻る")}</button></section>}
    </>}
    {form && <section className="personalization-form" aria-labelledby="template-edit-title"><h2 id="template-edit-title">{({CREATE: t("Create template", "テンプレート作成"), EDIT: t("Edit template", "テンプレート編集"), COPY: t("Duplicate template", "テンプレート複製"), DRAFT: t("Create a new draft", "新しい下書きの作成"), DELETE: t("Delete template", "テンプレート削除")})[form.mode]}</h2>
      {form.mode === "DELETE" ? <p>{t("Delete this template and its saved definitions. Flows already created from it keep their own revisions.", "このテンプレートと保存定義を削除します。すでに作成したフローの版は、それぞれのフローに残ります。")}</p> : <label>{form.mode === "DRAFT" ? t("New draft name", "新しい下書きの名前") : t("Template name", "テンプレート名")}<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={pending} placeholder={t("Enter a name", "名前を入力")} /></label>}
      {form.mode === "EDIT" && <label className="personalization-check"><input type="checkbox" checked={replaceSource} disabled={pending} onChange={(event) => setReplaceSource(event.target.checked)} />{t("Replace the snapshot from a saved flow version", "保存済みフローの版から定義を差し替える")}</label>}
      {(form.mode === "CREATE" || form.mode === "EDIT" && replaceSource) && <div className="personalization-source"><label>{t("Source flow", "元のフロー")}<select value={sourceFlow} disabled={pending} onChange={(event) => {setSourceFlow(event.target.value); setSourceRevision(flows.find((flow) => flow.id === event.target.value)?.draftRevision ?? 0);}}><option value="">{t("Choose a saved flow", "保存済みフローを選ぶ")}</option>{flows.map((flow) => <option value={flow.id} key={flow.id}>{flow.name}</option>)}</select></label><label>{t("Saved revision", "保存済みの版")}<input type="number" min={1} step={1} value={sourceRevision || ""} disabled={pending} onChange={(event) => setSourceRevision(Number(event.target.value))} /></label></div>}
      <p>{t("The selected definition is copied to a separate saved version. Live flows, running jobs and external services are not changed.", "選択した定義を別の保存版として複製します。稼働中のフローや実行、外部サービスは変更しません。")}</p>
      <div className="personalization-buttons"><button type="button" disabled={pending} onClick={() => setForm(null)}>{t("Cancel", "取り消す")}</button><button type="button" disabled={!writable || form.mode !== "DELETE" && (!name.trim() || (form.mode === "CREATE" || form.mode === "EDIT" && replaceSource) && (!sourceFlow || !Number.isInteger(sourceRevision) || sourceRevision < 1))} onClick={submitTemplate}>{pending ? t("Saving…", "保存中…") : form.mode === "DELETE" ? t("Delete this template", "このテンプレートを削除") : form.mode === "DRAFT" ? t("Create draft only", "下書きだけ作成") : t("Save template", "テンプレートを保存")}</button></div>
    </section>}
  </section>;
}
