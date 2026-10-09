/* This client talks only to the separate loopback operator process. */
const words = {
  ja: {
    loginTitle: "このPCで運営にログイン",
    localOnly:
      "無料・招待制 Beta の運営画面です。このPC上でのみ利用してください。",
    password: "運営パスワード",
    login: "ログイン",
    logout: "ログアウト",
    setup:
      "初回設定とパスワード再設定は、所有者がこのPCのターミナルから行います。設定されていない場合は運営手順を確認してください。",
    guilds: "サーバー一覧",
    register: "招待候補を追加",
    audit: "操作履歴",
    sessions: "運営セッション",
    reload: "最新の状態を取得",
    guildId: "Guild ID（DiscordサーバーID）",
    reason: "操作理由",
    registerHelp:
      "Botが参加している対象をIDで照合します。追加しただけでは収集は始まりません。",
    cancel: "キャンセル",
    confirm: "確認して実行",
    footer:
      "日時は UTC。最大10サーバー。公開判断とWindows 11実機確認は別途必要です。",
    active: "有効",
    paused: "一時停止",
    expired: "期限切れ",
    registered: "未有効",
    deleting: "削除処理中",
    deleted: "削除済み",
    revoked: "招待撤回",
    bot: "Botの参加",
    present: "確認済み",
    unknown: "未確認",
    first: "初回有効化",
    end: "招待終了（UTC）",
    generation: "確認した状態の番号",
    activate: "有効化（30日）",
    pause: "一時停止",
    resume: "再開",
    extend: "期限を延長",
    revoke: "招待を取り消す",
    unlink: "連携を解除",
    delete: "データ削除",
    limits: "利用上限",
    monthly: "月の分析回数（UTC暦月）",
    daily: "日の分析回数（UTC）",
    guildPending: "このサーバーの待機件数",
    globalPending: "全体の待機上限（有効なサーバーの最小値を適用）",
    save: "上限を保存",
    applyExpiry: "期限を変更",
    impact:
      "対象サーバーの状態と利用権を更新します。待機中・実行中の分析は取消され、未使用の予約枠を解放します。",
    eraseImpact:
      "新しい収集と仕事を停止し、利用権を失効します。対象サーバーのデータを速やかに削除します。30日待ちません。",
    empty: "登録したサーバーはありません。",
    select: "一覧からサーバーを選んでください。",
    usage: "分析枠と消費",
    noUsage: "表示できる分析利用の記録はありません。",
    quantity: "付与",
    reserved: "予約中",
    consumed: "消費済み",
    history: "直近の操作",
    waiting: "待機中",
    running: "実行中",
    attention: "削除の要対応",
    capacity: "有効なサーバー",
    success: "操作を完了しました。最新の状態を確認してください。",
    busy: "処理中…",
    error: "操作できませんでした。接続を確認して再試行してください。",
    stateChanged:
      "状態が変更されました。最新の状態を取得し、対象と影響を確認し直してください。",
    loginRequired:
      "ログインし直してください。連続した失敗は一時的に抑制されます。",
    csrf: "画面を読み込み直してから操作してください。",
    guildLimit:
      "有効なサーバーは最大10件です。空きができてから再開してください。",
    botUnavailable:
      "Botの参加と閲覧権限を確認できません。対象IDとBotの状態を確認してください。",
    invalidExpiry:
      "元の期限より後、かつ現在と元の期限の遅い方から30日以内のUTC日時を指定してください。",
    invalidState:
      "この状態では操作できません。期限と現在の状態を確認してください。",
    closed:
      "このサーバーは利用を停止しています。削除済みのデータを再有効化できません。",
    invalid: "入力内容と許容された上限を確認してください。",
    created: "開始",
    last: "最終利用",
    revocation: "失効",
    result: "結果",
    action: "操作",
    date: "日時（UTC）",
    request: "確認番号",
    retryImpact:
      "収集を再開せず、このサーバーの未完了の消去処理を再試行します。自動試行は最大5回・1日です。",
    login_audit: "運営ログイン",
    logout_audit: "運営ログアウト",
    password_reset: "パスワード再設定",
    session_expired: "セッション失効",
    invitation_expired: "招待期限による停止",
    restore_tombstones: "削除記録の復元時適用",
    request_audit: "操作受付",
    login_throttled: "ログイン抑制",
    succeeded: "完了",
    denied: "拒否",
    failed: "失敗",
    next: "変更後",
    retryDeletion: "削除を再試行",
    retrydeletion: "削除を再試行",
    deletionState: "削除の進捗",
    pending: "消去待ち",
    erased: "キューの消去待ち",
    done: "削除完了",
    attempts: "試行回数",
    botChecked: "Bot確認日時（UTC）",
  },
  en: {
    loginTitle: "Operator sign-in on this PC",
    localOnly:
      "Operations for the free, invited Beta. Use only on this host PC.",
    password: "Operator password",
    login: "Sign in",
    logout: "Sign out",
    setup:
      "The owner sets or resets the password in a local terminal on this PC. Follow the operations guide if credentials are missing.",
    guilds: "Servers",
    register: "Add invitation candidate",
    audit: "Operation history",
    sessions: "Operator sessions",
    reload: "Reload current state",
    guildId: "Guild ID (Discord server ID)",
    reason: "Reason",
    registerHelp:
      "Checks the server ID against the installed Bot. Registration does not start collection.",
    cancel: "Cancel",
    confirm: "Confirm and apply",
    footer:
      "Dates use UTC. Maximum 10 servers. Release approval and Windows 11 acceptance remain separate checks.",
    active: "Active",
    paused: "Paused",
    expired: "Expired",
    registered: "Not activated",
    deleting: "Deleting data",
    deleted: "Deleted",
    revoked: "Invitation revoked",
    bot: "Bot membership",
    present: "Confirmed",
    unknown: "Unconfirmed",
    first: "First activation",
    end: "Invitation ends (UTC)",
    generation: "Confirmed state version",
    activate: "Activate for 30 days",
    pause: "Pause",
    resume: "Resume",
    extend: "Extend expiry",
    revoke: "Revoke invitation",
    unlink: "Unlink server",
    delete: "Delete data",
    limits: "Usage limits",
    monthly: "Analyses per UTC calendar month",
    daily: "Analyses per UTC day",
    guildPending: "Waiting jobs for this server",
    globalPending: "Global waiting ceiling (strictest active setting applies)",
    save: "Save limits",
    applyExpiry: "Change expiry",
    impact:
      "Updates this server’s invitation and entitlement. Queued and running analyses are canceled; unused reservations are released.",
    eraseImpact:
      "Stops new collection and work, revokes access, and promptly deletes this server’s data. It does not wait 30 days.",
    empty: "No registered servers.",
    select: "Select a server from the list.",
    usage: "Analysis grants and usage",
    noUsage: "No analysis usage records are available.",
    quantity: "Granted",
    reserved: "Reserved",
    consumed: "Consumed",
    history: "Recent operations",
    waiting: "Waiting",
    running: "Running",
    attention: "Deletion needs attention",
    capacity: "Active servers",
    success: "Operation completed. Review the current state.",
    busy: "Working…",
    error:
      "The operation could not be completed. Check the connection and try again.",
    stateChanged:
      "The state changed. Reload and review the target and impact again.",
    loginRequired:
      "Sign in again. Repeated failed attempts are temporarily throttled.",
    csrf: "Reload this page before continuing.",
    guildLimit:
      "At most 10 servers can be active. Wait for a free slot before resuming.",
    botUnavailable:
      "Bot membership or read permission could not be confirmed. Check the server ID and Bot.",
    invalidExpiry:
      "Choose a UTC expiry after the current expiry, adding at most 30 days from the later of now or the current expiry.",
    invalidState:
      "This operation is unavailable in the current state. Check the expiry and state.",
    closed: "This server is unavailable. Deleted data cannot be reactivated.",
    invalid: "Check the input and permitted limits.",
    created: "Created",
    last: "Last used",
    revocation: "Revoked",
    result: "Result",
    action: "Operation",
    date: "Time (UTC)",
    request: "Reference",
    retryImpact:
      "Retries this server’s incomplete erasure without resuming collection. Automatic retries are limited to five attempts and one day.",
    login_audit: "Operator sign-in",
    logout_audit: "Operator sign-out",
    password_reset: "Password reset",
    session_expired: "Session expired",
    invitation_expired: "Invitation expired",
    restore_tombstones: "Deletion records applied on restore",
    request_audit: "Request",
    login_throttled: "Sign-in throttled",
    succeeded: "Completed",
    denied: "Denied",
    failed: "Failed",
    next: "After change",
    retryDeletion: "Retry deletion",
    retrydeletion: "Retry deletion",
    deletionState: "Deletion progress",
    pending: "Erasure queued",
    erased: "Queue scrub pending",
    done: "Deletion completed",
    attempts: "Attempts",
    botChecked: "Bot checked at (UTC)",
  },
};
let language =
    localStorage.getItem("nexus-operator-language") === "en" ? "en" : "ja",
  csrf = "",
  current = null,
  pending = null,
  selected = null,
  activeTab = "guilds",
  noticeKey = "",
  authGeneration = 0;
