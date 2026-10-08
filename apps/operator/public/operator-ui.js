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
  noticeKey = "";
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
    }[code] || "error"
  );
}
async function api(path, body) {
  let response, value;
  try {
    response = await fetch("/operator/" + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
        : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    value = await response.json();
  } catch {
    notice("error");
    throw new Error("OPERATOR_REQUEST_FAILED");
  }
  if (!response.ok) {
    notice(errorKey(value.error));
    throw new Error("OPERATOR_REQUEST_FAILED");
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
  ["guilds", "register", "audit", "sessions"].forEach(
    (id) => ($(id).hidden = id !== key),
  );
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
  notice("busy");
  try {
    const value = await api("session", {
      password: form.elements.password.value,
    });
    csrf = value.csrf;
    form.reset();
    await start();
    notice("success");
  } catch {
    form.reset();
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
  try {
    await api("logout", {});
    selected = null;
    activeTab = "guilds";
    current = null;
    await start();
  } catch {
    /* api() shows the failure in the notice area. */
  }
};
$("reload").onclick = () => {
  void reload().catch(() => {
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
void start().catch(() => notice("error"));
