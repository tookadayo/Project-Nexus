"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {HealthOverview, HealthValidity, LegacyLifecyclePreview} from "../../../../packages/presentation/src/health-workspace";
import {safeError} from "../safe-error";
import type {LifecyclePreviewReplay} from "../../../../packages/presentation/src/lifecycle-preview";
import {LifecyclePreviewResults} from "./lifecycle-preview-results";

type Tab = "readiness" | "data" | "permission" | "preview";
const validityNames: Record<HealthValidity, [string, string]> = {
  CURRENT: ["Current observation", "有効な観測"], EXPIRED: ["Observation expired", "観測の有効期限切れ"],
  UNOBSERVED: ["Not observed", "未観測"], FAILED: ["Latest observation failed", "直近の観測に失敗"], UNKNOWN: ["Unknown", "未確認"],
};
const reasonNames: Record<string, [string, string]> = {
  APPLICABLE_PERMISSION_REQUIREMENT_REGISTRY_REQUIRED: ["The full list of permissions required by enabled features is not yet verified.", "有効な機能に必要な権限の一覧は、まだ確認できていません。"],
  SETTINGS_NOT_SAVED: ["Server settings have not been saved.", "サーバー設定がまだ保存されていません。"],
  ACTIVATION_NOT_CONFIGURED: ["The first-success definition has not been configured.", "初回成功の定義がまだ設定されていません。"],
  GATEWAY_NOT_CURRENTLY_CONNECTED: ["A current Gateway connection is not confirmed.", "現在の Gateway 接続を確認できていません。"],
  PERMISSION_OBSERVATION_NOT_CURRENT: ["The saved permission observation is not currently valid.", "保存済みの権限観測は、現在有効な確認結果として利用できません。"],
  OPERATIONAL_CONFIG_NOT_ACTIVATED: ["Operational rule generation is not enabled.", "運用上のルール生成は有効になっていません。"],
};
const featureNames: Record<string, [string, string]> = {
  coverage_health: ["Observation coverage and connection health", "観測範囲と接続状態"],
  interventions: ["Community actions", "コミュニティへの対応"], experiments: ["Improvement experiments", "改善テスト"],
  custom_activation: ["Custom first-success definition", "初回成功の独自の定義"], improvement_tracking: ["Improvement tracking", "改善の追跡"],
};
export function HealthWorkspace({guildId, locale}: {guildId: string; locale: "ja" | "en"}) {
  const ja = locale === "ja", [tab, setTab] = useState<Tab>("readiness"), [data, setData] = useState<HealthOverview | null>(null);
  const [preview, setPreview] = useState<LegacyLifecyclePreview | null>(null), [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [canceled, setCanceled] = useState(false), [clock, setClock] = useState(() => Date.now());
  const inFlight = useRef(false), current = useRef<AbortController | null>(null), generation = useRef(0);
  const text = (en: string, japanese: string) => ja ? japanese : en;
  const unknown = text("Unknown / not observed", "未確認・未観測");
  const stamp = (value: string | null) => value ?? unknown;
  const state = (value: HealthValidity) => validityNames[value][ja ? 1 : 0];
  const reasonText = (value: string) => reasonNames[value]?.[ja ? 1 : 0] ?? text("This prerequisite is unverified.", "この前提条件は未確認です。");
  const currentValidity = (validity: HealthValidity, expiresAt: string | null): HealthValidity => (validity === "CURRENT" || validity === "FAILED") && expiresAt !== null && Date.parse(expiresAt) <= clock ? "EXPIRED" : validity;
  const permissionValidity = data ? currentValidity(data.permission.validity, data.permission.expiresAt) : "UNOBSERVED";
  const fetchRead = useCallback(async <T,>(path: string, signal: AbortSignal): Promise<T> => {
    const response = await fetch(`/api/health/${path}${path.includes("?") ? "&" : "?"}guild=${encodeURIComponent(guildId)}`, {headers: {"X-Nexus-Guild": guildId}, signal, cache: "no-store"});
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "HEALTH_UNAVAILABLE");
    return body as T;
  }, [guildId]);
  const read = useCallback(async (kind: "overview" | "preview", revisionId?: string, replay?: LifecyclePreviewReplay) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setCanceled(false);
    // No stale response is shown as a fresh successful read after any failure.
    if (kind === "overview") {setData(null); setPreview(null);} else setPreview(null);
    const controller = new AbortController(), token = ++generation.current; current.current = controller;
    try {
      if (kind === "overview") {
        const result = await fetchRead<HealthOverview>("overview", controller.signal);
        if (token === generation.current) {setData(result); setRevision(result.lifecycleRevisions[0]?.id ?? "");}
      } else {
        const query = replay ? `&asOf=${encodeURIComponent(replay.asOf)}&sourceHash=${encodeURIComponent(replay.sourceHash)}` : "";
        const result = await fetchRead<LegacyLifecyclePreview>(`lifecycle-preview?revision=${encodeURIComponent(revisionId ?? "")}${query}`, controller.signal);
        if (token === generation.current) setPreview(result);
      }
    } catch (reason) {
      if (token === generation.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "HEALTH_UNAVAILABLE");
    } finally {
      if (token === generation.current) {inFlight.current = false; current.current = null; setBusy(false);}
    }
  }, [fetchRead]);
  useEffect(() => {
    void read("overview");
    return () => {generation.current++; current.current?.abort(); current.current = null; inFlight.current = false;};
  }, [read]);
  useEffect(() => {const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer);}, []);
  function cancel() {generation.current++; current.current?.abort(); current.current = null; inFlight.current = false; setBusy(false); setCanceled(true); setData(null); setPreview(null);}
  return <section aria-busy={busy}>
    <h1>{text("Readiness and health", "準備状況と接続・計測の確認")}</h1>
    <p>{text("Read saved observations and current access. Refresh reads the latest saved state; it does not collect new data or change permissions.", "保存済みの観測と現在の閲覧権限を確認します。再取得は最新の保存状態を読みます。データの追加収集や権限変更は行いません。")}</p>
    <nav aria-label={text("Health details", "確認内容")}>
      {([['readiness', 'Readiness', '準備状況'], ['data', 'Data health', '計測の状態'], ['permission', 'Permission health', '権限の状態'], ['preview', 'Lifecycle preview', '設定と実行の事前確認']] as const).map(([key, en, japanese]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{text(en, japanese)}</button>)}
    </nav>
    <button disabled={busy} onClick={() => void read("overview")}>{text("Refresh saved observations", "保存済み状態を再取得")}</button>
    {busy && <><p role="status">{text("Loading…", "確認中…")}</p><button onClick={cancel}>{text("Cancel reading", "取得を取り消す")}</button></>}
    {canceled && <p role="status">{text("Reading canceled. No settings were changed.", "取得を取り消しました。設定は変更されていません。")}</p>}
    {error && <p role="alert">{safeError(error, locale)} <code>{/^[A-Z][A-Z0-9_]{0,79}$/.test(error) ? error : "HEALTH_UNAVAILABLE"}</code></p>}
    {data && <><p>{text("Read at", "取得時刻")}: <time>{data.readAt}</time></p>
      {tab === "readiness" && <section><h2>{text("Readiness", "準備状況")}</h2>
        <p>{data.readiness.state === "NEEDS_ATTENTION" ? text("Some prerequisites need attention.", "確認が必要な前提条件があります。") : text("Some prerequisites remain unverified.", "未確認の前提条件があります。")}</p>
        <dl><dt>{text("Settings revision", "設定の版")}</dt><dd>{data.readiness.settingsRevision}</dd><dt>{text("Onboarding mode", "初期案内の方式")}</dt><dd>{data.readiness.onboardingMode}</dd>
          <dt>{text("Activation definition", "初回成功の定義")}</dt><dd>{data.readiness.activationRevision?.version ?? text("Not configured", "未設定")}</dd><dt>{text("Onboarding definition", "初期案内の設定")}</dt><dd>{data.readiness.onboardingRevision?.version ?? text("No published revision", "公開済みの版なし")}</dd></dl>
        <p>{text("A successful viewer permission check does not establish that every Bot operation is permitted.", "閲覧者の権限確認に成功しても、Bot のすべての操作が許可されたとは限りません。")}</p>
        <ul>{data.readiness.reasonCodes.map(reason => <li key={reason}>{reasonText(reason)}</li>)}</ul>
        <h3>{text("Available features in this plan", "現在のプランで利用できる機能")}: {data.plan.key}</h3>
        <ul>{data.plan.features.map(feature => <li key={feature.key}>{featureNames[feature.key]?.[ja ? 1 : 0] ?? feature.key}: {feature.allowed ? text("Available", "利用可能") : text("Not included", "対象外")}</li>)}</ul>
        <h3>{text("Rule evaluation", "ルール評価")}</h3><p>{text("Operational generation is disabled. Reading existing suggestions does not require a separate display approval.", "運用上の新規生成は無効です。保存済み提案の閲覧に別の表示承認は不要です。")}</p>
        <ul>{data.rules.reasonCodes.map(reason => <li key={reason}>{reasonText(reason)}</li>)}</ul><a href="/rules">{text("Open saved rule suggestions", "保存済みの提案を開く")}</a>
      </section>}
      {tab === "data" && <section><h2>{text("Data health", "計測の状態")}</h2>
        <dl><dt>{text("Gateway connection at the last read", "取得時点の Gateway 接続")}</dt><dd>{data.data.gateway} · {state(currentValidity(data.data.gatewayValidity, data.data.gatewayExpiresAt))}</dd><dt>{text("Gateway observed / valid until", "Gateway の観測時刻・有効期限")}</dt><dd>{stamp(data.data.gatewayObservedAt)} / {stamp(data.data.gatewayExpiresAt)}</dd>
          <dt>{text("Last successful capability refresh", "機能確認の最終成功")}</dt><dd>{stamp(data.data.lastSuccessfulRefresh)}</dd><dt>{text("Last failed capability refresh", "機能確認の最終失敗")}</dt><dd>{stamp(data.data.lastRefreshFailure)}</dd>
          <dt>{text("Coverage at the original observation", "元の観測における観測範囲")}</dt><dd>{data.data.coverage.ratio === null ? unknown : data.data.coverage.ratio} · {data.data.coverage.state} · {state(currentValidity(data.data.coverage.validity, data.permission.expiresAt))}<br/>{stamp(data.data.coverage.observedAt)}</dd></dl>
        <h3>{text("Observed event access", "イベントの観測可否")}</h3><ul>{Object.entries(data.data.intents).map(([key, value]) => <li key={key}>{key}: {value} · {text("saved observation", "保存済みの観測")}</li>)}</ul>
        <h3>{text("Source health observations", "データソースの観測記録")}</h3>
        {data.data.sourceSchema === "UNAVAILABLE" ? <p role="status">{text("Source health storage is unavailable. Its state is unknown.", "データソースの観測記録を利用できません。状態は未確認です。")}</p> : data.data.sources.length === 0 ? <p>{text("No source health observations are saved. This does not establish that sources are healthy or have never succeeded.", "保存済みのソース観測はありません。正常とも、成功履歴がないとも判断できません。")}</p> : <ul>{data.data.sources.map(source => {
          const validity = currentValidity(source.validity, source.expiresAt), available = source.evidenceAvailable && (validity === "CURRENT" || validity === "FAILED");
          return <li key={source.observationId}>
          <strong>{source.sourceType}</strong> · {state(validity)} · {available ? source.quality : unknown} · {text("Available health evidence", "利用できる状態の確認結果")}: {available ? source.state : unknown}<br/>
          {text("Target / version", "対象・版")}: {source.targetType} / {source.targetId} / {source.liveVersion}<br/>
          {text("Observed / expires", "観測時刻・有効期限")}: {source.observedAt} / {source.expiresAt}<br/>
          {text("Last successful ingest", "最終取り込み成功")}: {available ? stamp(source.lastSuccessfulIngestAt) : unknown} · {text("Never succeeded", "成功履歴なし")}: {!available || source.neverSucceeded === null ? unknown : source.neverSucceeded ? text("Confirmed", "確認済み") : text("No", "該当しない")}<br/>
          {text("Coverage", "観測範囲")}: {available ? source.coverage ?? unknown : unknown}</li>;
        })}</ul>}
        {data.data.truncated && <p>{text("The first 100 source targets are shown. Other targets are unverified on this page.", "先頭 100 対象を表示しています。それ以外はこの画面では未確認です。")}</p>}
        <details><summary>{text("Source compatibility limits", "データソースの接続状況")}</summary><ul>{data.rules.sources.map(source => <li key={source.sourceType}>{source.sourceType}: {source.compatibility} <code>{source.reason}</code></li>)}</ul></details>
      </section>}
      {tab === "permission" && <section><h2>{text("Permission health", "権限の状態")}</h2><p>{state(permissionValidity)} · {text("Observed / valid until", "観測時刻・有効期限")}: {stamp(data.permission.observedAt)} / {stamp(data.permission.expiresAt)}</p>
        <p>{text("The saved Bot capabilities are observations, not permission grants or a complete requirement checklist.", "保存済みの Bot 機能は観測結果です。権限の付与や、すべての必要権限の充足を示すものではありません。")}</p>
        <table><thead><tr><th>{text("Bot capability", "Bot 機能")}</th><th>{text("Observed value", "観測時の値")}</th><th>{text("Currently usable evidence", "有効な確認結果")}</th></tr></thead><tbody>{data.permission.botPermissions.map(item => <tr key={item.key}><th>{item.key}</th><td>{item.observed === null ? unknown : item.observed ? text("Allowed", "許可あり") : text("Missing", "許可なし")}</td><td>{permissionValidity !== "CURRENT" || item.effective === null ? unknown : item.effective ? text("Allowed", "許可あり") : text("Missing", "許可なし")}</td></tr>)}</tbody></table>
        <ul>{data.permission.capabilities.map(item => <li key={item.key}>{item.key}: {item.observed} → {permissionValidity === "CURRENT" ? item.effective : "UNKNOWN"}</li>)}</ul>
        <p>{text("Your NEXUS access at this read", "取得時点の NEXUS 閲覧者権限")}: {data.permission.nexusPermissions.join(", ")}<br/>{text("Checked / valid until", "確認時刻・有効期限")}: {data.permission.viewerCheckedAt} / {data.permission.viewerExpiresAt}<br/>{Date.parse(data.permission.viewerExpiresAt) <= clock && text("Viewer permission evidence expired. Refresh before relying on it.", "閲覧者の権限確認は期限切れです。再取得して確認してください。")}</p>
        <p>{reasonText(data.permission.requirementRegistry.reasonCode)}</p><a href="/setup">{text("Open setup and connection settings", "初期設定と接続の確認へ")}</a>
      </section>}
      {tab === "preview" && <section><h2>{text("Lifecycle configuration and execution preview", "Lifecycle 設定と実行の事前確認")}</h2>
        <p>{text("Compare a saved revision and evaluate supported lifecycle conditions using bounded, authorized saved observations. A live Run is not started.", "保存済みの版を比較し、対応する Lifecycle 条件を、権限のある保存済み観測から件数を制限して評価します。実際の Run は開始しません。")}</p>
        {data.lifecycleRevisions.length === 0 ? <p>{text("No lifecycle configuration revisions are saved.", "保存済みの Lifecycle 設定版はありません。")}</p> : <><label>{text("Saved revision", "保存済みの版")}<select value={revision} disabled={busy} onChange={event => {setRevision(event.target.value); setPreview(null);}}>{data.lifecycleRevisions.map(item => <option key={item.id} value={item.id}>{item.domain} · {item.version} · {item.state}</option>)}</select></label><button disabled={busy || !revision} onClick={() => void read("preview", revision)}>{text("Compare saved configuration", "設定の差分を確認")}</button></>}
        {data.lifecycleRevisionsTruncated && <p>{text("Only the latest 100 saved revisions are listed. Earlier revisions remain in their original history.", "ここには新しい 100 件の設定版を表示しています。それ以前の版は元の履歴から確認してください。")}</p>}
        {preview && <div><p>{preview.after.domain}: {preview.before?.version ?? text("No published revision", "公開済みの版なし")} → {preview.after.version}</p>
          <p>{text("Selected revision hash", "選択した版のハッシュ")}: <code>{preview.after.hash}</code></p><p>{preview.planAvailable ? text("The existing plan permits this configuration.", "現在のプランで利用できる設定です。") : text("The current plan does not permit using this configuration. Reading the comparison does not enable it.", "現在のプランでは利用対象外です。比較を閲覧しても有効にはなりません。")}</p>
          <h3>{text("Changed configuration fields", "変更された設定項目")}</h3>{preview.changedFields.length ? <ul>{preview.changedFields.map(key => <li key={key}>{key}</li>)}</ul> : <p>{text("No configuration differences.", "設定の差分はありません。")}</p>}
          {"kind" in preview.executionSimulation ? <LifecyclePreviewResults value={preview.executionSimulation} locale={locale} busy={busy} replay={input => void read("preview", preview.after.id, input)}/> : <p>{text("Only configuration comparison is available for this saved response.", "この保存済み応答では、設定の比較だけを利用できます。")}</p>}</div>}
        <p><a href="/automation">{text("Open Automation editor and its existing validation", "Automation エディターと既存の検証を開く")}</a></p>
      </section>}
    </>}
    <p><a href="/dashboard">{text("Back to dashboard", "ダッシュボードへ戻る")}</a></p>
  </section>;
}
