"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { analysisTypes } from "../../../../packages/analysis/src/catalog";
import type { AnalysisMetric, AnalysisRequest, AnalysisResult, AnalysisQuality, Availability } from "../../../../packages/analysis/src/domain";
import type { AnalysisComparison } from "../../../../packages/analysis/src/comparison";
import { analysisNames, metricNames, qualityNames, availabilityNames, runStatusNames, localized, analysisCopy, analysisEvidenceReason } from "../../../../packages/discord-panels/src/i18n/analysis";
import type { AnalysisRunDto } from "./model";
import { csrfHeaders } from "../auth/csrf-client";
import { safeError } from "../safe-error";

type Menu = { items: { type: AnalysisRequest["type"]; availability: Availability }[]; usage: { remaining: number; reserved: number; consumed: number }; canAnalyze: boolean };
type Preview = { request: AnalysisRequest; availability: Availability; quality: AnalysisQuality; targetChannelCount: number; metrics: AnalysisMetric[];
  configRevision: number; inputFingerprint: string; consumeCount: number; duplicate: { id: string; status: string } | null };
type History = { runs: AnalysisRunDto[]; nextCursor: string | null; previousCursor: string | null };
type Detail = { run: AnalysisRunDto; result: AnalysisResult | null; canCancel: boolean };
const activeStatuses = new Set(["QUEUED", "PREPARING", "RUNNING", "FINALIZING"]);
export function AnalysisWorkspace({ locale, guildId }: { locale: "ja" | "en"; guildId: string }) {
  const ja = locale === "ja", [type, setType] = useState<AnalysisRequest["type"]>("OVERALL"), [days, setDays] = useState<7 | 30 | 90>(30);
  const [menu, setMenu] = useState<Menu | null>(null), [history, setHistory] = useState<History | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null), [comparison, setComparison] = useState<AnalysisComparison | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [canceling, setCanceling] = useState(false);
  const inFlight = useRef(false), intentKey = useRef<string | null>(null), generation = useRef(0);
  const call = useCallback(async <T,>(path: string, body?: unknown, key?: string): Promise<T> => {
    const headers = csrfHeaders({ "X-Nexus-Guild": guildId, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) });
    const response = await fetch(`/api/analysis/${path}${path.includes("?") ? "&" : "?"}guild=${encodeURIComponent(guildId)}`, { method: body === undefined ? "GET" : "POST", headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "ANALYSIS_UNAVAILABLE");
    return data as T;
  }, [guildId]);
  useEffect(() => {
    let live = true; const current = ++generation.current;
    setLoading(true); setMenu(null); setHistory(null); setPreview(null); setDetail(null); setComparison(null); setError(""); intentKey.current = null;
    Promise.all([call<Menu>(`menu?days=${days}`), call<History>("history")]).then(([m, h]) => { if (live && current === generation.current) { setMenu(m); setHistory(h); } }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : "ANALYSIS_UNAVAILABLE"); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // Requests are bound to this keyed guild workspace and the selected period.
  }, [guildId, days, call]);
  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "ANALYSIS_UNAVAILABLE"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const open = (id: string) => perform(async () => { const value = await call<Detail>(`runs/${id}`); setDetail(value); setComparison(null); setCanceling(false); });
  async function refresh() { setHistory(await call<History>("history")); if (detail) setDetail(await call<Detail>(`runs/${detail.run.id}`)); }
  const metrics = detail?.result?.metrics ?? preview?.metrics ?? [];
  const metricName = (key: string) => localized(locale, metricNames[key]) || analysisCopy(locale, "unknownMetric");
  return <section aria-busy={busy || loading}>
    <h1>{ja ? "詳細分析" : "Detailed analysis"}</h1>
    <p>{ja ? "保存済みの観測を分析します。集計の変化だけで原因や効果は断定しません。" : "Analyze saved observations. Aggregate changes alone do not establish causes or effects."}</p>
    {error && <p role="alert">{safeError(error, locale)} <code>{/^[A-Z][A-Z0-9_]{0,79}$/.test(error) ? error : "ANALYSIS_UNAVAILABLE"}</code></p>}
    {loading && <p role="status">{ja ? "確認中…" : "Loading…"}</p>}
    {menu && <p>{ja ? "利用枠" : "Usage"}: {menu.usage.remaining} / {ja ? "予約中" : "Reserved"}: {menu.usage.reserved} / {ja ? "使用済み" : "Used"}: {menu.usage.consumed}</p>}
    {menu && !menu.canAnalyze && <p role="status">{ja ? "結果を閲覧できます。新規分析の開始権限はありません。" : "You can read results. You do not have permission to start an analysis."}</p>}
    <label>{ja ? "分析内容" : "Analysis"}<select value={type} disabled={busy || loading} onChange={event => { setType(event.target.value as AnalysisRequest["type"]); setPreview(null); intentKey.current = null; }}>
      {analysisTypes.map(value => <option key={value} value={value}>{localized(locale, analysisNames[value])}</option>)}</select></label>
    <label>{ja ? "期間（日）" : "Period (days)"}<select value={days} disabled={busy || loading} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map(value => <option key={value}>{value}</option>)}</select></label>
    <button disabled={busy || loading || !menu} onClick={() => void perform(async () => { setDetail(null); setComparison(null); setPreview(await call<Preview>("preview", { type, days })); intentKey.current = crypto.randomUUID(); })}>{ja ? "条件と利用枠を確認" : "Preview conditions and usage"}</button>
    {preview && <section className="surface"><h2>{ja ? "分析条件" : "Analysis conditions"}</h2><p>{preview.request.periodStart} — {preview.request.periodEnd} · {localized(locale, qualityNames[preview.quality])} · {localized(locale, availabilityNames[preview.availability])}</p><p>{ja ? "対象チャンネル数" : "Target channels"}: {preview.targetChannelCount} · {ja ? "消費予定" : "Expected usage"}: {preview.consumeCount}</p>
      {preview.duplicate && <button disabled={busy} onClick={() => void open(preview.duplicate!.id)}>{ja ? "同じ条件の既存結果を開く" : "Open the existing matching analysis"}</button>}
      <button disabled={busy || !menu?.canAnalyze || !["AVAILABLE", "PARTIAL"].includes(preview.availability)} onClick={() => void perform(async () => {
        intentKey.current ??= crypto.randomUUID();
        const accepted = await call<{ run: AnalysisRunDto }>("runs", { request: preview.request, expected: { revision: preview.configRevision, fingerprint: preview.inputFingerprint } }, intentKey.current);
        setDetail(await call<Detail>(`runs/${accepted.run.id}`)); setPreview(null); setHistory(await call<History>("history"));
      })}>{ja ? "この条件で分析を開始" : "Start with these conditions"}</button>
      <button disabled={busy} onClick={() => { setPreview(null); intentKey.current = null; }}>{ja ? "取消" : "Cancel"}</button></section>}
    {detail && <section className="surface"><h2>{localized(locale, analysisNames[detail.run.analysisType])}</h2><p>{localized(locale, runStatusNames[detail.run.status])} · {detail.run.periodStart} — {detail.run.periodEnd}</p><p>{ja ? "保存期限" : "Expires"}: {detail.run.retentionUntil}</p>
      {!activeStatuses.has(detail.run.status) && !detail.result && <p role="status">{ja ? "現在閲覧できる結果はありません。保存期限・データの削除・対象範囲・処理状態を確認してください。" : "No result is currently available. Check expiry, data removal, scope and processing status."}</p>}
      {activeStatuses.has(detail.run.status) && <button disabled={busy} onClick={() => void perform(refresh)}>{ja ? "処理状況を再取得" : "Refresh progress"}</button>}
      {detail.canCancel && !canceling && <button disabled={busy} onClick={() => setCanceling(true)}>{ja ? "開始前の分析を取り消す" : "Cancel queued analysis"}</button>}
      {canceling && <div role="dialog" aria-label={ja ? "取消確認" : "Confirm cancellation"}><p>{ja ? "この待機中の分析を取り消します。開始済みの分析は取り消せません。" : "Cancel this queued analysis. An already started analysis cannot be canceled."}</p><button disabled={busy} onClick={() => void perform(async () => { await call(`runs/${detail.run.id}/cancel`, {}); setCanceling(false); await refresh(); })}>{ja ? "取消を確定" : "Confirm cancellation"}</button><button disabled={busy} onClick={() => setCanceling(false)}>{ja ? "戻る" : "Back"}</button></div>}
      {detail.result && <><p>{localized(locale, qualityNames[detail.result.dataQuality])}</p>
        <h3>{analysisCopy(locale, "unknowns")}</h3><p>{analysisCopy(locale, "unknownsDescription")}</p>
        <h3>{ja ? "推奨される対応" : "Recommended actions"}</h3>
        {detail.result.recommendedActions.length === 0 ? <p>{ja ? "この分析から追加する推奨はありません。問題がないことを証明するものではありません。" : "This analysis has no additional recommendations. This does not establish that no issues exist."}</p> : <ul>{detail.result.recommendedActions.map((action, index) => <li key={`${action}-${index}`}>{action === "REVIEW_WAITING_RESPONSE" ? (ja ? "未回答の相談について、現在の根拠と対応状況を確認してください。" : "Review the current evidence and follow-up status of requests awaiting a response.") : analysisCopy(locale, "nextCheckDescription")}</li>)}</ul>}
        <p><a href="/operations?view=attention">{analysisCopy(locale, "responseRecords")}</a></p>
        <button disabled={busy} onClick={() => void perform(async () => setComparison(await call<AnalysisComparison>(`runs/${detail.run.id}/compare`)))}>{ja ? "比較可能な過去結果を確認" : "Compare with eligible prior results"}</button></>}
      <button disabled={busy} onClick={() => { setDetail(null); setComparison(null); setCanceling(false); }}>{ja ? "一覧へ戻る" : "Back to list"}</button></section>}
    {metrics.length > 0 && <table><thead><tr><th>{ja ? "指標" : "Metric"}</th><th>{ja ? "値" : "Value"}</th><th>{ja ? "品質・観測範囲" : "Quality / coverage"}</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric.key}><th>{metricName(metric.key)}</th><td>{metric.evidence.value === null ? (ja ? "不明 / 対象外" : "Unknown / not applicable") : metric.evidence.value} {metric.unit === "SECONDS" ? (ja ? "秒" : "seconds") : (ja ? "件" : "records")}</td><td>{localized(locale, qualityNames[metric.quality])}<br />{metric.evidence.windowStart} — {metric.evidence.windowEnd}{metric.evidence.coverageReasons.map(reason => <p key={reason}>{analysisEvidenceReason(locale, reason)}</p>)}</td></tr>)}</tbody></table>}
    {comparison && <section><h2>{ja ? "比較" : "Comparison"}</h2><p>{analysisCopy(locale, "comparisonConditions")}</p>{comparison.comparable ? <ul>{comparison.changes.map(item => <li key={item.key}>{metricName(item.key)}: {item.before} → {item.after} {item.unit === "SECONDS" ? (ja ? "秒" : "seconds") : (ja ? "件" : "records")}</li>)}</ul> : <><p>{ja ? "この組合せは比較できません。" : "These results are not comparable."}</p><ul>{(comparison.reasons ?? []).map(reason => <li key={reason}>{analysisEvidenceReason(locale, reason)}</li>)}</ul></>}</section>}
    <section><h2>{ja ? "保存済み分析" : "Saved analyses"}</h2>{history && history.runs.length === 0 && <p>{ja ? "保存済み分析はありません。" : "No saved analyses."}</p>}
      <ul>{history?.runs.map(run => <li key={run.id}><button disabled={busy} onClick={() => void open(run.id)}>{localized(locale, analysisNames[run.analysisType])} · {localized(locale, runStatusNames[run.status])} · {run.requestedAt}</button></li>)}</ul>
      {(["previous", "next"] as const).map(direction => { const cursor = direction === "next" ? history?.nextCursor : history?.previousCursor; return cursor ? <button key={direction} disabled={busy} onClick={() => void perform(async () => setHistory(await call<History>(`history?cursor=${encodeURIComponent(cursor)}&direction=${direction}`)))}>{direction === "next" ? (ja ? "次へ" : "Next") : (ja ? "前へ" : "Previous")}</button> : null; })}
      <button disabled={busy || loading} onClick={() => void perform(refresh)}>{ja ? "再取得" : "Refresh"}</button></section>
    <p><a href="/explore">{ja ? "基本の分析へ戻る" : "Back to Explore"}</a></p>
  </section>;
}
