"use client";
import { useEffect, useState } from "react";
import {automationLocation, automationSummary, scheduledTime, type AutomationSummary} from "./alpha15-dashboard-model";
import "./alpha15-dashboard.css";

const states: Record<string, [string, string]> = {
  DRAFT: ["下書き", "Draft"], ACTIVE: ["有効", "Enabled"], ENABLED: ["有効", "Enabled"], DISABLED: ["停止", "Stopped"],
  QUEUED: ["開始待ち", "Queued"], RUNNING: ["実行中", "Running"], WAITING: ["待機中", "Waiting"],
  WAITING_APPROVAL: ["承認待ち", "Awaiting approval"], SUCCEEDED: ["完了", "Completed"],
  COMPLETED: ["完了", "Completed"], PARTIAL: ["一部完了", "Partially completed"],
  FAILED: ["失敗", "Failed"], CANCELLED: ["中止", "Cancelled"], EXPIRED: ["期限切れ", "Expired"],
  UNKNOWN: ["結果不明・再送停止", "Result unknown · sending stopped"],
  RECONCILING: ["結果を照合中・新規送信停止", "Checking result · new sending stopped"],
};

export function Alpha15Dashboard({ guildId, locale }: { guildId: string; locale: "ja" | "en" }) {
  const ja = locale === "ja", [summary, setSummary] = useState<AutomationSummary | null>(null),
    [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setSummary(null); setError(false);
    void fetch("/api/automation/overview", { headers: { "X-Nexus-Guild": guildId }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("UNAVAILABLE");
        const value = automationSummary(await response.json());
        if (!value) throw new Error("UNAVAILABLE");
        if (alive) setSummary(value);
      }).catch(() => { if (alive && !controller.signal.aborted) setError(true); });
    return () => { alive = false; controller.abort(); };
  }, [guildId, retry]);
  const label = (state: string) => states[state]?.[ja ? 0 : 1] ?? (ja ? "状態を確認してください" : "Review status");
  const pending = summary?.runs.filter(run => ["UNKNOWN", "WAITING_APPROVAL", "FAILED", "RECONCILING"].includes(run.state) || !states[run.state]);
  const cards = [
    ["schedule", "予定のお知らせ", "Scheduled notices", "日時と通知先を選び、次の予定を確認します。", "Choose a time and destination, then review upcoming occurrences."],
    ["approval", "申請と承認", "Requests and approvals", "対象と内容を固定して、必要な承認を確認します。", "Fix the target and details before collecting the required approval."],
    ["ticket", "受付への対応", "Request follow-up", "許可された状態を確認し、必要な対応を組み立てます。", "Review permitted state and assemble the required follow-up."],
    ["interaction", "ボタンからの案内", "Button guidance", "本人の操作と期限を確かめて、案内を組み立てます。", "Build guidance with checks for the person and interaction deadline."],
  ] as const;
  return <section className="alpha15-home" aria-labelledby="automation-overview-title">
    <div className="alpha15-heading"><div><h2 id="automation-overview-title">{ja ? "必要な操作と自動化" : "Next actions and automation"}</h2>
      <p>{ja ? "設定を保存しても、自動化や通知は有効になりません。" : "Saving settings does not enable automations or notifications."}</p></div>
      <a href={`/setup?guild=${encodeURIComponent(guildId)}&edit=1`}>{ja ? "Web設定を開く" : "Open web settings"}</a></div>
    {error ? <div className="alpha15-status" role="alert"><p>{ja ? "自動化の状態を取得できませんでした。件数や結果は未確認です。" : "Automation status could not be retrieved. Counts and results are unverified."}</p>
      <button type="button" onClick={() => setRetry(n => n + 1)}>{ja ? "もう一度確認" : "Check again"}</button></div>
      : !summary ? <p role="status">{ja ? "自動化と次の予定を確認しています。" : "Checking automation and upcoming schedules."}</p>
      : <div className="alpha15-status" role="status"><p>{pending?.length ? (ja ? `${pending.length}件の実行を確認してください。` : `Review ${pending.length} runs.`) : (ja ? "取得できた実行に、確認待ちの結果はありません。" : "Retrieved runs have no results awaiting review.")}</p>
        {pending?.slice(0, 5).map(run => <p key={run.id}><a href={automationLocation(run.flowId, run.id)}>{summary.flows.find(flow => flow.id === run.flowId)?.name ?? (ja ? "自動化の実行" : "Automation run")} · {label(run.state)}</a></p>)}
        <p>{ja ? "実行枠" : "Run allowance"}: {summary.usage.remaining} / {summary.usage.limit} · {ja ? "予約中" : "Reserved"} {summary.usage.reserved} · {ja ? "消費済み" : "Used"} {summary.usage.consumed} · {ja ? "補填" : "Compensated"} {summary.usage.compensated}</p>
        <p className="alpha15-updated">{ja ? "更新" : "Updated"}: <time dateTime={summary.usage.updatedAt}>{scheduledTime(summary.usage.updatedAt, "UTC", locale)} UTC</time></p>
        {summary.status !== "AVAILABLE" && <p>{ja ? "対象PCの容量を確認できるまで、本番の新規開始は停止しています。下書きと送信なし試運転は利用できます。" : "New production starts are stopped until host capacity is verified. Drafts and simulation remain available."}</p>}
      </div>}
    {summary && <section className="alpha15-flows"><h3>{ja ? "自動化" : "Your automations"}</h3>{summary.flows.length ? <ul>{summary.flows.slice(0, 5).map(flow => <li key={flow.id}><a href={automationLocation(flow.id)}>{flow.name}</a><span>{label(flow.state)}</span></li>)}</ul> : <p>{ja ? "自動化はまだありません。" : "No automations yet."}</p>}</section>}
    <div className="alpha15-feature-grid">{cards.map(([template, nameJa, nameEn, detailJa, detailEn]) => <article key={template}>
      <h3>{ja ? nameJa : nameEn}</h3><p>{ja ? detailJa : detailEn}</p>
      <p className="alpha15-card-state">{template === "approval" ? (ja ? "未有効の下書き・実行には正式承認と現在の権限確認が必要" : "Disabled draft · execution requires formal approval and current permission checks") : template === "ticket" ? (ja ? "既存の構造化受付に限定・確認後に有効化" : "Existing structured requests only · review before enabling") : template === "interaction" ? (ja ? "本人に結び付いた期限付きボタン・確認後に有効化" : "Time-limited buttons bound to the person · review before enabling") : (ja ? "例から未有効の下書きを作成" : "Create a disabled draft from an example")}</p>
      <a href={`/automation?template=${template}`}>{ja ? "例から作る" : "Start from an example"}<span aria-hidden="true"> →</span></a>
    </article>)}</div>
    {summary && <div className="alpha15-recent"><section><h3>{ja ? "最近の実行" : "Recent runs"}</h3>
      {summary.runs.length ? <ul>{summary.runs.slice(0, 5).map(run => <li key={run.id}><a href={automationLocation(run.flowId, run.id)}>{summary.flows.find(flow => flow.id === run.flowId)?.name ?? (ja ? "自動化" : "Automation")}</a><span>{label(run.state)}</span></li>)}</ul> : <p>{ja ? "実行記録はまだありません。" : "No run records yet."}</p>}</section>
      <section><h3>{ja ? "次の予定" : "Upcoming schedules"}</h3>{summary.nextOccurrences.length ? <ul>{summary.nextOccurrences.slice(0, 5).map(item => { const formatted = scheduledTime(item.at, item.timezone, locale); return <li key={item.id}>{formatted ? <time dateTime={item.at}>{formatted}</time> : <span>{ja ? "予定の日時を確認してください。予約済みとは確認できません。" : "Review the scheduled time. This occurrence is unconfirmed."}</span>}<span>{item.timezone}</span></li>; })}</ul> : <p>{ja ? "現在取得できる予定はありません。" : "No upcoming occurrences are currently available."}</p>}</section></div>}
    <a className="alpha15-all" href="/automation">{ja ? "自動化の一覧を開く" : "Open automation workspace"} →</a>
  </section>;
}
