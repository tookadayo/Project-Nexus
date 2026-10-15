"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {
  changedSettings, participationGoals, pollDelay, problemFor, selectedScope,
  setupPatch, setupReturnUrl, validTimezone,
  type ParticipationGoal, type SetupCandidates, type SetupDraft, type SetupLocale,
  type SetupProblem, type SetupSettings, type SetupStatus,
} from "./model";

type Pending = {id: string; kind: "verify" | "draft" | "apply"};
type MutationResult = SetupDraft | {settingsRevision: number; complete?: boolean};
const inFlight = new Map<string, Promise<Response>>();

function confirmedResult(kind: Pending["kind"], value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (kind === "verify") return result.state === "VERIFIED";
  if (kind === "apply") return result.complete === true && Number.isInteger(result.settingsRevision);
  return typeof result.id === "string" && Number.isInteger(result.version) && Number.isInteger(result.settingsRevision) && Boolean(result.settings && typeof result.settings === "object");
}

function sharedRead(url: string, guildId: string) {
  const active = inFlight.get(url);
  if (active) return active.then(response => response.clone());
  const request = fetch(url, {headers: {"X-Nexus-Guild": guildId}, credentials: "same-origin", cache: "no-store"});
  inFlight.set(url, request);
  void request.finally(() => { if (inFlight.get(url) === request) inFlight.delete(url); }).catch(() => {});
  return request.then(response => response.clone());
}

const goalCopy: Record<ParticipationGoal, [string, string]> = {
  reply: ["返信する", "Reply"], lfg: ["仲間を探す", "Find a group"], voice: ["ボイスに参加する", "Join voice"],
  event: ["イベントに参加する", "Join events"], feedback: ["感想を伝える", "Give feedback"],
  bug: ["不具合を報告する", "Report bugs"], playtest: ["プレイテストに参加する", "Join playtests"],
};