const $ = (id) => document.getElementById(id),
  t = (key) =>
    words[language][key] ||
    (language === "ja" ? "未確認の操作" : "Unconfirmed operation");
function element(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (className) n.className = className;
  return n;
}
function copy() {
  document.documentElement.lang = language;
  $("locale").value = language;
  document
    .querySelectorAll("[data-copy]")
    .forEach((n) => (n.textContent = t(n.dataset.copy)));
  $("logout").textContent = t("logout");
  if (noticeKey) $("notice").textContent = t(noticeKey);
}
function notice(key) {
  noticeKey = key;
  $("notice").textContent = t(key);
}
function errorKey(code) {
  return (
    {
      REVISION_CONFLICT: "stateChanged",
      IDEMPOTENCY_CONFLICT: "stateChanged",
      OPERATOR_LOGIN_REQUIRED: "loginRequired",
      CSRF_REQUIRED: "csrf",
      BETA_GUILD_LIMIT: "guildLimit",
      BETA_BOT_UNAVAILABLE: "botUnavailable",
      BETA_INVALID_EXPIRY: "invalidExpiry",
      BETA_INVALID_STATE: "invalidState",
      BETA_UNAVAILABLE: "closed",
      PRIVACY_DELETED: "closed",
      INVALID_REQUEST: "invalid",
      ENGLISH_REVIEW_REQUIRED: "englishReviewRequired",
      PUBLICATION_ALREADY_CURRENT: "stateChanged",
      PUBLICATION_NOT_PUBLISHED: "stateChanged",
      PUBLICATION_DRAFT_EMPTY: "stateChanged",
    }[code] || "error"
  );
}
function clearPrivateState() {
  authGeneration += 1;
  csrf = "";
  current = null;
  pending = null;
  selected = null;
  activeTab = "guilds";
  publicationState = null;
  publicationPending = null;
  publicationSubmission?.unlock();
  publicationSubmission = null;
  $("publication-confirm-form").removeAttribute("aria-busy");
  legalState = null;
  legalSaveRequest = null;
  publicationRead += 1;
  legalRead += 1;
  [
    "guild-list",
    "guild-detail",
    "overview",
    "audit",
    "sessions",
    "publications",
    "legal",
    "confirm-title",
    "confirm-target",
    "confirm-impact",
    "confirm-next",
    "publication-confirm-title",
    "publication-confirm-details",
    "publication-confirm-checks",
    "publication-confirm-status",
  ].forEach((id) => $(id).replaceChildren());
  [
    "register-form",
    "confirm-form",
    "publication-confirm-form",
    "login-form",
  ].forEach((id) => $(id).reset());
  ["confirmation", "publication-confirmation"].forEach((id) => $(id).close());
  $("workspace").hidden = true;
  $("logout").hidden = true;
  $("login").hidden = false;
}
async function api(path, body, requestCsrf = csrf) {
  const generation = authGeneration;
  let response, value;
  try {
    response = await fetch("/operator/" + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", "X-CSRF-Token": requestCsrf }
        : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    value = await response.json();
  } catch {
    if (generation !== authGeneration) throw new Error("STALE_RESPONSE");
    notice("error");
    throw new Error("OPERATOR_REQUEST_FAILED");
  }
  if (generation !== authGeneration) throw new Error("STALE_RESPONSE");
  if (!response.ok) {
    if (response.status === 401 || value.error === "OPERATOR_LOGIN_REQUIRED")
      clearPrivateState();
    notice(errorKey(value.error));
    throw new Error(value.error || "OPERATOR_REQUEST_FAILED");
  }
  return value;
}
function state(g) {
  return t(
    g.status === "ACTIVE" && new Date(g.expires_at) <= new Date()
      ? "expired"
      : {
          ACTIVE: "active",
          PAUSED:
            g.expires_at && new Date(g.expires_at) <= new Date()
              ? "expired"
              : "paused",
          REGISTERED: "registered",
          REVOKED: "revoked",
          DELETING: "deleting",
          DELETED: "deleted",
        }[g.status],
  );
}
const date = (value) =>
  value
    ? new Date(value)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "—";
function table(heads, rows) {
  const wrap = element("div", undefined, "table-wrap"),
    table = element("table"),
    tr = element("tr");
  heads.forEach((h) => tr.append(element("th", t(h))));
  const head = element("thead");
  head.append(tr);
  table.append(head);
  const body = element("tbody");
  rows.forEach((values) => {
    const row = element("tr");
    values.forEach((v) => row.append(element("td", v ?? "—")));
    body.append(row);
  });
  table.append(body);
  wrap.append(table);
  return wrap;
}
async function reload() {
  const [data, overview] = await Promise.all([api("guilds"), api("overview")]);
  $("guild-list").replaceChildren();
  if (!data.guilds.length) $("guild-list").append(element("p", t("empty")));
  data.guilds.forEach((g) => {
    const button = element("button", undefined, "server");
    button.append(
      element("strong", g.status === "DELETED" ? t("deleted") : g.guild_name),
      element("small", g.guild_id),
      element("span", state(g)),
    );
    button.onclick = () => {
      selected = g.guild_id;
      void detail(selected).catch(() => {
        /* api() shows the failure in the notice area. */
      });
    };
    $("guild-list").append(button);
  });
  $("overview").replaceChildren();
  const active = data.guilds.filter(
    (g) => g.status === "ACTIVE" && new Date(g.expires_at) > new Date(),
  ).length;
  [
    ["capacity", active + " / " + data.maximum],
    [
      "paused",
      data.guilds.filter(
        (g) => g.status === "PAUSED" && new Date(g.expires_at) > new Date(),
      ).length,
    ],
    [
      "expired",
      data.guilds.filter(
        (g) =>
          ["ACTIVE", "PAUSED"].includes(g.status) &&
          new Date(g.expires_at) <= new Date(),
      ).length,
    ],
    ["waiting", overview.work.waiting],
    ["running", overview.work.running],
    ["attention", overview.deletion.needs_attention],
  ].forEach(([key, value]) => {
    const card = element("div", undefined, "card");
    card.append(element("div", t(key)), element("div", value, "metric"));
    $("overview").append(card);
  });
  if (overview.needsAttention?.length) {
    const list = element("div");
    overview.needsAttention.forEach((row) => {
      const button = element("button", t("attention") + " · " + row.guild_id);
      button.onclick = () => {
        selected = row.guild_id;
        void tab("guilds")
          .then(() => detail(selected))
          .catch(() => {
            /* api() shows the failure in the notice area. */
          });
      };
      list.append(button);
    });
    $("overview").append(list);
  }
  if (selected) await detail(selected);
  else $("guild-detail").replaceChildren(element("p", t("select")));
}
function action(key, values = {}) {
  const button = element("button", t(key));
  button.onclick = () => confirmAction(key, values);
  return button;
}
function confirmAction(key, values) {
  if (!current) return;
  pending = {
    guildId: current.guild_id,
    generation: current.generation,
    action: key,
    requestId: crypto.randomUUID(),
    ...values,
  };
  $("confirm-title").textContent = t(key);
  $("confirm-target").textContent =
    current.guild_name + " · " + current.guild_id + " · " + state(current);
  $("confirm-impact").textContent = t(
    key === "retryDeletion"
      ? "retryImpact"
      : ["revoke", "unlink", "delete"].includes(key)
        ? "eraseImpact"
        : "impact",
  );
  const after = values.expiresAt
    ? date(values.expiresAt)
    : values.limits
      ? Object.entries(values.limits)
          .map(
            ([key, value]) =>
              t(key) + ": " + current.limits[key] + " → " + value,
          )
          .join(" · ")
      : t(
          {
            activate: "active",
            resume: "active",
            pause: "paused",
            revoke: "deleting",
            unlink: "deleting",
            delete: "deleting",
          }[key] || key,
        );
  $("confirm-next").textContent = t("next") + ": " + after;
  $("confirm-form").reset();
  $("confirmation").showModal();
}
async function detail(id) {
  const data = await api("guilds/" + id),
    g = data.invitation;
  current = g;
  const out = $("guild-detail");
  out.replaceChildren(
    element("h2", g.status === "DELETED" ? t("deleted") : g.guild_name),
    element("p", g.guild_id),
    element("strong", state(g)),
  );
  const dl = element("dl");
  [
    ["bot", t(g.bot_present ? "present" : "unknown")],
    ["botChecked", date(g.bot_checked_at)],
    ["first", date(g.activated_at)],
    ["end", date(g.expires_at)],
    ["generation", g.generation],
  ].forEach(([key, value]) =>
    dl.append(element("dt", t(key)), element("dd", value)),
  );
  out.append(dl);
  if (data.deletion) {
    out.append(
      element("h3", t("deletionState")),
      element(
        "p",
        t(data.deletion.state.toLowerCase()) +
          " · " +
          t("attempts") +
          ": " +
          data.deletion.attempts,
      ),
    );
    if (["PENDING", "ERASED"].includes(data.deletion.state))
      out.append(action("retryDeletion"));
  }

  if (!["DELETING", "DELETED", "REVOKED"].includes(g.status)) {
    const actions = element("div", undefined, "actions");
    (g.status === "REGISTERED"
      ? ["activate"]
      : g.status === "PAUSED" || new Date(g.expires_at) <= new Date()
        ? ["resume"]
        : ["pause"]
    ).forEach((key) => actions.append(action(key)));
    ["revoke", "unlink", "delete"].forEach((key) =>
      actions.append(action(key)),
    );
    out.append(actions);
    if (g.activated_at) {
      const form = element("form"),
        label = element("label"),
        input = element("input");
      input.type = "datetime-local";
      input.required = true;
      input.value = new Date(
        Math.max(Date.now(), new Date(g.expires_at).getTime()) + 86400000,
      )
        .toISOString()
        .slice(0, 16);
      label.append(element("span", t("end")), input);
      form.append(label, element("button", t("applyExpiry")));
      form.onsubmit = (event) => {
        event.preventDefault();
        confirmAction("extend", {
          expiresAt: new Date(input.value + "Z").toISOString(),
        });
      };
      out.append(element("h3", t("extend")), form);
    }
    const form = element("form");
    [
      ["monthly", 20],
      ["daily", 3],
      ["guildPending", 2],
      ["globalPending", 10],
    ].forEach(([key, max]) => {
      const label = element("label"),
        input = element("input");
      input.name = key;
      input.type = "number";
      input.min = "1";
      input.max = String(max);
      input.required = true;
      input.value = g.limits[key];
      label.append(element("span", t(key)), input);
      form.append(label);
    });
    form.append(element("button", t("save")));
    form.onsubmit = (event) => {
      event.preventDefault();
      confirmAction("limits", {
        limits: Object.fromEntries(
          [...new FormData(form)].map(([key, value]) => [key, Number(value)]),
        ),
      });
    };
    out.append(element("h3", t("limits")), form);
  }
  out.append(
    element("h3", t("usage")),
    data.grants.length
      ? table(
          ["quantity", "reserved", "consumed", "end"],
          data.grants.map((v) => [
            v.quantity,
            v.reserved,
            v.consumed,
            date(v.expires_at),
          ]),
        )
      : element("p", t("noUsage")),
    element("h3", t("history")),
    table(
      ["date", "action", "reason", "request"],
      data.history.map((v) => [
        date(v.occurred_at),
        t(
          {
            LOGIN: "login_audit",
            LOGOUT: "logout_audit",
            REQUEST: "request_audit",
          }[v.action] || v.action.toLowerCase(),
        ),
        v.reason,
        v.request_id,
      ]),
    ),
  );
}
async function tab(key) {
  activeTab = key;
  ["guilds", "register", "audit", "sessions", "publications", "legal"].forEach(
    (id) => ($(id).hidden = id !== key),
  );
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.setAttribute(
      "aria-current",
      button.dataset.tab === key ? "page" : "false",
    );
  });
  $("overview").hidden = ["publications", "legal"].includes(key);
  if (key === "publications") await loadPublications();
  if (key === "legal") await loadLegal();
  if (key === "audit") {
    const value = await api("audit");
    $("audit").replaceChildren(
      element("h1", t("audit")),
      table(
        ["date", "action", "guildId", "result", "reason", "request"],
        value.events.map((v) => [
          date(v.occurred_at),
          t(
            {
              LOGIN: "login_audit",
              LOGOUT: "logout_audit",
              REQUEST: "request_audit",
            }[v.action] || v.action.toLowerCase(),
          ),
          v.guild_id,
          t(v.result.toLowerCase()),
          v.reason,
          v.request_id,
        ]),
      ),
    );
  }
  if (key === "sessions") {
    const value = await api("sessions");
    $("sessions").replaceChildren(
      element("h1", t("sessions")),
      table(
        ["created", "last", "end", "revocation"],
        value.sessions.map((v) => [
          date(v.created_at),
          date(v.last_used_at),
          date(v.expires_at),
          date(v.revoked_at),
        ]),
      ),
    );
  }
}
async function start() {
  copy();
  const value = await api("session");
  if (!value.authenticated) clearPrivateState();
  csrf = value.csrf;
  $("login").hidden = value.authenticated;
  $("workspace").hidden = !value.authenticated;
  $("logout").hidden = !value.authenticated;
  if (value.authenticated) await reload();
}
$("locale").onchange = () => {
  language = $("locale").value;
  localStorage.setItem("nexus-operator-language", language);
  copy();
  // Text and labels change without discarding an unsaved bilingual draft.
  if (["publications", "legal"].includes(activeTab)) return;
  if (!$("workspace").hidden)
    void reload()
      .then(() => tab(activeTab))
      .catch(() => {
        /* api() shows the failure in the notice area. */
      });
};
$("login-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  const password = form.elements.password.value;
  const unlock = lockForm(form);
  notice("busy");
  try {
    // A rejected or expired session clears all private state, including CSRF.
    // Refresh only the login token; never restore private panels during recovery.
    if (!csrf) csrf = (await api("session")).csrf;
    const value = await api("session", {
      password,
    });
    csrf = value.csrf;
    form.reset();
    await start();
    notice("success");
  } catch {
    form.reset();
  } finally {
    unlock();
  }
};
$("register-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    await api("guilds", {
      action: "register",
      guildId: form.elements.guildId.value,
      reason: form.elements.reason.value,
      generation: null,
      requestId: crypto.randomUUID(),
    });
    form.reset();
    await tab("guilds");
    await reload();
    notice("success");
  } catch {
    /* api() shows the failure in the notice area. */
  }
};
$("confirm-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!pending) return;
  const submit = event.target.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    await api("guilds", {
      ...pending,
      reason: event.target.elements.reason.value,
    });
    $("confirmation").close();
    await reload();
    notice("success");
  } catch {
    pending = null;
    $("confirmation").close();
  } finally {
    submit.disabled = false;
  }
};
$("cancel").onclick = () => {
  $("confirmation").close();
  pending = null;
};
$("logout").onclick = async () => {
  const requestCsrf = csrf;
  clearPrivateState();
  try {
    await api("logout", {}, requestCsrf);
    await start();
  } catch {
    /* api() shows the failure in the notice area. */
  }
};
$("reload").onclick = () => {
  void (
    ["publications", "legal"].includes(activeTab) ? tab(activeTab) : reload()
  ).catch(() => {
    /* api() shows the failure in the notice area. */
  });
};
document.querySelectorAll("[data-tab]").forEach(
  (button) =>
    (button.onclick = () => {
      void tab(button.dataset.tab).catch(() => {
        /* api() shows the failure in the notice area. */
      });
    }),
);

