"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfHeaders } from "../auth/csrf-client";

type Locale = "en" | "ja";
type Source = {id: string; confirmed: boolean; codeRefs?: string[]; purpose?: string};
type Rule = {ruleId: string; domain?: string; [key: string]: unknown};
type Case = {id: string; revision: string; sourceMappings: Source[]; audience?: string; actions: {id: string; mode: string; ownerRole: string; explanation?: Explanation}[]};
export interface RulesCatalog {
  readiness: {enabled: boolean; reasonCodes: string[]; permissions: string[]; environmentStatus: string};
  rules: Rule[]; cases: Case[];
}
type Explanation = {
  observation?: string; branchReason?: string; caution?: string; alternative?: string | null;
  action?: string; ownerRole?: string; reviewCondition?: string; hypothesis?: {textSlot: string; isHypothesis: boolean} | string | null;
  translations?: Partial<Record<Locale, Explanation>>;
};
export interface RuleSuggestion {
  suggestionId: string; suggestionVersion: number; ruleId: string; issueCode: string;
  target: {targetType: string; targetId: string; liveVersion: string | null};
  sharedState: string; action: {actionId: string; mode: string}; explanation: Explanation;
  evaluationAsOf: string; createdAt: string; lastObservedAt: string;
  actionableUntil: string; historyExpiresAt: string; invalidationReason?: string | null;
  perUserState?: {viewedAt: string | null; dismissedAt: string | null; savedAt: string | null};
  evidence?: {kind: string; referenceHash: string; expiresAt: string}[];
  canView?: boolean; canRecordView?: boolean; canDismiss?: boolean; canSave?: boolean; canReject?: boolean;
  canCreateDraft?: boolean; canApply?: boolean;
}
interface SuggestionList {items: RuleSuggestion[]; page: {nextCursor: string | null; snapshotAt: string}; status: "EMPTY" | "AVAILABLE";}
type Problem = "PERMISSION" | "COMMUNICATION" | "STALE" | "CONFLICT" | "UNKNOWN" | "CANCELLED";
type PersonalAction = "view" | "dismiss" | "save" | "reject";
type Confirmation = {action: PersonalAction; suggestion: RuleSuggestion};
class RequestFailure extends Error {
  constructor(readonly kind: Problem, readonly code: string) {super(code);}
}

const ruleNames: Record<string, [string, string]> = {
  "ONB-001": ["First steps and onboarding", "初期案内と最初の参加"],
  "HELP-001": ["Help awaiting a response", "返信を待つ相談"],
  "RET-001": ["Continued participation", "継続参加の変化"],
  "ENG-001": ["Channel use", "チャンネルの利用状況"],
  "EVENT-001": ["Event participation", "イベント参加"],
  "REPORT-001": ["Report preparation and delivery", "レポート作成と配信"],
  "AUTO-001": ["Automation results", "オートメーションの実行結果"],
  "AUTO-002": ["Waiting automation work", "処理待ちのオートメーション"],
  "PERM-001": ["Expected and observed access", "想定する権限と実測"],
  "EXP-001": ["Bounded improvement trials", "小さな改善の試行"],
  "PLAY-001": ["Available operating procedures", "利用できる運営手順"],
  "DATA-001": ["Data availability and freshness", "データの取得状態と鮮度"],
  "COMM-001": ["Review across operating areas", "運営領域を横断した確認"],
};
const caseNames: Record<string, [string, string]> = {
  CASE01: ["Finding the first destination", "最初の行き先が分からない"], CASE02: ["First contact and human welcome", "最初の投稿への反応"],
  CASE03: ["Unanswered help", "未回答の相談"], CASE04: ["Help that remains unresolved", "返信後も進まない相談"],
  CASE05: ["Growth and participation", "参加者の増加と参加状況"], CASE06: ["Event and moderation capacity", "イベントと運営の対応範囲"],
  CASE07: ["An event format that fits", "用途に合うイベント形式"], CASE08: ["Activity between releases", "更新の間の活動"],
  CASE09: ["Tracking community requests", "要望の対応状況"], CASE10: ["Channel purpose and access", "チャンネルの用途と権限"],
  CASE11: ["Reviewing an event", "イベントの振り返り"], CASE12: ["Announcements and notifications", "告知と通知"],
  CASE13: ["Restricted queue triage", "限定キューの振り分け"], CASE14: ["Volunteer duty coverage", "担当業務と対応範囲"],
  CASE15: ["Filter review", "フィルターの確認"], CASE16: ["Campaign or safety incident", "キャンペーンと安全確認"],
  CASE17: ["Transparency and privacy", "公開範囲とプライバシー"], CASE18: ["Text and voice access", "画像・音声の利用経路"],
  CASE19: ["A community for readers", "読むことを中心にした利用"], CASE20: ["Forums and unresolved posts", "フォーラムと未解決の投稿"],
};

const hasRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const safeId = (value: string) => /^[a-zA-Z0-9-]{1,128}$/.test(value);
const requestProblem = (status: number, code: string): Problem =>
  status === 401 || status === 403 ? "PERMISSION" : status === 412 || status === 410 ? "STALE" : status === 409 ? "CONFLICT" : code.includes("UNKNOWN") ? "UNKNOWN" : "COMMUNICATION";

export function RulesWorkspace({locale, guildId, guildName}: {locale: Locale; guildId: string; guildName?: string}) {
  const ja = locale === "ja";
  const t = (en: string, jp: string) => ja ? jp : en;
  const [catalog, setCatalog] = useState<RulesCatalog | null>(null);
  const [listing, setListing] = useState<SuggestionList | null>(null);
  const [tab, setTab] = useState<"suggestions" | "catalog">("suggestions");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [detail, setDetail] = useState<RuleSuggestion | null>(null);
  const [history, setHistory] = useState<{sequence: string; eventType: string; occurredAt: string}[] | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [rejectReason, setRejectReason] = useState("NOT_APPLICABLE");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const readController = useRef<AbortController | null>(null);
  const readSequence = useRef(0);
  const mutationLock = useRef(false);
  const detailSequence = useRef(0);

  const get = useCallback(async <T,>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`/api/rules/${path}`, {headers: {"X-Nexus-Guild": guildId}, credentials: "same-origin", cache: "no-store", signal});
    const envelope: unknown = await response.json();
    if (!hasRecord(envelope) || !response.ok || envelope.ok !== true) {
      const code = hasRecord(envelope) && hasRecord(envelope.error) && typeof envelope.error.code === "string" ? envelope.error.code : "RESPONSE_UNAVAILABLE";
      throw new RequestFailure(requestProblem(response.status, code), code);
    }
    return envelope.data as T;
  }, [guildId]);

  const load = useCallback(async (cursor?: string) => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const sequence = ++readSequence.current;
    setLoading(true); setProblem(null); setNotice(null);
    const query = new URLSearchParams({limit: "20"}); if (cursor) query.set("cursor", cursor);
    const results = await Promise.allSettled([
      get<RulesCatalog>("catalog", controller.signal),
      get<SuggestionList>(`suggestions?${query}`, controller.signal),
    ]);
    if (controller.signal.aborted || sequence !== readSequence.current) return;
    const [catalogResult, listResult] = results;
    if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value.rules) && Array.isArray(catalogResult.value.cases) && catalogResult.value.readiness) setCatalog(catalogResult.value);
    else {setCatalog(null); setProblem(catalogResult.status === "rejected" && catalogResult.reason instanceof RequestFailure ? catalogResult.reason.kind : "COMMUNICATION");}
    if (listResult.status === "fulfilled" && Array.isArray(listResult.value.items) && listResult.value.page) setListing(listResult.value);
    else {setListing(null); setProblem(listResult.status === "rejected" && listResult.reason instanceof RequestFailure ? listResult.reason.kind : "COMMUNICATION");}
    setLoading(false);
  }, [get]);

  useEffect(() => {void load(); return () => {++readSequence.current; ++detailSequence.current; readController.current?.abort();};}, [load]);

  const openDetail = async (suggestion: RuleSuggestion) => {
    const sequence = ++detailSequence.current;
    setDetail(suggestion); setHistory(null); setProblem(null); setLoading(true);
    const results = await Promise.allSettled([
      get<RuleSuggestion>(`suggestions/${encodeURIComponent(suggestion.suggestionId)}`),
      get<{items: {sequence: string; eventType: string; occurredAt: string}[]}>(`suggestions/${encodeURIComponent(suggestion.suggestionId)}/history`),
    ]);
    if (sequence !== detailSequence.current) return;
    if (results[0].status === "fulfilled") setDetail(results[0].value);
    else {setDetail(null); setProblem(results[0].reason instanceof RequestFailure ? results[0].reason.kind : "COMMUNICATION");}
    if (results[1].status === "fulfilled") setHistory(results[1].value.items);
    else setProblem(results[1].reason instanceof RequestFailure ? results[1].reason.kind : "COMMUNICATION");
    setLoading(false);
  };

  const closeDetail = () => {++detailSequence.current; setDetail(null); setHistory(null); setConfirmation(null); setLoading(false); setProblem(null);};
  const enabled = catalog?.readiness.enabled === true;
  const can = (action: PersonalAction, item: RuleSuggestion) => !loading && !pending && problem !== "UNKNOWN" && ({view: item.canRecordView, dismiss: item.canDismiss, save: item.canSave, reject: item.canReject}[action] === true);

  const confirm = async () => {
    if (!confirmation || mutationLock.current || !can(confirmation.action, confirmation.suggestion)) return;
    mutationLock.current = true; setPending(true); setProblem(null); setNotice(null);
    const item = confirmation.suggestion, action = confirmation.action;
    let sent = false;
    try {
      const headers = csrfHeaders({"X-Nexus-Guild": guildId, "Content-Type": "application/json"});
      const payload = action === "reject" ? {reasonCode: rejectReason} : {};
      const operation = {view: "SUGGESTION_VIEW", save: "SUGGESTION_SAVE", dismiss: "SUGGESTION_DISMISS", reject: "SUGGESTION_REJECT"}[action];
      const prepareResponse = await fetch("/api/rules/mutation-request-key", {
        method: "POST", credentials: "same-origin", headers,
        body: JSON.stringify({operation, targetId: item.suggestionId, ...(action === "reject" ? {expectedVersion: item.suggestionVersion} : {}), payload}),
      });
      const prepared: unknown = await prepareResponse.json();
      if (!prepareResponse.ok || !hasRecord(prepared) || prepared.ok !== true || !hasRecord(prepared.data) || typeof prepared.data.key !== "string") {
        const code = hasRecord(prepared) && hasRecord(prepared.error) && typeof prepared.error.code === "string" ? prepared.error.code : "REQUEST_PREPARATION_UNAVAILABLE";
        throw new RequestFailure(requestProblem(prepareResponse.status, code), code);
      }
      headers.set("Idempotency-Key", prepared.data.key);
      if (action === "reject") headers.set("If-Match", `"${item.suggestionVersion}"`);
      sent = true;
      const response = await fetch(`/api/rules/suggestions/${encodeURIComponent(item.suggestionId)}/${action}`, {
        method: "POST", credentials: "same-origin", headers,
        body: JSON.stringify(payload),
      });
      const envelope: unknown = await response.json();
      if (!response.ok || !hasRecord(envelope) || envelope.ok !== true) {
        const code = hasRecord(envelope) && hasRecord(envelope.error) && typeof envelope.error.code === "string" ? envelope.error.code : "RESULT_UNKNOWN";
        throw new RequestFailure(requestProblem(response.status, code), code);
      }
      setConfirmation(null); setNotice(t("Your choice was saved. No proposed change was applied.", "選択を保存しました。提案の適用は行っていません。"));
      await openDetail(item);
    } catch (error) {
      setConfirmation(null); setProblem(error instanceof RequestFailure ? error.kind : sent ? "UNKNOWN" : "COMMUNICATION");
    } finally {mutationLock.current = false; setPending(false);}
  };

  const reasonText = (code: string) => code.includes("RETENTION") ? t("Storage and deletion settings for newly generated responses are not configured.", "新しい対応案を生成・保存するための保存・削除設定が未確定です。")
    : code.includes("CONFIG") ? t("New evaluation settings are not active.", "新しい評価の実行設定は有効化されていません。")
    : code.includes("SOURCE") ? t("Required input connections are unconfirmed.", "必要な情報源の接続が未確認です。")
    : t("An enablement condition needs confirmation.", "有効化の条件に確認が必要です。");
  const problemText: Record<Problem, string> = {
    PERMISSION: t("Current access could not be confirmed. Select a server again or ask an administrator.", "現在の閲覧権限を確認できません。サーバーを選び直すか管理者へ確認してください。"),
    COMMUNICATION: t("The latest information could not be loaded. No successful result is assumed.", "最新の情報を取得できませんでした。正常な結果としては扱っていません。"),
    STALE: t("The suggestion or its evidence has changed or expired. Reload before choosing again.", "提案または根拠が変更・失効しています。再読込してから確認してください。"),
    CONFLICT: t("The current state does not allow this choice. Reload to review the latest state.", "現在の状態ではこの操作を受け付けられません。再読込して確認してください。"),
    UNKNOWN: t("The result could not be confirmed. Do not resend; reload the current state first.", "結果を確認できません。同じ操作を再送せず、まず現在の状態を読み直してください。"),
    CANCELLED: t("Loading was cancelled. No operation was sent.", "読込を取り消しました。操作は送信していません。"),
  };
  const dateText = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(ja ? "ja-JP" : "en-US", {timeZone: "UTC"}) + " UTC" : t("Unknown", "不明");
  const actionLabels: Record<PersonalAction, string> = {view: t("Mark viewed", "既読にする"), save: t("Save for me", "自分用に保存"), dismiss: t("Hide for me", "自分だけ非表示"), reject: t("Reject for this server", "サーバー全体で却下")};
  const stateLabel = (state: string) => {
    const labels: Record<string, string> = {ACTIVE: t("Active", "有効な対応案"), REJECTED: t("Rejected", "却下済み"), EXPIRED: t("Expired", "期限切れ"), INVALIDATED: t("Invalidated", "根拠が失効"), CONSUMED: t("Applied successfully", "適用成功を確認済み")};
    return labels[state] ?? t("Unknown", "不明");
  };
  const inputDescription = (caseId: string, purpose: string | undefined) => {
    const jp: Record<string, string> = {
      CASE13: "限定キューの件数・担当・権限と、権限者による混在の確認。報告本文は扱いません。",
      CASE14: "明示された対応可能範囲と当番表、ロール・業務区分ごとの割当集計。個人評価は行いません。",
      CASE15: "同じ審査集合の件数、確認済みの誤検出、発火ルールの集合と機能対応の確認。",
      CASE16: "キャンペーン予定、担当者のインシデント確認、警告と一時制限の状態。",
      CASE17: "想定する権限と観測した権限、権限者のプライバシー確認と保持範囲。本文は扱いません。",
      CASE18: "画像・音声形式、必要情報のテキスト同等性、任意の構造化された障壁報告。",
      CASE19: "明示された用途、作業案内・参加の入口の確認、認可された閲覧集計の有無と状態。",
      CASE20: "チャンネル種別、明示タグと結果、アーカイブ・ロック状態、相談の埋没と導線の確認。",
    };
    return ja ? jp[caseId] ?? "認可された集計・設定と、担当者が明示した運営状況を扱います。必要な接続・権限・保持方針が揃うまで利用しません。" : purpose ?? "Authorized aggregates, settings and explicit operating checklists are required.";
  };
  const selectedCatalogAction = detail ? catalog?.cases.flatMap((entry) => entry.actions).find((action) => action.id === detail.action.actionId) : undefined;
  const explanation = detail ? {...selectedCatalogAction?.explanation, ...detail.explanation, ...selectedCatalogAction?.explanation?.translations?.[locale], ...detail.explanation?.translations?.[locale]} : null;
  const explanationParts = explanation ? [
    [t("Observed", "観測されたこと"), explanation.observation], [t("Why this suggestion", "この提案になった理由"), explanation.branchReason],
    [t("Hypothesis", "仮説"), typeof explanation.hypothesis === "string" ? explanation.hypothesis : explanation.hypothesis?.textSlot],
    [t("Proposed action", "確認する具体策"), explanation.action],
    [t("Caution", "確認する点"), explanation.caution], [t("Alternative", "代替案"), explanation.alternative], [t("Review when", "見直す条件"), explanation.reviewCondition],
  ].filter((part) => typeof part[1] === "string" && part[1].length > 0) : [];

  return <section className="rules-workspace" aria-labelledby="rules-title">
    <header className="rules-heading"><div><p className="rules-eyebrow">{guildName ?? t("Selected server", "選択中のサーバー")}</p>
      <h1 id="rules-title">{t("Recommended responses", "推奨される対応")}</h1>
      <p>{t("These are recommended responses based on observed facts and explicit operating settings. You can read the evidence and limitations directly. Changes and posting use their own operating controls.", "観測された事実と明示された運営設定に基づく、推奨される対応です。根拠と限界をそのまま閲覧できます。変更や投稿は、それぞれの操作画面から行います。")}</p></div>
      <a href="/rules/context" className="rules-back">{t("Operational checks and settings", "運営状況の確認・評価設定")}</a>
      <a href="/operations?view=attention" className="rules-back">{t("Back to needs attention", "要確認へ戻る")}</a></header>

    {catalog && <aside className={`rules-readiness ${enabled ? "is-ready" : "is-pending"}`} aria-label={t("Generation and storage settings", "生成・保存の設定状態")}>
      <strong>{enabled ? t("Generation settings are available", "生成の設定が利用できます") : t("New response generation is not active", "新しい対応案の生成は未有効化です")}</strong>
      <ul>{catalog.readiness.reasonCodes.map((code) => <li key={code}>{reasonText(code)}</li>)}</ul>
      <p>{t("Existing responses within your current access are shown directly. Viewing them has no approval step.", "現在の権限で閲覧できる対応案は、そのまま表示します。閲覧のための承認操作はありません。")}</p>
      <p>{t("The initial catalog contains 13 base rules and 20 operating patterns. It does not cover every community situation.", "初期カタログは13の基礎ルールと20の運営パターンです。すべての状況を網羅するものではありません。")}</p>
      {catalog.readiness.environmentStatus !== "VERIFIED" && <p>{t("Live PC and external-service checks are scheduled for alpha17.", "実運用PCと外部連携の確認はalpha17で行います。")}</p>}
    </aside>}
    {problem && <div className="rules-message is-problem" role="alert"><p>{problemText[problem]}</p>
      <div className="rules-buttons"><button type="button" disabled={loading || pending} onClick={() => {closeDetail(); void load();}}>{t("Reload latest information", "最新情報を読み直す")}</button><a href="/servers">{t("Select server", "サーバーを選ぶ")}</a></div></div>}
    {notice && <p role="status" className="rules-message">{notice}</p>}
    {loading && <div className="rules-loading" role="status" aria-live="polite"><span aria-hidden="true" className="rules-loading-dot" />{t("Loading current information…", "現在の情報を読み込んでいます…")}
      {!detail && <button type="button" onClick={() => {++readSequence.current; readController.current?.abort(); setLoading(false); setProblem("CANCELLED");}}>{t("Cancel loading", "読込を取り消す")}</button>}</div>}

    {detail ? <article className="rules-detail" aria-labelledby="rules-detail-title">
      <div className="rules-detail-top"><button type="button" onClick={closeDetail} disabled={pending}>{t("Back to responses", "対応案の一覧へ戻る")}</button><span className="rules-badge">{t("Recommendation · no automatic action", "推奨 · 自動実行なし")}</span></div>
      <h2 id="rules-detail-title">{ruleNames[detail.ruleId]?.[ja ? 1 : 0] ?? detail.ruleId}</h2>
      <p className="rules-state">{t("Shared state", "共有状態")}: {stateLabel(detail.sharedState)}</p>
      <dl className="rules-explanation">{explanationParts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p>{t("Responsible role", "担当")}: {explanation?.ownerRole ?? selectedCatalogAction?.ownerRole ?? t("Confirm the authorized operating owner", "権限を持つ運営担当者の確認が必要です")}</p>
      {explanationParts.length === 0 && <p>{t("A readable explanation is unavailable. Do not apply an unexplained suggestion.", "説明を取得できません。根拠が確認できない提案は適用しないでください。")}</p>}
      <div className="rules-observed"><p>{t("Last observed", "最終観測")}: <time dateTime={detail.lastObservedAt}>{dateText(detail.lastObservedAt)}</time></p>
        <p>{t("Evidence usable until", "根拠を利用できる期限")}: {dateText(detail.actionableUntil)}</p><p>{t("History expires", "履歴の期限")}: {dateText(detail.historyExpiresAt)}</p></div>
      <div className="rules-buttons">{(["view", "save", "dismiss", "reject"] as const).map((action) => <button key={action} type="button" disabled={!can(action, detail)} onClick={() => setConfirmation({action, suggestion: detail})}>{actionLabels[action]}</button>)}</div>
      <p className="rules-help">{t("Viewing, saving and hiding affect your own list. Rejection is shared with the server. None of these choices applies a proposed change.", "既読・保存・非表示は自分の一覧にだけ反映され、却下はサーバー全体で共有されます。いずれも改善案を適用する操作ではありません。")}</p>
      <div className="rules-buttons"><button type="button" disabled>{t("Create a draft", "下書きを作る")}</button><button type="button" disabled>{t("Apply selected draft", "選択した下書きを適用")}</button></div>
      <p className="rules-help">{t("These are recommended responses with no automatic action. Draft or application controls require a registered editor, current permission and exact content/version checks. Reading a response does not require approval.", "推奨される対応であり、自動実行はしません。下書き・適用の操作には、対応する編集画面、現在の権限、内容と版の照合が必要です。対応案の閲覧に承認は必要ありません。")}</p>
      <details><summary>{t("History and evidence", "履歴と根拠")}</summary>
        {history === null ? <p>{t("History is unavailable.", "履歴を取得できません。")}</p> : history.length ? <ol>{history.map((event) => <li key={event.sequence}>{event.eventType} · {dateText(event.occurredAt)}</li>)}</ol> : <p>{t("No retained history.", "保存されている履歴はありません。")}</p>}
        <p>{t("Evidence references", "根拠の参照")}: {detail.evidence?.length ?? 0}</p><p>{t("Observed target version", "観測対象の版")}: {detail.target.liveVersion ?? t("Unknown", "不明")}</p>
      </details>
    </article> : <>
      <div className="rules-tabs" role="group" aria-label={t("Choose a view", "表示する内容")}><button type="button" aria-pressed={tab === "suggestions"} onClick={() => setTab("suggestions")}>{t("Recommended responses", "推奨される対応")}</button><button type="button" aria-pressed={tab === "catalog"} onClick={() => setTab("catalog")}>{t("Rules and inputs", "ルールと入力情報")}</button></div>
      {tab === "suggestions" ? <section className="rules-list" aria-label={t("Suggestions", "提案")}>
        {!loading && listing && listing.items.length === 0 && <div className="rules-empty"><span aria-hidden="true">◇</span><h2>{t("No retained responses", "保存されている対応案はありません")}</h2><p>{enabled ? t("No response is available for this scope. Missing data and a completed review are different states.", "この範囲で表示できる対応案はありません。データ不足と確認完了は別の状態です。") : t("New responses are not generated until required inputs, evaluation settings and storage policy are configured.", "必要な情報源・評価設定・保存方針が設定されるまで、新しい対応案は生成されません。")}</p><button type="button" onClick={() => setTab("catalog")}>{t("Inspect rules and input readiness", "ルールと入力情報を確認")}</button></div>}
        {listing?.items.map((item) => <article className="rules-card" key={item.suggestionId}><div><span className="rules-badge">{stateLabel(item.sharedState)}</span><h2>{ruleNames[item.ruleId]?.[ja ? 1 : 0] ?? item.ruleId}</h2><p>{item.explanation?.translations?.[locale]?.observation ?? item.explanation?.observation ?? t("Open the evidence and explanation.", "根拠と説明を確認してください。")}</p><p className="rules-help">{t("Last observed", "最終観測")}: {dateText(item.lastObservedAt)}</p></div><button type="button" disabled={loading || pending || !safeId(item.suggestionId)} onClick={() => void openDetail(item)}>{t("See recommended response", "推奨される対応を見る")}</button></article>)}
        {listing?.page.nextCursor && <button type="button" disabled={loading} onClick={() => void load(listing.page.nextCursor!)}>{t("Next page", "次のページ")}</button>}
        {listing && <p className="rules-help">{t("List observed at", "一覧の取得時刻")}: {dateText(listing.page.snapshotAt)}</p>}
      </section> : <section className="rules-catalog" aria-label={t("Rule catalog", "ルールカタログ")}>
        <div className="rules-section-heading"><h2>{t("Base rules", "基礎ルール")}</h2><button type="button" disabled>{t("Evaluate", "評価する")}</button></div>
        <p className="rules-help">{t("Evaluation uses configured settings and authorized immutable inputs. All plans share the block features; usage allowances follow the server's current plan.", "評価には設定値と認可された入力の固定が必要です。ブロック機能は各プラン共通で、利用枠はサーバーの現在のプランに従います。")}</p>
        <div className="rules-rule-grid">{catalog?.rules.map((rule) => <article className="rules-rule" key={rule.ruleId}><span className="rules-badge">{t("Not active", "未有効化")}</span><h3>{ruleNames[rule.ruleId]?.[ja ? 1 : 0] ?? rule.ruleId}</h3><code>{rule.ruleId}</code></article>)}</div>
        <h2>{t("Operating patterns", "運営パターン")}</h2>
        <div className="rules-case-grid">{catalog?.cases.map((entry) => <details className="rules-case" key={entry.id}><summary><span>{caseNames[entry.id]?.[ja ? 1 : 0] ?? entry.id}</span><span className="rules-input-state">{entry.sourceMappings.every((source) => source.confirmed) ? t("Connection mapped", "接続先を照合済み") : t("Input unconfirmed", "入力が未確認")}</span></summary><p>{entry.audience === "RESTRICTED_STAFF" ? t("Restricted to authorized staff. This does not appear in general engagement views.", "認可された担当者に限定し、一般の活動画面には表示しません。") : t("Only the current server's authorized scope is evaluated.", "現在のサーバーで認可された範囲だけを扱います。")}</p><ul>{entry.sourceMappings.map((source) => <li key={source.id}><strong>{source.confirmed ? t("Mapped input", "照合済みの入力") : t("Connection needs confirmation", "接続の確認が必要")}</strong><p>{inputDescription(entry.id, source.purpose)}</p>{source.codeRefs?.length ? <p>{t("Registered source references", "登録された情報源の参照")}: {source.codeRefs.join(", ")}</p> : <p>{t("No confirmed production source is registered.", "稼働用の情報源はまだ確認されていません。")}</p>}</li>)}</ul><p className="rules-help">{t("Review-only action candidates", "確認用の操作候補")}: {entry.actions.length}</p></details>)}</div>
      </section>}
    </>}
    {confirmation && <div className="rules-confirm" role="dialog" aria-modal="true" aria-labelledby="rules-confirm-title" onKeyDown={(event) => {
      if (event.key === "Escape" && !pending) {event.preventDefault(); setConfirmation(null);}
      if (event.key === "Tab") {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),select:not(:disabled),a[href]")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
      }
    }}><div><h2 id="rules-confirm-title">{actionLabels[confirmation.action]}</h2><p>{confirmation.action === "reject" ? t("This rejection is shared with the server and suppresses the same issue lineage. It does not apply or delete anything.", "却下はサーバー全体で共有され、同じ課題の再提示を抑止します。適用や削除は行いません。") : t("This choice changes your personal suggestion state only.", "自分の提案の表示状態だけを変更します。")}</p>
      {confirmation.action === "reject" && <label>{t("Reason", "理由")}<select value={rejectReason} onChange={(event) => setRejectReason(event.target.value)}>{([ ["NOT_APPLICABLE", "Not applicable", "対象外"], ["INCORRECT", "Incorrect observation", "観測が不正確"], ["OUTDATED", "Outdated", "情報が古い"], ["DUPLICATE", "Duplicate", "重複"], ["UNSAFE", "Safety concern", "安全上の問題"], ["OTHER", "Other", "その他"] ] as const).map(([value, en, jp]) => <option value={value} key={value}>{t(en, jp)}</option>)}</select></label>}
      <div className="rules-buttons"><button type="button" autoFocus disabled={pending} onClick={() => setConfirmation(null)}>{t("Cancel", "取り消す")}</button><button type="button" disabled={pending} onClick={() => void confirm()}>{pending ? t("Saving…", "保存中…") : t("Confirm choice", "この選択を保存")}</button></div></div></div>}
  </section>;
}