export function SetupWizard({locale, guildId, installUrl, editing = false}: {locale: SetupLocale; guildId: string; installUrl: string | null; editing?: boolean}) {
  const t = useCallback((ja: string, en: string) => locale === "ja" ? ja : en, [locale]);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [values, setValues] = useState<SetupSettings | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [candidates, setCandidates] = useState<SetupCandidates | null>(null);
  const [candidateFailure, setCandidateFailure] = useState(false);
  const [problem, setProblem] = useState<SetupProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [step, setStep] = useState(0);
  const [scopeEditing, setScopeEditing] = useState(false);
  const [scopeConsent, setScopeConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pollEnded, setPollEnded] = useState(false);
  const [query, setQuery] = useState("");
  const [leaveDialog, setLeaveDialog] = useState(false);
  const started = useRef(Date.now());
  const verifyStarted = useRef(false);
  const requestLock = useRef(false);
  const installRequest = useRef<string | null>(null);
  const initialized = useRef(false);
  const allowLeave = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const leaveRef = useRef<HTMLDialogElement>(null);
  const storageKey = `nexus.setup.request.${guildId}`;
  const endpoint = (operation: string) => `/data/setup/${operation}?guild=${encodeURIComponent(guildId)}`;

  const remember = useCallback((next: Pending | null) => {
    setPending(next);
    try { if (next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey); } catch { /* Memory state still prevents accidental resubmission. */ }
  }, [storageKey]);

  const readStatus = useCallback(async (replace = false) => {
    setLoading(true);
    try {
      const response = await sharedRead(`/data/setup/status?guild=${encodeURIComponent(guildId)}`, guildId);
      const body = await response.json() as SetupStatus & {error?: string};
      if (!response.ok) { setProblem(problemFor(body.error ?? "UNAVAILABLE", response.status)); return; }
      if (!mounted.current) return;
      if (!["LINK_REQUIRED", "SETUP_REQUIRED", "COMPLETE", "BOT_REQUIRED"].includes(body.state) || (["SETUP_REQUIRED", "COMPLETE"].includes(body.state) && !body.settings)) { setProblem("UNAVAILABLE"); return; }
      setStatus(body);
      setProblem(null);
      if (body.settings && (!initialized.current || replace)) {
        const savedValues = body.draft?.appliedRevision == null && body.draft ? body.draft.settings : body.settings;
        setValues(!body.existing && !body.draft ? {...savedValues, analysisScope: {mode: "include", channelIds: []}} : savedValues);
        setDraft(body.draft ?? null);
        setScopeEditing(!body.existing);
        initialized.current = true;
        setReviewed(false);
        setScopeConsent(false);
        setSaved(false);
      }
    } catch { if (mounted.current) setProblem("UNAVAILABLE"); }
    finally { if (mounted.current) setLoading(false); }
  }, [guildId]);

  const readCandidates = useCallback(async () => {
    setCandidateFailure(false);
    try {
      const response = await sharedRead(`/data/setup/candidates?guild=${encodeURIComponent(guildId)}`, guildId);
      if (!response.ok) throw new Error("UNAVAILABLE");
      const body = await response.json() as SetupCandidates;
      if (!Array.isArray(body.channels) || !Array.isArray(body.roles)) throw new Error("UNAVAILABLE");
      if (mounted.current) setCandidates(body);
    } catch { if (mounted.current) setCandidateFailure(true); }
  }, [guildId]);

  function acceptMutation(kind: Pending["kind"], result: MutationResult) {
    if (!mounted.current) return;
    if (kind === "draft" && "id" in result && "settings" in result) {
      setDraft(result);
      setValues(result.settings);
      setSaved(true);
      setReviewed(false);
    }
    if (kind === "apply" && "settingsRevision" in result) {
      window.location.assign(setupReturnUrl(guildId));
    }
    if (kind === "verify") void readStatus(true);
  }

  async function mutate(kind: Pending["kind"], body: Record<string, unknown>) {
    if (requestLock.current || pending) return;
    requestLock.current = true;
    setBusy(true);
    setProblem(null);
    const request = {id: crypto.randomUUID(), kind};
    remember(request);
    try {
      const response = await fetch(endpoint(kind), {
        method: "POST", headers: {"Content-Type": "application/json", "X-Nexus-Guild": guildId}, credentials: "same-origin",
        body: JSON.stringify({...body, requestId: request.id}),
      });
      const result = await response.json() as MutationResult & {error?: string};
      if (!response.ok) {
        // A definite rejection is distinct from a lost response. Server 5xx may
        // have occurred after commit, so reconcile by request ID in that case.
        if (response.status >= 500) return;
        remember(null);
        setProblem(problemFor(result.error ?? "INVALID", response.status));
        return;
      }
      if (!confirmedResult(kind, result)) return;
      remember(null);
      acceptMutation(kind, result);
    } catch { /* Retain only the request ID; never submit another write automatically. */ }
    finally { requestLock.current = false; setBusy(false); }
  }

  async function checkResult() {
    if (!pending || requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    try {
      const response = await sharedRead(endpoint(`requests/${pending.id}`), guildId);
      if (!response.ok) return;
      const body = await response.json() as MutationResult & {state?: string; result?: MutationResult};
      if (body.state === "NOT_FOUND") return;
      const kind = pending.kind;
      if (!confirmedResult(kind, body.result ?? body)) return;
      remember(null);
      acceptMutation(kind, body.result ?? body);
      if (kind !== "apply") await readStatus();
    } catch { /* Keep the unresolved request visible and do not repeat it. */ }
    finally { requestLock.current = false; setBusy(false); }
  }

  useEffect(() => {
    mounted.current = true;
    try {
      const remembered = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Pending | null;
      if (remembered && /^[0-9a-f-]{36}$/i.test(remembered.id) && ["verify", "draft", "apply"].includes(remembered.kind)) setPending(remembered);
    } catch { /* A corrupted browser hint grants no authority. */ }
    void readStatus();
    return () => { mounted.current = false; };
  }, [readStatus, storageKey]);

  useEffect(() => {
    if (status?.state === "COMPLETE" && !editing && !pending && !busy) window.location.replace(setupReturnUrl(guildId));
    if ((status?.state === "SETUP_REQUIRED" || (editing && status?.state === "COMPLETE")) && !candidates && !candidateFailure) void readCandidates();
    // Automatic connection confirmation is the next step of the user's server
    // selection. Its request is one-shot and still checked by the API.
    if (status?.state === "LINK_REQUIRED" && !verifyStarted.current && !pending && !busy && !problem) {
      verifyStarted.current = true;
      void mutate("verify", {});
    }
    // Mutations use a synchronous lock; including mutable function identities
    // would initiate another confirmation on every input change.
  }, [status?.state, pending, busy, problem, candidates, candidateFailure, guildId, readCandidates, editing]);

  useEffect(() => {
    if (status?.state !== "BOT_REQUIRED" && problem !== "INSTALL" && problem !== "UNAVAILABLE") return;
    if (pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      const delay = pollDelay(Date.now() - started.current);
      if (delay === null) { setPollEnded(true); return; }
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => { void readStatus().then(schedule); }, delay);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [status?.state, problem, pending, readStatus]);

  useEffect(() => {
    if (leaveDialog) leaveRef.current?.showModal(); else leaveRef.current?.close();
  }, [leaveDialog]);

  const dirty = Boolean(status?.settings && values && changedSettings(draft?.settings ?? status.settings, values).length);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (allowLeave.current) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const update = (patch: Partial<SetupSettings>) => { setValues(current => current ? {...current, ...patch} : current); setSaved(false); setReviewed(false); setScopeConsent(false); };
  const changeStep = (next: number) => { setStep(next); setQuery(""); requestAnimationFrame(() => heading.current?.focus()); };
  const retry = () => { started.current = Date.now(); setPollEnded(false); verifyStarted.current = false; void readStatus(); };
  async function beginInstall() {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    // Open from the click gesture; the unprivileged blank tab receives only the
    // server-generated Discord URL after the introduction request is recorded.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    installRequest.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint("requests"), {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json", "X-Nexus-Guild": guildId}, body: JSON.stringify({requestId: installRequest.current})});
      const result = await response.json() as {installUrl?: string; error?: string};
      if (!response.ok || !result.installUrl) { tab?.close(); setProblem(problemFor(result.error ?? "UNAVAILABLE", response.status)); return; }
      const url = new URL(result.installUrl);
      if (url.origin !== "https://discord.com" || url.pathname !== "/oauth2/authorize") throw new Error("INVALID_INSTALL_URL");
      if (tab) tab.location.href = url.href; else window.location.assign(url.href);
      started.current = Date.now();
      setPollEnded(false);
      void readStatus();
    } catch { tab?.close(); setProblem("UNAVAILABLE"); }
    finally { requestLock.current = false; setBusy(false); }
  }
  const timezoneValid = values ? validTimezone(values.timezone) : true;
  const scopeChanged = Boolean(status?.settings && values && JSON.stringify(status.settings.analysisScope) !== JSON.stringify(values.analysisScope));
  const disabled = busy || Boolean(pending) || Boolean(problem);
  const stepLabels = [t("言語と日時", "Language & time"), t("確認する範囲", "Observation scope"), t("通知・ロール・目標", "Notifications, roles & goals"), t("確認して適用", "Review & apply")];
  const shortStepLabels = [t("言語・日時", "Language"), t("範囲", "Scope"), t("通知など", "Options"), t("確認", "Review")];
  const fieldLabels = {
    uiLanguage: t("言語", "Language"), timezone: t("タイムゾーン", "Time zone"), analysisScope: t("確認する範囲", "Observation scope"),
    helperChannelId: t("担当通知の送信先", "Helper notification channel"), managerRoleIds: t("管理ロール", "Manager roles"), newMemberGoals: t("参加の目標", "Participation goals"),
  };
  const problemText = problem === "SESSION" ? t("ログインの有効期限が切れました。もう一度ログインしてください。", "Your session expired. Sign in again.")
    : problem === "PERMISSION" ? t("このサーバーを設定する権限がありません。現在の管理資格を確認してください。", "You do not have permission to configure this server. Check your current management access.")
    : problem === "BETA" ? t("このサーバーの利用条件または無料招待の状態を確認してください。Botを追加するだけでは利用を開始できません。", "Review this server’s eligibility and free invitation status. Installing the bot alone does not grant access.")
    : problem === "CONFLICT" ? t("別の画面で変更されています。下書きを上書きせず、最新の内容を読み直してください。", "Settings changed elsewhere. Reload the latest version before saving.")
    : problem === "INVALID" ? t("入力を確認してください。変更は適用されていません。", "Review your input. The changes were not applied.")
    : t("管理権限または接続を確認できません。確認できるまで設定の変更を止めています。", "Permissions or the connection could not be verified. Changes are blocked until they can be checked.");
  const channelName = (id: string | null) => id ? candidates?.channels.find(c => c.id === id)?.name ?? t("参照先を現在確認できません（保存値を維持）", "Referenced channel unavailable (saved value preserved)") : t("未設定（任意）", "Not set (optional)");
  const scopeLabel = values?.analysisScope.mode === "all" ? t("既存の全体範囲を維持", "Keep the existing all-channel scope") : values?.analysisScope.mode === "exclude" ? t("既存の除外範囲を維持", "Keep the existing exclusion scope") : t(`${values?.analysisScope.channelIds.length ?? 0}件の指定チャンネル`, `${values?.analysisScope.channelIds.length ?? 0} selected channels`);
  const isScopeExcluded = (id: string) => Boolean(values && ((values.analysisScope.excludedChannelIds ?? []).includes(id) || (values.analysisScope.mode === "exclude" && values.analysisScope.channelIds.includes(id))));
  const showWizard = Boolean((status?.state === "SETUP_REQUIRED" || (editing && status?.state === "COMPLETE")) && values && !["SESSION", "PERMISSION", "BETA", "INSTALL"].includes(problem ?? ""));

  return <div className="setup-page" lang={locale}>
    <a className="setup-skip" href="#setup-main">{t("設定に移動", "Skip to setup")}</a>
    <header className="setup-header"><a className="setup-brand" href="/">NEXUS</a><nav aria-label={t("導入メニュー", "Setup navigation")}>
      <button type="button" onClick={() => dirty ? setLeaveDialog(true) : window.location.assign("/servers")}>{t("サーバーを選び直す", "Choose another server")}</button>
      <a href="/support">{t("ヘルプ", "Help")}</a><span className="setup-language">{locale === "ja" ? "日本語" : "English"}</span>
    </nav></header>
    <main className="setup-main" id="setup-main">
      <p className="setup-eyebrow">WEB SETUP</p>
      {(status?.guild?.name ?? status?.guildName) && <p className="setup-server">{status?.guild?.name ?? status?.guildName}</p>}
      <h1>{t("NEXUSを使う準備", "Get ready to use NEXUS")}</h1>
      <p className="setup-lede">{t("現在の管理資格とBotの参加を確認し、必要な設定だけをWebで整えます。", "We check your current access and bot installation, then help you complete only the settings you need.")}</p>

      {status?.installNotice && <p className="setup-help" role="status">{t("Discordへの設定案内: ", "Discord setup notice: ")}{
        status.installNotice.state === "UNKNOWN" ? t("送信結果を確認できないため、再送していません", "Send result unknown. Not sent again.")
          : status.installNotice.state === "WEB_ONLY" ? status.installNotice.reason === "DELIVERY_UNAVAILABLE"
            ? t("現在送信できるDiscordの案内先を確認できませんでした。", "An available Discord destination could not be verified.")
            : t("Webでのみ案内しています。Discordでの送信は確認されていません。", "Guidance is available on the web. No Discord delivery is confirmed.")
          : status.installNotice.state === "SUCCEEDED" ? t("送信済みです。", "Delivery confirmed.")
          : status.installNotice.state === "FAILED" ? t("送信できませんでした。この画面で設定を続けられます。", "Delivery failed. You can continue setup here.")
          : status.installNotice.state === "SENDING" ? t("送信結果を確認中です。", "Checking delivery.")
          : t("未送信です。この画面で設定を続けられます。", "Not sent. You can continue setup here.")}{" "}{status.installNotice.nextAction === "OPEN_DASHBOARD"
            ? <a href={`/dashboard/${guildId}`}>{t("ダッシュボードを開く", "Open dashboard")}</a>
            : t("Discordの案内が届かない場合も、この画面から設定を続けられます。", "You can continue setup here even if the Discord guide is unavailable.")}</p>}

      {pending && <section className="setup-note" role="alert"><h2>{t("処理結果を確認しています", "Check the request result")}</h2><p>{t("応答を確認できません。同じ変更を再送せず、要求の結果を照合してください。画面を更新しても新しい保存は行いません。", "The response is unconfirmed. Check the original request before saving again. Reloading this page does not repeat the change.")}</p><button type="button" disabled={busy} onClick={() => void checkResult()}>{busy ? t("確認中…", "Checking…") : t("保存結果を確認", "Check result")}</button></section>}

      {problem && problem !== "INSTALL" && <section className="setup-note setup-error" role="alert"><p>{problemText}</p>
        {problem === "SESSION" ? <a className="setup-button setup-primary" href="/auth/login">{t("ログインする", "Sign in")}</a>
          : problem === "CONFLICT" ? <button type="button" disabled={busy || Boolean(pending)} onClick={() => void readStatus(true)}>{t("未保存の編集を破棄して最新を読む", "Discard unsaved edits and reload")}</button>
          : <button type="button" disabled={busy || Boolean(pending)} onClick={retry}>{t("もう一度確認", "Check again")}</button>}
      </section>}

      {(status?.state === "BOT_REQUIRED" || problem === "INSTALL") && <section className="setup-status"><h2>{t("このサーバーにNEXUSを追加", "Add NEXUS to this server")}</h2><p>{t("Discordのサーバー用Botが実際に参加したことを確認してから、設定へ自動で進みます。", "Setup continues automatically after the server bot’s actual installation is verified.")}</p>
        {(status?.installUrl ?? installUrl) ? <button className="setup-primary" type="button" disabled={busy || Boolean(pending)} onClick={() => void beginInstall()}>{t("DiscordでNEXUSを追加（別タブ）", "Add NEXUS in Discord (new tab)")}</button> : <p>{t("招待URLを利用できません。運営者へお問い合わせください。", "An installation link is unavailable. Contact support.")}</p>}
        <p className="setup-help">{t("追加を終えたら、この画面へ戻ってください。", "Return here after installation.")}</p><button type="button" disabled={loading} onClick={retry}>{t("参加を再確認", "Check installation")}</button>
      </section>}

      {!showWizard && !problem && status?.state !== "BOT_REQUIRED" && <section className="setup-status" role="status"><span className="setup-spinner" aria-hidden="true"/>{status?.state === "COMPLETE" ? t("設定は完了しています。ダッシュボードへ移動します。", "Setup is complete. Opening your dashboard.") : t("本人・現在の資格・Botの参加を確認しています…", "Checking your identity, current access and bot installation…")}</section>}

      {pollEnded && <p className="setup-note" role="status">{t("自動確認をいったん終了しました。参加失敗とは限りません。「もう一度確認」から最新の状態を確認できます。", "Automatic checks have paused. This does not mean installation failed. Check again for the latest state.")} <button type="button" disabled={busy || Boolean(pending)} onClick={retry}>{t("もう一度確認", "Check again")}</button></p>}

      {showWizard && values && status && <>
        {status.existing && <p className="setup-note">{t("既存の設定があります。保存済みの値と稼働状態を維持し、不足している項目だけ確認します。", "Existing settings found. Saved values and current activity are preserved while you review missing items.")}</p>}
        <div className="setup-layout"><aside><ol className="setup-steps" aria-label={t("設定の区分", "Setup sections")}>{stepLabels.map((label, index) => <li key={index}><button type="button" aria-label={`${index + 1}. ${label}`} aria-current={step === index ? "step" : undefined} onClick={() => changeStep(index)}><span className="setup-step-number" aria-hidden="true">{index + 1}</span><span className="setup-step-full" aria-hidden="true">{label}</span><span className="setup-step-short" aria-hidden="true">{shortStepLabels[index]}</span></button></li>)}</ol><p className="setup-revision">{t(`現在の設定: ${status.settingsRevision}版`, `Applied settings: version ${status.settingsRevision}`)}{draft && <><br/>{t(`下書き: ${draft.version}版`, `Draft: version ${draft.version}`)}</>}</p>{dirty && <p className="setup-unsaved">{t("未保存の編集があります", "You have unsaved changes")}</p>}</aside>
        <section className="setup-panel" aria-labelledby="setup-section-heading"><h2 id="setup-section-heading" tabIndex={-1} ref={heading}>{stepLabels[step]}</h2>
          {step === 0 && <><p>{t("言語と、予定や日時の表示に使う地域を選びます。", "Choose the language and time zone used for schedules and date displays.")}</p>
            <label className="setup-field"><span>{t("表示言語", "Display language")}</span><select value={values.uiLanguage} disabled={disabled} onChange={e => update({uiLanguage: e.target.value as SetupSettings["uiLanguage"]})}><option value="auto">{t("自動", "Automatic")}</option><option value="ja">日本語</option><option value="en">English</option><option value="bilingual">{t("日本語と英語", "Japanese & English")}</option></select></label>
            <label className="setup-field"><span>{t("タイムゾーン", "Time zone")}</span><input value={values.timezone} maxLength={64} list="setup-timezones" aria-invalid={!timezoneValid} aria-describedby="setup-timezone-help setup-timezone-error" disabled={disabled} onChange={e => update({timezone: e.target.value})} autoCapitalize="none" spellCheck={false}/></label><datalist id="setup-timezones">{["UTC", "Asia/Tokyo", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Australia/Sydney"].map(zone => <option key={zone} value={zone}/>)}</datalist>
            <p className="setup-help" id="setup-timezone-help">{t("Asia/Tokyoなどの地域名を指定します。端末の地域が変わっても保存した設定は変わりません。", "Enter a region such as Asia/Tokyo. Changing your device’s region does not change the saved setting.")}</p>
            {!timezoneValid && <p className="setup-inline-error" id="setup-timezone-error" role="alert">{t("有効なタイムゾーンを入力してください。例: Asia/Tokyo", "Enter a valid time zone, for example Asia/Tokyo.")}</p>}
            {timezoneValid && <p className="setup-tz-preview">{t("表示例: ", "Example: ")}{new Intl.DateTimeFormat(locale, {timeZone: values.timezone, dateStyle: "medium", timeStyle: "short"}).format(new Date("2026-10-15T09:00:00Z"))} ({values.timezone})</p>}
          </>}
          {step === 1 && <><p>{t("分析の対象範囲です。自動化の送信許可とは別に管理します。", "This is the observation scope for analytics. Automation sending permissions are managed separately.")}</p><p className="setup-note">{scopeLabel}{Boolean(values.analysisScope.excludedChannelIds?.length) && <><br/>{t("明示的な除外設定も維持します。", "Explicit exclusions are also preserved.")}</>}</p>
            {!scopeEditing ? <button type="button" disabled={disabled || !candidates} onClick={() => { setScopeEditing(true); setQuery(""); }}>{t("チャンネルを指定して変更する", "Choose a new channel selection")}</button> : <>
              <p className="setup-help">{t("この一覧で選んだチャンネルだけを指定範囲にします。カテゴリは子チャンネルを選択します。", "Only channels selected here become the explicit scope. Choose the child channels of a category.")}</p>
              <label className="setup-field"><span>{t("チャンネル名で検索", "Search channels")}</span><input value={query} onChange={e => setQuery(e.target.value)} type="search"/></label>
              {candidates && <><div className="setup-options">{candidates.channels.filter(c => c.type !== 4 && c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(channel => <label className="setup-check" key={channel.id}><input type="checkbox" disabled={disabled || isScopeExcluded(channel.id)} checked={values.analysisScope.mode === "include" && values.analysisScope.channelIds.includes(channel.id)} onChange={e => { const current = values.analysisScope.mode === "include" ? values.analysisScope.channelIds : []; update({analysisScope: selectedScope(values.analysisScope, e.target.checked ? [...current, channel.id] : current.filter(id => id !== channel.id), candidates.channels)}); }}/><span>#{channel.name}{isScopeExcluded(channel.id) && <small>{t("既存の除外設定で対象外", "Excluded by the existing scope")}</small>}</span></label>)}{!candidates.channels.some(c => c.type !== 4 && c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p>{t("条件に合う項目はありません。", "No matching items were found.")}</p>}</div><button type="button" disabled={disabled} onClick={() => update({analysisScope: selectedScope(values.analysisScope, [], candidates.channels)})}>{t("選択を空にする（確認対象なし）", "Clear selection (observe no channels)")}</button></>}
            </>}
            {candidateFailure && <p className="setup-inline-error" role="alert">{t("候補を取得できません。保存済みの範囲は維持しています。", "Candidates could not be retrieved. The saved scope is preserved.")} <button type="button" onClick={() => void readCandidates()}>{t("候補を再取得", "Fetch candidates again")}</button></p>}
            {!candidates && !candidateFailure && <p role="status">{t("閲覧できる候補を確認しています…", "Checking available candidates…")}</p>}
            <p className="setup-help">{t("非公開・権限外・STAFF・利用できないスレッドは候補へ追加しません。対象が取得できないだけでは、既存の設定から削除しません。", "Private, inaccessible, staff-only and unavailable threads are excluded. Missing candidates alone never remove saved references.")}</p>
          </>}
          {step === 2 && <><p>{t("以下は任意です。空欄のままでも初期設定を完了できます。", "These settings are optional. You can finish setup without selecting them.")}</p>
            <label className="setup-field"><span>{t("担当通知のチャンネル（任意）", "Helper notification channel (optional)")}</span><select value={values.helperChannelId ?? ""} disabled={disabled || !candidates || values.helperEnabled} onChange={e => update({helperChannelId: e.target.value || null})}><option value="">{t("設定しない", "Not set")}</option>{values.helperChannelId && !candidates?.channels.some(c => c.id === values.helperChannelId) && <option value={values.helperChannelId}>{t("保存済みの参照を維持", "Keep saved reference")}</option>}{candidates?.channels.filter(c => [0, 5].includes(c.type)).map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
            <p className="setup-help">{values.helperEnabled ? t("既存の通知は有効のままです。通知機能の切替は設定画面で行います。", "Existing helper notifications remain enabled. Change that feature separately in Settings.") : t("通知先を選んでも通知は有効になりません。", "Choosing a channel does not enable notifications.")}</p>
            <fieldset><legend>{t("NEXUSを管理するロール（任意）", "NEXUS manager roles (optional)")}</legend><p className="setup-help">{t("メンバー個人ではなく、既存のDiscordロールを選びます。ロールを付与する操作ではありません。最大20件です。", "Choose existing Discord roles, rather than individual members. This does not assign roles. Up to 20 roles.")}</p>{candidates && <div className="setup-options">{candidates.roles.map(role => <label className="setup-check" key={role.id}><input type="checkbox" checked={values.managerRoleIds.includes(role.id)} disabled={disabled || (!values.managerRoleIds.includes(role.id) && values.managerRoleIds.length >= 20)} onChange={e => update({managerRoleIds: e.target.checked ? [...values.managerRoleIds, role.id] : values.managerRoleIds.filter(id => id !== role.id)})}/><span>{role.name}</span></label>)}{!candidates.roles.length && <p>{t("選択できるロールはありません。", "No selectable roles were found.")}</p>}</div>}{values.managerRoleIds.some(id => !candidates?.roles.some(role => role.id === id)) && <p className="setup-help">{t("現在確認できない保存済みのロール参照を維持しています。", "Saved role references that are currently unavailable are preserved.")}</p>}</fieldset>
            {candidateFailure && <p className="setup-inline-error" role="alert">{t("チャンネルとロールを取得できません。未取得を0件とは扱っていません。", "Channels and roles could not be retrieved. This is not treated as an empty result.")} <button type="button" onClick={() => void readCandidates()}>{t("候補を再取得", "Fetch candidates again")}</button></p>}
            <fieldset><legend>{t("新しいメンバーの参加の目標（任意）", "Participation goals for new members (optional)")}</legend><p className="setup-help">{t("期待する参加行動を選びます。数値目標や個人の評価ではありません。", "Choose participation activities to encourage. These are not numeric targets or personal ratings.")}</p>{participationGoals.map(goal => <label className="setup-check" key={goal}><input type="checkbox" checked={values.newMemberGoals.includes(goal)} disabled={disabled} onChange={e => update({newMemberGoals: e.target.checked ? [...values.newMemberGoals, goal] : values.newMemberGoals.filter(value => value !== goal)})}/><span>{goalCopy[goal][locale === "ja" ? 0 : 1]}</span></label>)}</fieldset>
          </>}
          {step === 3 && <><p>{t("確認した設定を適用します。保存だけで自動化や新しい通知を開始することはありません。", "Apply the settings you reviewed. Saving alone does not start automations or new notifications.")}</p>
            <dl className="setup-review"><dt>{fieldLabels.uiLanguage}</dt><dd>{values.uiLanguage === "ja" ? "日本語" : values.uiLanguage === "en" ? "English" : values.uiLanguage === "bilingual" ? t("日本語と英語", "Japanese & English") : t("自動", "Automatic")}</dd><dt>{fieldLabels.timezone}</dt><dd>{values.timezone}</dd><dt>{fieldLabels.analysisScope}</dt><dd>{scopeLabel}</dd><dt>{fieldLabels.helperChannelId}</dt><dd>{channelName(values.helperChannelId)}<br/>{values.helperEnabled ? t("既存の通知: 有効", "Existing notifications: enabled") : t("通知: 無効を維持", "Notifications: remain disabled")}</dd><dt>{fieldLabels.managerRoleIds}</dt><dd>{values.managerRoleIds.length ? values.managerRoleIds.map(id => candidates?.roles.find(role => role.id === id)?.name ?? t("保存済みのロール参照", "Saved role reference")).join("、") : t("未設定（任意）", "Not set (optional)")}</dd><dt>{fieldLabels.newMemberGoals}</dt><dd>{values.newMemberGoals.length ? values.newMemberGoals.map(goal => goalCopy[goal][locale === "ja" ? 0 : 1]).join("、") : t("未設定（任意）", "Not set (optional)")}</dd></dl>
            <p className="setup-help">{t("既存の目的プリセット、履歴、利用枠、設定のない機能は変更しません。", "Existing goal presets, history, usage and unrelated features are preserved.")}</p>
            <p>{t("変更する項目: ", "Fields to change: ")}{changedSettings(status.settings, values).map(key => fieldLabels[key]).join("、") || t("変更なし（不足確認のみ）", "No field changes (complete the review only)")}</p>
            {scopeChanged && <label className="setup-check setup-confirm"><input type="checkbox" checked={scopeConsent} disabled={disabled} onChange={e => setScopeConsent(e.target.checked)}/><span>{t("分析の範囲を変更する影響を確認しました。選択した範囲を適用します。", "I reviewed the observation scope change and want to apply the selected scope.")}</span></label>}
            {draft && !dirty && <label className="setup-check setup-confirm"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={e => setReviewed(e.target.checked)}/><span>{t("この下書きの内容を確認しました。現在の設定へ適用します。", "I reviewed this saved draft and want to apply it to the current settings.")}</span></label>}
            {!timezoneValid && <p className="setup-inline-error" role="alert">{t("言語と日時の画面でタイムゾーンを修正してください。", "Correct the time zone in Language & time.")}</p>}
          </>}
          <div className="setup-actions">
            <button type="button" disabled={busy} onClick={() => dirty ? setLeaveDialog(true) : window.location.assign("/servers")}>{t("取消", "Cancel")}</button>
            {step > 0 && <button type="button" disabled={busy} onClick={() => changeStep(step - 1)}>{t("戻る", "Back")}</button>}
            <button type="button" disabled={disabled || !timezoneValid} onClick={() => void mutate("draft", {draftId: draft?.id, expectedDraftRevision: draft?.version, patch: setupPatch(draft?.settings ?? status.settings, values)})}>{busy ? t("処理中…", "Working…") : t("下書きを保存", "Save draft")}</button>
            {step < 3 ? <button className="setup-primary setup-next" type="button" disabled={!timezoneValid || busy} onClick={() => changeStep(step + 1)}>{t("次へ", "Next")}</button>
              : <button className="setup-primary setup-next" type="button" disabled={disabled || !draft || dirty || !reviewed || !timezoneValid || (scopeChanged && !scopeConsent)} onClick={() => draft && void mutate("apply", {draftId: draft.id, expectedDraftRevision: draft.version, expectedSettingsRevision: draft.settingsRevision, ...(scopeChanged ? {confirmScopeChange: true} : {})})}>{t("確認した設定を適用", "Apply reviewed settings")}</button>}
          </div>
          <p className="setup-live" role="status" aria-live="polite">{busy ? t("結果を確認しています。しばらくお待ちください。", "Checking the result. Please wait.") : saved ? t("下書きを保存しました。現在の設定はまだ変わっていません。", "Draft saved. Current settings have not changed yet.") : draft && !dirty ? t("保存済みの下書きです。確認後に適用できます。", "This draft is saved. Review it before applying.") : t("下書き保存と設定への適用は別の操作です。", "Saving a draft and applying settings are separate actions.")}</p>
        </section></div>
      </>}
      <p className="setup-plan">{t("無料招待Betaの利用条件が適用されます。この操作による購入・自動課金はありません。", "Free invitation Beta conditions apply. This action does not purchase anything or enable automatic billing.")}</p>
    </main>
    <dialog ref={leaveRef} className="setup-status" onCancel={event => { event.preventDefault(); setLeaveDialog(false); }}><h2>{t("未保存の編集があります", "You have unsaved changes")}</h2><p>{t("保存済みの下書きは残ります。未保存の編集を破棄してサーバー選択へ戻ります。", "The saved draft is kept. Return to server selection and discard unsaved edits.")}</p><div className="setup-actions"><button autoFocus type="button" onClick={() => setLeaveDialog(false)}>{t("編集を続ける", "Keep editing")}</button><button type="button" onClick={() => { allowLeave.current = true; window.location.assign("/servers"); }}>{t("破棄して戻る", "Discard and return")}</button></div></dialog>
  </div>;
}