// Publication bodies and owner details live only in authenticated memory/DOM.
let publicationState = null,
  publicationPending = null,
  publicationSubmission = null,
  publicationRead = 0,
  legalState = null,
  legalSaveRequest = null,
  legalRead = 0;
Object.assign(words.ja, {
  publications: "公式お知らせ",
  legal: "法務文書・問い合わせ設定",
  publicationHelp:
    "下書きの保存は公開ではありません。公開版と編集中の版は分離されます。メールやDiscordへの通知は送信しません。",
  newPublication: "新しい下書き",
  noPublications: "お知らせはまだありません。",
  publicationSelect: "下書きを作成するか、一覧から選んでください。",
  draft: "下書き",
  published: "公開中",
  withdrawn: "取り下げ済み",
  revision: "状態の版",
  editRevision: "編集中の版",
  publishedRevision: "公開版",
  category: "種類",
  incidentStatus: "障害の状態（種類とは別）",
  UPDATE: "アップデート",
  MAINTENANCE: "メンテナンス",
  INCIDENT: "障害情報",
  SERVICE: "サービス案内",
  POLICY: "規約・ポリシー改定",
  NONE: "該当なし",
  INVESTIGATING: "対応中",
  MONITORING: "経過確認中",
  RESOLVED: "復旧済み",
  japanese: "日本語",
  english: "English（任意）",
  title: "タイトル",
  summary: "概要",
  body: "本文",
  markdownHelp:
    "制限Markdown。HTML・画像・埋め込みは表示しません。リンク先と個人情報・秘密情報は人が確認してください。",
  englishHelp:
    "英語を提供しない場合は3項目とも空にします。公開時は同じ版の日本語へ明示的に切り替わります。",
  englishReviewed: "英訳がこの日本語の版と同じ内容であることを確認しました",
  englishSaveHelp:
    "英語を含む下書きの保存には毎回内容の一致確認が必要です。翻訳が未準備の場合は英語の3項目を空にしてください。",
  englishReviewRequired:
    "保存する前に英訳が今回の日本語と一致することを確認してください。翻訳が未準備の場合は英語の3項目を空にします。",
  saveDraft: "下書きを保存",
  preview: "保存済み下書きをプレビュー",
  publish: "公開を確認",
  withdraw: "取り下げを確認",
  discard: "下書きの破棄を確認",
  resetEdit: "保存済みの内容を読み直す",
  unsaved:
    "未保存の入力があります。入力を保護するため記事の切り替えを止めています。保存するか、読み直しを確認してください。",
  previewHelp:
    "プレビューは保存した版です。先に下書きを保存し、プレビューを開いてから公開の確認へ進んでください。",
  previewLanguage: "プレビューの言語",
  fallback: "英語版は準備中です。同じ公開候補版の日本語を表示しています。",
  publishImpact:
    "確認した下書きを公開サイトの読取対象へ切り替えます。この操作で通知・規約への同意取得は行いません。",
  withdrawImpact:
    "公開サイトの一覧・詳細から本文を除きます。外部検索や保存済みコピーの削除は保証しません。",
  discardImpact:
    "編集中の版を破棄します。公開版がある場合はその版を維持します。",
  resetImpact:
    "画面の未保存入力を捨て、保存済みの内容を取得します。必要な入力は先に控えてください。",
  newResetImpact:
    "未保存の入力を閉じて一覧へ戻ります。必要な入力は先に控えてください。保存済みの記事は削除しません。",
  publishedSnapshot: "現在の公開版を確認（編集中の内容とは別）",
  contentReviewed: "本文と関連リンク、お知らせの種類・障害状態を確認しました",
  translationsReviewed:
    "日本語と英語、または英語未提供時の日本語への切り替えを確認しました",
  privacyReviewed:
    "個人情報・秘密情報を含めて、公開してよい内容であることを確認しました",
  impactAccepted: "対象の版と影響を確認しました",
  destination: "公開先",
  publishedAt: "初回公開日時（UTC）",
  updatedAt: "更新日時（UTC）",
  retryPublication:
    "結果を確認できません。同じ確認番号で再試行できます。二重の公開要求にはしません。",
  publicationConflict:
    "別の操作で版が変わりました。入力は保持しています。必要な内容を控えたうえで保存済みの内容を読み直してください。",
  publicationInvalid:
    "入力内容を確認してください。英語はタイトル・概要・本文をすべて入力するか、すべて空にしてください。",
  legalHelp:
    "本人が正式な情報を直接入力します。未確定の候補文書はこの認証済み画面だけでレビューします。",
  legalBlocked:
    "公開・同意対象への使用はブロックされています。設定の保存は公開条件を解除しません。",
  legalPublicationApproval: "法務文書の実際の公開は未承認です。",
  legalCollectionGate:
    "成人管理者の同意と導入完了を収集開始の条件として確認する仕組みは未検証です。",
  legalDataReview:
    "Discord Policy、保持期間、暗号化、削除・復元、地域別の条件について確認が残っています。",
  legalOwnerReview: "運営者情報の確定と最終文書の確認が必要です。",
  legalAdditionalReview:
    "追加の公開前確認事項が残っています。公開条件を確認してください。",
  legalName: "運営者の正式氏名",
  address: "運営者情報の提示に用いる所在地",
  confirmedContacts: "本人確認済みの問い合わせ窓口",
  confirmedContactsHelp:
    "一般サポートと個人情報・権利請求の送信先は別です。以下は本人確認済みの設定例で、保存済みのレビュー設定とは分けて表示します。メール送信の確認や法務文書の公開承認を意味しません。",
  supportEmail: "一般サポートのメールアドレス",
  rightsEmail: "開示・削除等の権利請求用メールアドレス",
  effectiveDate: "効力発生日",
  version: "文書の版番号",
  other: "その他の確定情報（ローカルレビュー用）",
  ownerHelp:
    "未確定の項目は空欄のままにしてください。実情報をソースコードや操作理由へ転記しないでください。",
  supportHelp:
    "一般問い合わせと権利請求は別の窓口です。送信経路は未設定で、この画面から外部メールは送信しません。",
  saveSettings: "レビュー用設定を保存",
  legalDocument: "文書",
  terms: "利用規約",
  privacy: "プライバシーポリシー",
  beta: "Closed Beta 1注意事項",
  sourceReviewVersion: "原文のレビュー版",
  sourceReviewDate: "原文のレビュー日",
  sourceFile: "原文ファイル",
  sourceHash: "原文SHA256",
  displayHistory: "表示上の変更履歴",
  displayHistoryNote:
    "2026-10-09：表示名をClosed Beta 1に統一し、見出し階層を整えました。原文は変更せず保持しています。条文や未確定事項を確定した変更ではありません。",
  sourceIntroduction: "原文の前書き（本文とは別）",
  documentEditorial: "原文のレビュー注記（本文とは別）",
  editorialAppendix: "編集者用付録・公開前条件",
  integrationConditions: "Web組込条件（参考文書）",
  announcementsDesign: "お知らせ設計レビュー（参考文書）",
  originalJapaneseNotes: "以下は日本語の原文です。英訳を補っていません。",
  loadReview: "認証済みレビューを開く",
  candidateUnavailable:
    "正本が取得できないため本文を表示できません。推測した本文では補いません。",
  candidateNotice:
    "未公開の掲載候補です。編集者用の公開前条件と本文は分離し、一般公開・契約への使用は行いません。",
  operatorSettingsSeparate:
    "入力した運営者情報は別枠のレビュー設定です。原文の未確定箇所を自動的に確定済みとは扱いません。",
  toc: "目次",
  relatedDocuments: "関連文書",
  reviewOnly: "認証済みローカルレビュー専用",
  legalConflict:
    "設定の版が変わりました。未保存の入力は保持しています。必要な内容を控え、画面を読み直してください。",
  resetSettings: "保存済みの設定を読み直す",
  legalUnsaved:
    "未保存の設定があります。文書の確認には保存済みの設定版を使用します。",
  legalMissingMetadata: "未確定",
  documentUpdated: "文書更新日",
  documentUpdatedUnknown: "未確定",
  reviewVersion: "設定のレビュー版",
  noEffectiveDate: "効力発生日は未確定です。契約の対象には使用できません。",
});
Object.assign(words.en, {
  publications: "Official news",
  legal: "Legal documents & contact settings",
  publicationHelp:
    "Saving a draft does not publish it. Published and edited versions remain separate. No email or Discord notifications are sent.",
  newPublication: "New draft",
  noPublications: "No announcements yet.",
  publicationSelect: "Create a draft or select an announcement.",
  draft: "Draft",
  published: "Published",
  withdrawn: "Withdrawn",
  revision: "State revision",
  editRevision: "Editing revision",
  publishedRevision: "Published revision",
  category: "Category",
  incidentStatus: "Incident status (separate from category)",
  UPDATE: "Updates",
  MAINTENANCE: "Maintenance",
  INCIDENT: "Incidents",
  SERVICE: "Service information",
  POLICY: "Terms & policy changes",
  NONE: "Not applicable",
  INVESTIGATING: "Investigating",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
  japanese: "Japanese",
  english: "English (optional)",
  title: "Title",
  summary: "Summary",
  body: "Body",
  markdownHelp:
    "Restricted Markdown. HTML, images and embeds are not rendered. Review links, personal information and secrets manually.",
  englishHelp:
    "Leave all three fields empty if English is unavailable. Readers will see an explicit fallback to Japanese from the same published revision.",
  englishReviewed:
    "I checked that the English translation matches this Japanese revision",
  englishSaveHelp:
    "Every save containing English requires confirmation that both languages match. Clear all three English fields when the translation is not ready.",
  englishReviewRequired:
    "Before saving, confirm that English matches this Japanese revision. Clear all three English fields when the translation is not ready.",
  saveDraft: "Save draft",
  preview: "Preview saved draft",
  publish: "Review publication",
  withdraw: "Review withdrawal",
  discard: "Review draft discard",
  resetEdit: "Reload saved content",
  unsaved:
    "There are unsaved changes. Article switching is paused to protect your input. Save the draft or confirm reloading it.",
  previewHelp:
    "The preview shows a saved revision. Save the draft and open its preview before reviewing publication.",
  previewLanguage: "Preview language",
  fallback:
    "English is not yet available. Japanese from the same candidate revision is shown.",
  publishImpact:
    "Switches the public website reader to the reviewed draft. This does not send notifications or obtain acceptance of legal terms.",
  withdrawImpact:
    "Removes the body from public lists and details. Removal from external search results or saved copies cannot be guaranteed.",
  discardImpact:
    "Discards the edited revision. Any published version remains available.",
  resetImpact:
    "Discards unsaved input on this screen and loads saved content. Keep any needed input before continuing.",
  newResetImpact:
    "Closes unsaved input and returns to the list. Keep any needed input first. Saved articles are not deleted.",
  publishedSnapshot:
    "Review the current published version (separate from edits)",
  contentReviewed:
    "I reviewed the body, related links, category and incident status",
  translationsReviewed:
    "I reviewed both languages, or the explicit Japanese fallback when English is unavailable",
  privacyReviewed:
    "I checked that this content may be published, including personal information and secrets",
  impactAccepted: "I reviewed the target revision and impact",
  destination: "Public destination",
  publishedAt: "First published (UTC)",
  updatedAt: "Updated (UTC)",
  retryPublication:
    "The result could not be confirmed. Retry using the same reference; it will not create a second publication request.",
  publicationConflict:
    "Another operation changed the revision. Your input is preserved. Keep any needed content before reloading the saved version.",
  publicationInvalid:
    "Check your input. English title, summary and body must either all be filled in or all be empty.",
  legalHelp:
    "The owner enters their official details directly. Incomplete candidate documents are reviewed only in this authenticated screen.",
  legalBlocked:
    "Publication and use for acceptance are blocked. Saving settings does not remove release conditions.",
  legalPublicationApproval:
    "Actual publication of the legal documents has not been authorized.",
  legalCollectionGate:
    "The checks requiring adult administrator acceptance and completed setup before collection remain unverified.",
  legalDataReview:
    "Discord Policy, retention, encryption, deletion and restoration, and regional requirements still need review.",
  legalOwnerReview:
    "Operator details and the final documents still need confirmation.",
  legalAdditionalReview:
    "Additional checks remain before publication. Review the release conditions.",
  legalName: "Operator's legal name",
  address: "Address for required operator information",
  confirmedContacts: "Owner-confirmed contact destinations",
  confirmedContactsHelp:
    "General support and privacy or rights requests have separate destinations. These owner-confirmed configuration examples are shown separately from saved review settings. They do not confirm email delivery or authorize legal publication.",
  supportEmail: "General support email",
  rightsEmail: "Separate email for access, deletion and other rights requests",
  effectiveDate: "Effective date",
  version: "Document version",
  other: "Other confirmed details (local review only)",
  ownerHelp:
    "Leave unknown fields empty. Do not copy actual details into source code or operation reasons.",
  supportHelp:
    "General support and rights requests have separate contacts. Delivery is not configured; this screen does not send external emails.",
  saveSettings: "Save review settings",
  legalDocument: "Document",
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  beta: "Closed Beta 1 Notice",
  sourceReviewVersion: "Source review version",
  sourceReviewDate: "Source review date",
  sourceFile: "Source file",
  sourceHash: "Source SHA256",
  displayHistory: "Presentation change history",
  displayHistoryNote:
    "2026-10-09: The displayed name is now Closed Beta 1 and heading levels have been normalized. Original files are preserved unchanged. These display changes do not finalize any clause or unresolved fact.",
  sourceIntroduction: "Original introduction (separate from the text)",
  documentEditorial: "Original review notes (separate from the text)",
  editorialAppendix: "Editorial appendix and publication conditions",
  integrationConditions: "Web integration conditions (reference)",
  announcementsDesign: "Announcements design review (reference)",
  originalJapaneseNotes:
    "The following is the original Japanese text. No English translation has been added.",
  loadReview: "Open authenticated review",
  candidateUnavailable:
    "The source document is unavailable. No inferred replacement text is shown.",
  candidateNotice:
    "Unpublished candidate. Editorial release conditions are kept separate from the text. Do not publish or use it for contracts.",
  operatorSettingsSeparate:
    "Entered operator details are separate review settings. Unresolved source placeholders are not automatically treated as confirmed.",
  toc: "On this page",
  relatedDocuments: "Related documents",
  reviewOnly: "Authenticated local review only",
  legalConflict:
    "The settings revision changed. Your input is preserved. Keep any needed content before reloading this screen.",
  resetSettings: "Reload saved settings",
  legalUnsaved:
    "There are unsaved settings. Document review uses the saved settings revision.",
  legalMissingMetadata: "To be confirmed",
  documentUpdated: "Document updated",
  documentUpdatedUnknown: "Unconfirmed",
  reviewVersion: "Settings review revision",
  noEffectiveDate:
    "The effective date is not confirmed. This cannot be used for acceptance.",
});
function copyElement(tag, key, className) {
  const node = element(tag, t(key), className);
  node.dataset.copy = key;
  return node;
}
function copyButton(key, id, handler) {
  const button = copyElement("button", key);
  button.type = "button";
  if (id) button.id = id;
  button.onclick = handler;
  return button;
}
function formField(form, name, key, type = "text", maxLength = 500) {
  const label = element("label"),
    input = element(type === "textarea" ? "textarea" : "input");
  input.name = name;
  input.id = name;
  if (type !== "textarea") input.type = type;
  input.maxLength = maxLength;
  label.append(copyElement("span", key), input);
  form.append(label);
  return input;
}
function choice(form, name, key, values) {
  const label = element("label"),
    select = element("select");
  select.name = name;
  select.id = name;
  values.forEach(([value, word]) => {
    const option = copyElement("option", word);
    option.value = value;
    select.append(option);
  });
  label.append(copyElement("span", key), select);
  form.append(label);
  return select;
}
function check(form, name, key, required = false) {
  const label = element("label", undefined, "check-label"),
    input = element("input");
  input.type = "checkbox";
  input.name = name;
  input.required = required;
  label.append(input, copyElement("span", key));
  form.append(label);
  return input;
}
function fire(task) {
  void task.catch(() => {
    /* api() supplies a safe translated error. */
  });
}
function lockForm(form) {
  const controls = [...form.elements].map((control) => [
    control,
    control.disabled,
  ]);
  controls.forEach(([control]) => {
    control.disabled = true;
  });
  return () =>
    controls.forEach(([control, disabled]) => {
      control.disabled = disabled;
    });
}
function metadata(out, values) {
  const dl = element("dl", undefined, "publication-meta");
  values.forEach(([key, value, valueCopy]) => {
    const pair = element("div");
    const detail = valueCopy
      ? copyElement("dd", valueCopy)
      : element("dd", value ?? "—");
    pair.append(copyElement("dt", key), detail);
    dl.append(pair);
  });
  out.append(dl);
}
function publicationDirty() {
  if (!publicationState) return;
  publicationState.dirty = true;
  $("publication-unsaved").hidden = false;
  [
    "publication-preview",
    "publication-publish",
    "publication-withdraw",
    "publication-discard",
  ].forEach((id) => ($(id).disabled = true));
  document
    .querySelectorAll("[data-publication-select], #publication-new")
    .forEach((node) => (node.disabled = true));
  $("publication-preview-content").replaceChildren();
}
async function loadPublications() {
  const read = ++publicationRead,
    value = await api("publications");
  if (read !== publicationRead) return;
  const panel = $("publications");
  if (!$("publication-list")) {
    const actions = element("div", undefined, "actions"),
      columns = element("div", undefined, "columns");
    const list = element("div"),
      editor = element("article");
    list.id = "publication-list";
    editor.id = "publication-edit-area";
    editor.append(copyElement("p", "publicationSelect"));
    actions.append(
      copyButton("newPublication", "publication-new", () =>
        openPublication({
          id: crypto.randomUUID(),
          revision: 0,
          editRevision: null,
          publishedRevision: null,
          status: "DRAFT",
          content: null,
          published: null,
        }),
      ),
    );
    columns.append(list, editor);
    panel.append(
      copyElement("h1", "publications"),
      copyElement("p", "publicationHelp"),
      actions,
      columns,
    );
  }
  const list = $("publication-list");
  list.replaceChildren();
  if (!value.items.length) list.append(copyElement("p", "noPublications"));
  value.items.forEach((item) => {
    const button = element("button", undefined, "server");
    button.type = "button";
    button.dataset.publicationSelect = item.id;
    button.disabled = Boolean(publicationState?.dirty);
    button.append(
      element(
        "strong",
        (item.content || item.published)?.[language]?.title ||
          (item.content || item.published)?.ja?.title ||
          "—",
      ),
      copyElement("span", item.status.toLowerCase()),
      element("small", item.id),
    );
    button.onclick = () => fire(selectPublication(item.id));
    list.append(button);
  });
  $("publication-new").disabled = Boolean(publicationState?.dirty);
}
async function selectPublication(id) {
  const state = publicationState;
  const read = ++publicationRead,
    value = await api("publications/" + encodeURIComponent(id));
  if (read !== publicationRead || publicationState !== state || state?.dirty)
    return;
  openPublication(value);
}
function openPublication(article) {
  publicationState = { article, dirty: false, saveRequest: null };
  const out = $("publication-edit-area"),
    form = element("form"),
    content = article.content || article.published;
  form.id = "publication-editor";
  form.className = "publication-editor";
  out.replaceChildren(
    copyElement("h2", "draft"),
    element("p", article.id, "muted"),
    copyElement("strong", article.status.toLowerCase(), "publication-status"),
  );
  metadata(out, [
    ["revision", article.revision],
    ["editRevision", article.editRevision],
    ["publishedRevision", article.publishedRevision],
    ["publishedAt", date(article.publishedAt)],
    ["updatedAt", date(article.updatedAt)],
  ]);
  if (article.published) {
    const published = element("details");
    published.append(copyElement("summary", "publishedSnapshot"));
    for (const locale of ["ja", "en"]) {
      const translation = article.published[locale];
      if (!translation) continue;
      const group = element("section");
      group.lang = locale;
      group.append(
        element("h3", translation.title),
        element("p", translation.summary),
      );
      const raw = element("pre", translation.body, "publication-source");
      group.append(raw);
      published.append(group);
    }
    out.append(published);
  }
  const unsaved = copyElement("p", "unsaved", "publication-warning");
  unsaved.id = "publication-unsaved";
  unsaved.hidden = true;
  unsaved.setAttribute("role", "status");
  out.append(unsaved);
  choice(
    form,
    "category",
    "category",
    ["UPDATE", "MAINTENANCE", "INCIDENT", "SERVICE", "POLICY"].map((x) => [
      x,
      x,
    ]),
  ).value = content?.category || "UPDATE";
  choice(
    form,
    "incidentStatus",
    "incidentStatus",
    ["NONE", "INVESTIGATING", "MONITORING", "RESOLVED"].map((x) => [x, x]),
  ).value = content?.incidentStatus || "NONE";
  ["ja", "en"].forEach((locale) => {
    const group = element("fieldset");
    group.append(
      copyElement("legend", locale === "ja" ? "japanese" : "english"),
    );
    for (const [name, key, type, length] of [
      ["Title", "title", "text", 160],
      ["Summary", "summary", "textarea", 500],
      ["Body", "body", "textarea", 50000],
    ]) {
      const input = formField(group, locale + name, key, type, length);
      input.value = content?.[locale]?.[key] || "";
      input.required = locale === "ja";
      if (key === "body") input.rows = 12;
    }
    group.append(
      copyElement(
        "p",
        locale === "ja" ? "markdownHelp" : "englishHelp",
        "muted",
      ),
    );
    form.append(group);
  });
  check(form, "englishReviewed", "englishReviewed");
  form.append(copyElement("p", "englishSaveHelp", "muted"));
  const save = copyElement("button", "saveDraft");
  save.type = "submit";
  form.append(save);
  const synchronizeDraftFields = (event) => {
    if (/^(ja|en)(Title|Summary|Body)$/.test(event?.target?.name || ""))
      form.elements.englishReviewed.checked = false;
    form.elements.englishReviewed.required = [
      "enTitle",
      "enSummary",
      "enBody",
    ].some((key) => form.elements[key].value.trim());
    const incident = form.elements.category.value === "INCIDENT";
    if (!incident) form.elements.incidentStatus.value = "NONE";
    form.elements.incidentStatus.disabled = !incident;
  };
  synchronizeDraftFields();
  form.oninput = (event) => {
    synchronizeDraftFields(event);
    publicationDirty();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    fire(savePublication());
  };
  out.append(form);
  const controls = element("div", undefined, "publication-controls");
  const locale = choice(
    controls,
    "publication-preview-locale",
    "previewLanguage",
    [
      ["ja", "japanese"],
      ["en", "english"],
    ],
  );
  locale.value = language;
  const actions = element("div", undefined, "actions");
  for (const [word, id, action] of [
    ["preview", "publication-preview", () => fire(previewPublication())],
    ["publish", "publication-publish", () => confirmPublication("publish")],
    ["withdraw", "publication-withdraw", () => confirmPublication("withdraw")],
    ["discard", "publication-discard", () => confirmPublication("discard")],
    ["resetEdit", "publication-reset-edit", () => confirmPublication("reset")],
  ])
    actions.append(copyButton(word, id, action));
  $("publication-new").disabled = false;
  controls.append(copyElement("p", "previewHelp", "muted"), actions);
  out.append(controls);
  const preview = element("div");
  preview.id = "publication-preview-content";
  out.append(preview);
  $("publication-preview").disabled = article.editRevision === null;
  $("publication-publish").disabled = true;
  $("publication-withdraw").disabled = article.status !== "PUBLISHED";
  $("publication-discard").disabled =
    article.editRevision === null ||
    article.editRevision === article.publishedRevision;
  $("publication-reset-edit").disabled = false;
  document
    .querySelectorAll("[data-publication-select]")
    .forEach((node) => (node.disabled = false));
}
async function savePublication() {
  const state = publicationState,
    form = $("publication-editor");
  if (!state || !form.reportValidity()) return;
  const input = Object.fromEntries(new FormData(form));
  const en = {
    title: input.enTitle.trim(),
    summary: input.enSummary.trim(),
    body: input.enBody.trim(),
  };
  const englishFields = Object.values(en).filter(Boolean).length;
  if (englishFields && englishFields !== 3) {
    notice("publicationInvalid");
    return;
  }
  const payload = {
    action: "save",
    id: state.article.id,
    expectedRevision: state.article.revision,
    content: {
      category: input.category,
      incidentStatus: input.incidentStatus || "NONE",
      ja: {
        title: input.jaTitle.trim(),
        summary: input.jaSummary.trim(),
        body: input.jaBody.trim(),
      },
      en: englishFields ? en : null,
    },
    englishReviewed: input.englishReviewed === "on",
  };
  const signature = JSON.stringify(payload);
  if (state.saveRequest?.signature !== signature)
    state.saveRequest = {
      signature,
      payload: { ...payload, requestId: crypto.randomUUID() },
    };
  const submit = form.querySelector("button[type=submit]");
  const unlock = lockForm(form);
  submit.disabled = true;
  try {
    const article = await api("publications", state.saveRequest.payload);
    if (publicationState !== state) return;
    openPublication(article);
    await loadPublications();
    notice("success");
  } catch (error) {
    if (["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.message))
      notice("publicationConflict");
    else if (error.message === "INVALID_REQUEST") notice("publicationInvalid");
  } finally {
    unlock();
  }
}
function renderedDocument(out, data, extra = []) {
  const root = element("div", undefined, "publication-document"),
    header = element("div", undefined, "publication-header"),
    layout = element("div", undefined, "publication-layout");
  header.append(
    copyElement("p", "reviewOnly", "publication-status"),
    element("h2", data.title),
  );
  metadata(header, [["reviewVersion", data.revision], ...extra]);
  if (data.summary) header.append(element("p", data.summary));
  if (data.fallback)
    header.append(copyElement("p", "fallback", "publication-status"));
  const toc = element("nav", undefined, "publication-toc"),
    list = element("ol");
  toc.setAttribute("aria-label", t("toc"));
  toc.append(copyElement("h3", "toc"));
  (data.headings || []).forEach((heading) => {
    const item = element("li"),
      link = element("a", heading.text);
    link.href = "#" + encodeURIComponent(heading.id);
    link.onclick = () => {
      const target = document.getElementById(heading.id);
      if (target) target.focus({ preventScroll: true });
    };
    item.append(link);
    list.append(item);
  });
  toc.append(list);
  const body = element("article", undefined, "publication-body");
  body.lang = data.fallback ? "ja" : data.locale;
  // Only HTML returned by the authenticated shared restricted-Markdown renderer.
  body.innerHTML = data.html;
  layout.append(toc, body);
  root.append(header, layout);
  out.replaceChildren(root);
}
async function previewPublication() {
  const state = publicationState;
  if (!state || state.dirty) return;
  const locale = $("publication-preview-locale").value;
  const value = await api(
    "publications/" +
      encodeURIComponent(state.article.id) +
      "/preview?revision=" +
      state.article.revision +
      "&locale=" +
      locale,
  );
  if (state !== publicationState || state.dirty) return;
  state.previewedRevision = state.article.revision;
  $("publication-publish").disabled =
    state.article.status === "PUBLISHED" &&
    state.article.editRevision === state.article.publishedRevision;
  renderedDocument($("publication-preview-content"), value);
  $("publication-preview-content").querySelector("h2").tabIndex = -1;
  $("publication-preview-content").querySelector("h2").focus();
}
function confirmPublication(action) {
  if (!publicationState || (publicationState.dirty && action !== "reset"))
    return;
  if (
    action === "publish" &&
    publicationState.previewedRevision !== publicationState.article.revision
  )
    return;
  const article = publicationState.article;
  publicationPending = {
    action,
    id: article.id,
    expectedRevision: article.revision,
    requestId: crypto.randomUUID(),
  };
  const labels = {
    publish: "publish",
    withdraw: "withdraw",
    discard: "discard",
    reset: "resetEdit",
  };
  $("publication-confirm-title").textContent = t(labels[action]);
  const details = $("publication-confirm-details");
  details.replaceChildren(
    element(
      "p",
      article.content?.ja.title || article.published?.ja.title || article.id,
    ),
  );
  metadata(details, [
    ["revision", article.revision],
    ["editRevision", article.editRevision],
    ["publishedRevision", article.publishedRevision],
  ]);
  if (action === "publish")
    metadata(details, [["destination", "/news/" + article.id]]);
  details.append(
    copyElement(
      "p",
      action === "reset" && article.revision === 0
        ? "newResetImpact"
        : action + "Impact",
    ),
  );
  $("publication-confirm-checks").replaceChildren();
  for (const key of action === "publish"
    ? ["contentReviewed", "translationsReviewed", "privacyReviewed"]
    : ["impactAccepted"])
    check($("publication-confirm-checks"), key, key, true);
  $("publication-confirm-status").replaceChildren();
  $("publication-confirm-form").reset();
  $("publication-confirmation").showModal();
}
$("publication-cancel").onclick = () => {
  if (publicationSubmission) return;
  publicationPending = null;
  $("publication-confirmation").close();
};
// A dispatched operation cannot be canceled by closing its confirmation.
$("publication-confirmation").oncancel = (event) => {
  if (publicationSubmission) event.preventDefault();
};
$("publication-confirmation").onclose = () => {
  publicationPending = null;
};
$("publication-confirm-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!publicationPending || publicationSubmission) return;
  const pending = publicationPending,
    form = event.currentTarget,
    submission = { unlock: lockForm(form) };
  publicationSubmission = submission;
  form.setAttribute("aria-busy", "true");
  $("publication-confirm-status").textContent = t("busy");
  try {
    if (pending.action === "reset" && pending.expectedRevision === 0) {
      publicationState = null;
      $("publication-edit-area").replaceChildren(
        copyElement("p", "publicationSelect"),
      );
      $("publication-confirmation").close();
      await loadPublications();
      return;
    }
    if (pending.action === "legal-reset") {
      legalState.dirty = false;
      await loadLegal();
      $("publication-confirmation").close();
      return;
    }
    const value =
      pending.action === "reset"
        ? await api("publications/" + encodeURIComponent(pending.id))
        : await api("publications", {
            ...pending,
            ...(pending.action === "publish"
              ? {
                  confirmed: true,
                  target: "public-site",
                  translationsReviewed: true,
                }
              : {}),
          });
    if (publicationPending !== pending) return;
    openPublication(value);
    $("publication-confirmation").close();
    await loadPublications();
    notice("success");
  } catch (error) {
    if (
      publicationPending === pending &&
      ["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.message)
    ) {
      $("publication-confirm-status").textContent = t("publicationConflict");
    } else if (
      error.message !== "STALE_RESPONSE" &&
      publicationPending === pending
    )
      $("publication-confirm-status").textContent = t("retryPublication");
  } finally {
    if (publicationSubmission === submission) {
      submission.unlock();
      publicationSubmission = null;
      form.removeAttribute("aria-busy");
    }
  }
};
async function loadLegal() {
  if (legalState?.dirty) {
    notice("legalUnsaved");
    return;
  }
  const state = legalState;
  const read = ++legalRead,
    value = await api("legal");
  if (read !== legalRead || legalState !== state || state?.dirty) return;
  legalState = { ...value, dirty: false };
  legalSaveRequest = null;
  const out = $("legal"),
    form = element("form");
  form.id = "legal-settings-form";
  out.replaceChildren(
    copyElement("h1", "legal"),
    copyElement("p", "legalHelp"),
    copyElement("p", "legalBlocked", "publication-warning"),
  );
  const blockers = element("ul", undefined, "publication-editor-notes");
  const blockerLabels = {
    LEGAL_PUBLICATION_NOT_AUTHORIZED: "legalPublicationApproval",
    ADULT_MANAGER_CONSENT_AND_INSTALLATION_GATE_UNVERIFIED:
      "legalCollectionGate",
    POLICY_RETENTION_ENCRYPTION_RESTORE_AND_REGIONAL_REVIEW_PENDING:
      "legalDataReview",
    OWNER_DETAILS_AND_FINAL_DOCUMENT_REVIEW_REQUIRED: "legalOwnerReview",
  };
  value.blockers.forEach((code) =>
    blockers.append(
      copyElement("li", blockerLabels[code] || "legalAdditionalReview"),
    ),
  );
  out.append(blockers, copyElement("p", "ownerHelp"));
  if (value.confirmedContacts) {
    const contacts = element("section"),
      list = element("dl");
    contacts.id = "legal-confirmed-contacts";
    contacts.append(
      copyElement("h2", "confirmedContacts"),
      copyElement("p", "confirmedContactsHelp"),
    );
    for (const name of ["supportEmail", "rightsEmail"])
      list.append(
        copyElement("dt", name),
        element("dd", value.confirmedContacts[name]),
      );
    contacts.append(list, element("time", value.confirmedContacts.confirmedOn));
    out.append(contacts);
  }
  for (const [name, type, length] of [
    ["legalName", "text", 160],
    ["address", "textarea", 1000],
    ["supportEmail", "email", 320],
    ["rightsEmail", "email", 320],
    ["effectiveDate", "date", 10],
    ["version", "text", 100],
    ["other", "textarea", 20000],
  ]) {
    const input = formField(form, name, name, type, length);
    input.value = value.settings[name] || "";
    input.autocomplete = "off";
  }
  form.append(copyElement("p", "supportHelp", "muted"));
  const save = copyElement("button", "saveSettings");
  save.type = "submit";
  form.append(save);
  form.append(
    copyButton("resetSettings", "legal-settings-reload", () => {
      publicationPending = { action: "legal-reset" };
      $("publication-confirm-title").textContent = t("resetSettings");
      $("publication-confirm-details").replaceChildren(
        copyElement("p", "resetImpact"),
      );
      $("publication-confirm-checks").replaceChildren();
      check(
        $("publication-confirm-checks"),
        "impactAccepted",
        "impactAccepted",
        true,
      );
      $("publication-confirm-status").replaceChildren();
      $("publication-confirm-form").reset();
      $("publication-confirmation").showModal();
    }),
  );
  form.oninput = () => {
    legalState.dirty = true;
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    fire(saveLegal());
  };
  out.append(form);
  const controls = element("div", undefined, "publication-controls");
  choice(
    controls,
    "legal-review-document",
    "legalDocument",
    ["terms", "privacy", "beta"].map((key) => [key, key]),
  );
  choice(controls, "legal-review-locale", "previewLanguage", [
    ["ja", "japanese"],
    ["en", "english"],
  ]).value = language;
  controls.append(
    copyButton("loadReview", "legal-review-load", () => fire(previewLegal())),
  );
  out.append(
    controls,
    copyElement("p", "operatorSettingsSeparate", "publication-editor-notes"),
  );
  const preview = element("div");
  preview.id = "legal-review-content";
  out.append(preview);
}
async function saveLegal() {
  const state = legalState,
    form = $("legal-settings-form");
  if (!state || !form.reportValidity()) return;
  const payload = {
      expectedRevision: state.revision,
      settings: Object.fromEntries(new FormData(form)),
    },
    signature = JSON.stringify(payload);
  if (legalSaveRequest?.signature !== signature)
    legalSaveRequest = {
      signature,
      payload: { ...payload, requestId: crypto.randomUUID() },
    };
  const button = form.querySelector("button[type=submit]");
  const unlock = lockForm(form);
  button.disabled = true;
  try {
    await api("legal", legalSaveRequest.payload);
    if (state !== legalState) return;
    legalState.dirty = false;
    await loadLegal();
    notice("success");
  } catch (error) {
    if (["REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.message))
      notice("legalConflict");
  } finally {
    unlock();
  }
}
async function previewLegal() {
  const state = legalState;
  if (!state) return;
  if (state.dirty) notice("legalUnsaved");
  const doc = $("legal-review-document").value,
    locale = $("legal-review-locale").value,
    read = ++legalRead;
  $("legal-review-content").replaceChildren();
  try {
    const data = await api(
      "legal/" + doc + "/" + locale + "?revision=" + state.revision,
    );
    if (state !== legalState || read !== legalRead) return;
    renderedDocument(
      $("legal-review-content"),
      { ...data, title: words[locale][doc] },
      [
        ["version", state.settings.version || t("legalMissingMetadata")],
        [
          "documentUpdated",
          t("documentUpdatedUnknown"),
          "documentUpdatedUnknown",
        ],
        [
          "effectiveDate",
          state.settings.effectiveDate || t("legalMissingMetadata"),
        ],
      ],
    );
    const root = $("legal-review-content").firstElementChild;
    root.prepend(copyElement("p", "candidateNotice", "publication-status"));
    if (data.review) {
      const source = data.review.source;
      metadata(root.querySelector(".publication-header"), [
        ["sourceReviewVersion", source.reviewVersion],
        ["sourceReviewDate", source.reviewDate],
        ["sourceFile", source.fileName],
        ["sourceHash", source.sha256],
      ]);
      const history = element("section", undefined, "publication-status");
      history.append(
        copyElement("h3", "displayHistory"),
        copyElement("p", "displayHistoryNote"),
      );
      root.querySelector(".publication-header").append(history);
      const notes = element("section", undefined, "publication-editor-notes");
      notes.id = "legal-review-notes";
      for (const note of data.review.notes) {
        const panel = element("details");
        panel.dataset.note = note.key;
        panel.append(copyElement("summary", note.key));
        if (note.locale !== locale)
          panel.append(copyElement("p", "originalJapaneseNotes"));
        const content = element("div", undefined, "publication-body");
        content.lang = note.locale;
        // Authenticated output from the same restricted Markdown renderer.
        content.innerHTML = note.html;
        panel.append(content);
        notes.append(panel);
      }
      root.append(notes);
    }
    const related = element("nav", undefined, "publication-related");
    related.append(copyElement("h3", "relatedDocuments"));
    ["terms", "privacy", "beta"]
      .filter((name) => name !== doc)
      .forEach((name) =>
        related.append(
          copyButton(name, null, () => {
            $("legal-review-document").value = name;
            fire(previewLegal());
          }),
        ),
      );
    root.append(related);
    const title = root.querySelector("h2");
    title.tabIndex = -1;
    title.focus();
  } catch (error) {
    if (state === legalState && read === legalRead)
      $("legal-review-content").replaceChildren(
        copyElement(
          "p",
          error.message === "LEGAL_CANDIDATE_UNAVAILABLE"
            ? "candidateUnavailable"
            : "error",
          "publication-warning",
        ),
      );
  }
}
void start().catch(() => notice("error"));
