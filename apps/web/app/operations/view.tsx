"use client";
import {safeError} from "../safe-error";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  chartQuerySchema,
  type ChartSpec,
  type ChartQuery,
} from "../../../../packages/analytics/src/chart-spec";
import type { MetricEvidence } from "../../../../packages/shared/src/metric-evidence";
import type { PlaybookDefinition } from "../../../../packages/operations/src/playbooks";
const tabs = [
  "attention",
  "reports",
  "playbooks",
  "improvements",
  "intake",
  "events",
  "organization",
  "integrations",
] as const;
type Tab = (typeof tabs)[number];
type Named = { id: string; name: string; state?: string };
type Book = Named & {
  state: string;
  version: number;
  revision: number;
  approval_required: boolean;
  definition: PlaybookDefinition;
  review_team_id: string | null;
};
type Panel = {
  id: string;
  title: string;
  category: string;
  state: string;
  version: number;
  channel_id: string | null;
  destination_id: string | null;
  fields: {
    key: string;
    label: string;
    required: boolean;
    maxLength: number;
  }[];
};
type Data = {
  view: Tab;
  guildId: string;
  access: {
    plan: string;
    role: string | null;
    permissions: string[];
    features: Record<string, boolean>;
    limits: { historyDays: number | null; intakePanels: number | null };
  };
  destinations: (Named & { kind: string; channel_id: string | null })[];
  teams: Named[];
  items?: {
    message_id: string;
    channel_id: string;
    item_type: string;
    reason: string;
    status: string;
    version: number;
    evidence: MetricEvidence;
    assigned_team_id: string | null;
  }[];
  books?: Book[];
  templates?: { key: string; name: string; type: string }[];
  reports?: {
    templates: {
      id: string;
      title: string;
      footer: string;
      queries: ChartQuery[];
      revision: number;
      include_attention: boolean;
      include_interventions: boolean;
    }[];
    schedules: {
      id: string;
      template_id: string;
      state: string;
      cadence: string;
      timezone: string;
      next_at: string;
      format: string;
    }[];
    runs: {
      id: string;
      state: string;
      scheduled_at: string;
      last_error: string | null;
    }[];
  };
  views?: { id: string; name: string }[];
  improvements?: {
    id: string;
    title: string;
    started_at: string;
    review_at: string;
    state: string;
    assigned_team_id: string | null;
    baseline: ChartSpec;
    after_snapshot: ChartSpec | null;
    comparison: ChartSpec["comparison"];
  }[];
  intake?: {
    panels: Panel[];
    requests: {
      id: string;
      category: string;
      status: string;
      created_at: string;
    }[];
  };
  events?: {
    id: string;
    title: string;
    state: string;
    starts_at: string;
    timezone: string;
    duration_minutes: number;
    recurrence: string;
    location: string;
    revision: number;
  }[];
  organization?: { id: string; name: string; home_guild_id: string } | null;
  members?: (Named & { role: string; revision: number })[];
  guilds?: { guild_id: string; state: string }[];
  communities?: {
    guildId: string;
    state: string;
    coverage: { percent?: number } | null;
    openAttention: number | null;
    health: { status?: string; state?: string } | null;
    change: ChartSpec["comparison"];
  }[];
  credentials?: (Named & {
    prefix: string;
    scopes: string[];
    kind: string;
    last_used_at: string | null;
  })[];
  webhooks?: {
    endpoints: (Named & {
      url: string;
      secret_version: number;
      failures: number;
    })[];
    deliveries: {
      id: string;
      state: string;
      attempts: number;
      last_status: number | null;
      last_error: string | null;
    }[];
  };
};
function localEventStart(event: NonNullable<Data["events"]>[number]) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: event.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(event.starts_at));
  const value = (kind: string) =>
    parts.find((part) => part.type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
type ActionResult = {
  token?: string;
  secret?: string;
  version?: number;
  fields?: Record<string, string>;
  labels?: { key: string; label: string }[];
  wouldTrigger?: number;
  wouldNotify?: number;
  wouldEscalate?: number;
  suppressedDueToCoverage?: number;
  actualActions?: number;
};
const labels: Record<Tab, [string, string]> = {
  attention: ["Attention Inbox", "対応一覧"],
  reports: ["Reports", "レポート"],
  playbooks: ["Playbooks", "Playbook"],
  improvements: ["Interventions & reviews", "施策とレビュー"],
  intake: ["Operations intake", "運営への相談"],
  events: ["Event operations", "イベント運営"],
  organization: ["Organization", "組織"],
  integrations: ["Integrations", "連携"],
};
const metrics = ["reply", "forum", "voice", "event", "reaction", "poll"];
const text = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const number = (f: FormData, key: string) => Number(text(f, key));
function query(f: FormData, prefix = "") {
  return chartQuerySchema.parse({
    metric: text(f, prefix + "metric") || "reply",
    days: number(f, prefix + "days") || 7,
    compare: f.get(prefix + "compare") === "on",
  });
}
const UiContext = createContext<{
  ja: boolean;
  data: Data | null;
  busy: boolean;
}>({ ja: false, data: null, busy: false });
function Field({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <label>
      {label}
      {children ?? <input name={name} required maxLength={120} />}
    </label>
  );
}
function MetricFields({
  comparison = true,
  prefix = "",
  defaults,
}: {
  comparison?: boolean;
  prefix?: string;
  defaults?: ChartQuery;
}) {
  const { ja, data } = useContext(UiContext);
  return (
    <div className="operations-fields">
      <Field
        name={prefix + "metric"}
        label={ja ? "測定する指標" : "Measurement"}
      >
        <select name={prefix + "metric"} defaultValue={defaults?.metric}>
          {metrics.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field name={prefix + "days"} label={ja ? "期間" : "Period"}>
        <select name={prefix + "days"} defaultValue={defaults?.days}>
          {[7, 30, 90].map((value) => (
            <option
              key={value}
              value={value}
              disabled={
                data?.access.limits.historyDays !== null &&
                value > (data?.access.limits.historyDays ?? 30)
              }
            >
              {value} {ja ? "日" : "days"}
            </option>
          ))}
        </select>
      </Field>
      {comparison && (
        <label>
          <input
            name={prefix + "compare"}
            type="checkbox"
            defaultChecked={defaults?.compare}
          />
          {ja ? "前の比較可能な期間" : "Previous comparable period"}
        </label>
      )}
    </div>
  );
}
function DestinationField({
  name = "destinationId",
  optional = false,
  defaultValue,
}: {
  name?: string;
  optional?: boolean;
  defaultValue?: string;
}) {
  const { ja, data } = useContext(UiContext);
  return (
    <Field name={name} label={ja ? "通知先" : "Destination"}>
      <select
        name={name}
        required={!optional}
        defaultValue={defaultValue ?? ""}
      >
        <option value="">{ja ? "通知先を選択" : "Choose destination"}</option>
        {data?.destinations
          .filter((d) => d.state === "ENABLED")
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.kind}
            </option>
          ))}
      </select>
    </Field>
  );
}
function TeamField() {
  const { ja, data } = useContext(UiContext);
  return (
    <Field name="teamId" label={ja ? "担当チーム" : "Assigned team"}>
      <select name="teamId" disabled={!data?.access.features.team_assignment}>
        <option value="">—</option>
        {data?.teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Gate({
  feature,
  children,
  permission = "CONFIGURE",
}: {
  feature: string;
  children: ReactNode;
  permission?: string;
}) {
  const { ja, data } = useContext(UiContext);
  return data?.access.features[feature] &&
    data.access.permissions.includes(permission) ? (
    <>{children}</>
  ) : (
    <p className="inline-note">
      {ja
        ? "現在のプランまたはチーム権限ではこの操作を利用できません。保存した設定は保持されます。"
        : "Your current plan or team role does not allow this action. Saved settings are retained."}{" "}
      <a href="/billing/manage">{ja ? "プランを確認" : "View plan"}</a>
    </p>
  );
}
function Button({ children }: { children: ReactNode }) {
  const { busy } = useContext(UiContext);
  return (
    <button type="submit" disabled={busy}>
      {children}
    </button>
  );
}
export function OperationsControls({
  locale,
  initialView,
}: {
  locale: "ja" | "en";
  initialView: string;
}) {
  const ja = locale === "ja",
    view = tabs.includes(initialView as Tab)
      ? (initialView as Tab)
      : "attention",
    t = (en: string, jp: string) => (ja ? jp : en);
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState<ActionResult | null>(null),
    [editing, setEditing] = useState<Book | null>(null),
    [editingPanel, setEditingPanel] = useState<Panel | null>(null),
    [editingEvent, setEditingEvent] = useState<
      NonNullable<Data["events"]>[number] | null
    >(null),
    [reviewTeams, setReviewTeams] = useState<Record<string, string>>({}),
    [trigger, setTrigger] = useState("FORUM_SUPPORT"),
    [routeKind, setRouteKind] = useState("DISCORD"),
    [formFields, setFormFields] = useState([
      {
        key: "issue",
        label: t("Operations issue", "運営の課題"),
        required: true,
        maxLength: 1000,
      },
      {
        key: "context",
        label: t("Workflow context", "関連する状況"),
        required: false,
        maxLength: 1000,
      },
    ]),
    [logo, setLogo] = useState<string | null>(null);
  async function load() {
    const response = await fetch("/operations/data?view=" + view, {
        cache: "no-store",
      }),
      body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "OPERATIONS_UNAVAILABLE");
    setData(body);
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setBusy(true);
    fetch("/operations/data?view=" + view, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (active) {
          setData(body);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [view]);
  const can = (feature: string, permission = "CONFIGURE") =>
      Boolean(
        data?.access.features[feature] &&
        data.access.permissions.includes(permission),
      ),
    configure = Boolean(data?.access.permissions.includes("CONFIGURE")),
    govern = Boolean(data?.access.permissions.includes("GOVERN"));
  async function send(action: string, input: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setNotice("");
    try {
      const response = await fetch("/operations/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, input }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "OPERATIONS_UNAVAILABLE");
      setResult(body);
      setNotice(
        t(
          "Saved. Delivery and measurement results appear after processing.",
          "保存しました。送信と測定の結果は処理後に表示されます。",
        ),
      );
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "OPERATIONS_UNAVAILABLE");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function submit(action: string, build: (f: FormData) => unknown) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        void send(action, build(new FormData(event.currentTarget)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "INVALID_REQUEST");
      }
    };
  }
  const state = (value: string) => (
    <span className="operations-state">{value}</span>
  );
  const evidence = (proof: MetricEvidence) => (
    <details>
      <summary>
        {t("Evidence", "根拠")} · {proof.coverageState}
      </summary>
      <p>{proof.definition}</p>
      <p>
        {proof.value ?? "UNKNOWN"} · {proof.observationState} ·{" "}
        {proof.sampleSize} {t("observations", "件の観測")}
      </p>
      <p>
        {proof.windowStart} — {proof.windowEnd}
      </p>
      <p>{proof.coverageReasons.join(", ")}</p>
    </details>
  );
  return (
    <UiContext value={{ ja, data, busy }}>
      <header className="page-head">
        <h1>{labels[view][ja ? 1 : 0]}</h1>
        <p>
          {t(
            "Act on evidence, measure the result, and review what changed.",
            "根拠を確かめて対応し、結果を測定して変化を振り返ります。",
          )}
        </p>
        {data && (
          <p>
            {data.access.plan} ·{" "}
            {data.access.role ??
              t("Discord operations staff", "Discord運営担当")}
          </p>
        )}
      </header>
      {error && (
        <p role="alert">
          {safeError(error, locale)}{" "}
          {error === "SESSION_EXPIRED" && (
            <a href="/auth/login">{t("Sign in", "ログイン")}</a>
          )}
        </p>
      )}
      {busy && <p role="status">{t("Checking…", "確認中…")}</p>}
      {notice && <p role="status">{notice}</p>}
      {result && (result.token || result.secret) && (
        <section className="surface">
          <h2>{t("Copy this secret now", "秘密情報をここでコピー")}</h2>
          <p>
            {t(
              "It is displayed once. Store it in your integration's secret settings.",
              "表示は今回だけです。連携先の秘密情報設定へ保存してください。",
            )}
          </p>
          <textarea
            readOnly
            aria-label={t("New secret", "新しい秘密情報")}
            value={result.token ?? result.secret}
          />
          <button
            onClick={() =>
              void navigator.clipboard.writeText(
                result.token ?? result.secret ?? "",
              )
            }
          >
            {t("Copy", "コピー")}
          </button>
          <button onClick={() => setResult(null)}>{t("Hide", "非表示")}</button>
        </section>
      )}
      {result?.fields && (
        <section className="surface">
          <h2>{t("Submitted form", "送信された相談内容")}</h2>
          {result.labels?.map((field) => (
            <p key={field.key}>
              <strong>{field.label}</strong>
              <br />
              {result.fields?.[field.key] ?? "—"}
            </p>
          ))}
          <button onClick={() => setResult(null)}>
            {t("Close", "閉じる")}
          </button>
        </section>
      )}
      {result?.wouldTrigger !== undefined && (
        <section className="surface">
          <h2>{t("Historical dry run", "履歴データでの試行")}</h2>
          <p>
            {t("Would trigger", "条件に一致")}: {result.wouldTrigger} ·{" "}
            {t("Would notify", "通知予定")}: {result.wouldNotify} ·{" "}
            {t("Would escalate", "追加通知予定")}: {result.wouldEscalate} ·{" "}
            {t("Suppressed by evidence", "根拠不足で抑制")}:{" "}
            {result.suppressedDueToCoverage}
          </p>
          <p>
            {t("Actual actions", "実際の実行")}: {result.actualActions}
          </p>
        </section>
      )}
      {view === "attention" && (
        <>
          <Gate feature="basic_attention" permission="READ">
            <section className="operations-list">
              {data?.items?.map((item) => (
                <article className="surface" key={item.message_id}>
                  <h2>{item.item_type}</h2>
                  <p>
                    {item.reason} · {state(item.status)}
                  </p>
                  {evidence(item.evidence)}
                  <div className="operations-actions">
                    {[
                      "ACKNOWLEDGED",
                      "IN_PROGRESS",
                      "RESOLVED",
                      "DISMISSED",
                    ].map((value) => (
                      <button
                        key={value}
                        disabled={
                          busy ||
                          !can("attention_inbox", "OPERATE") ||
                          ["RESOLVED", "DISMISSED"].includes(item.status)
                        }
                        onClick={() =>
                          void send("attention", {
                            key: item.message_id,
                            channelId: item.channel_id,
                            state: value,
                            version: item.version,
                          })
                        }
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  {can("team_assignment", "OPERATE") && (
                    <label>
                      {t("Assigned team", "担当チーム")}
                      <select
                        value={item.assigned_team_id ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          void send("attention", {
                            key: item.message_id,
                            channelId: item.channel_id,
                            state: item.status,
                            version: item.version,
                            teamId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">—</option>
                        {data.teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </article>
              ))}
              {data?.items?.length === 0 && (
                <p>
                  {t(
                    "No saved attention items.",
                    "保存された対応項目はありません。",
                  )}
                </p>
              )}
            </section>
          </Gate>
          <p>
            <a href="/dashboard?view=8">
              {t(
                "Basic Attention and coverage are available on Free.",
                "基本の対応状況と観測範囲はFreeでも確認できます。",
              )}
            </a>
          </p>
        </>
      )}
      {view === "playbooks" && (
        <>
          <section className="surface">
            <h2>
              {editing
                ? t("Edit versioned playbook", "Playbookの改訂")
                : t("Create playbook", "Playbookを作成")}
            </h2>
            <Gate feature="playbooks">
              <form
                key={editing?.id ?? "new"}
                onSubmit={submit("playbook", (f) => ({
                  ...(editing
                    ? { id: editing.id, version: editing.version }
                    : {}),
                  name: text(f, "name"),
                  approvalRequired: f.get("approval") === "on",
                  definition: {
                    trigger:
                      trigger === "TREND"
                        ? {
                            kind: "TREND",
                            query: query(f, "trigger"),
                            mode: text(f, "mode"),
                            direction: text(f, "direction"),
                            threshold: number(f, "threshold"),
                          }
                        : { kind: "ATTENTION", type: trigger },
                    condition: { minimumSample: number(f, "minimumSample") },
                    destinations: f.getAll("destinations"),
                    escalation: text(f, "escalationId")
                      ? {
                          afterMinutes: number(f, "afterMinutes"),
                          destinationId: text(f, "escalationId"),
                        }
                      : null,
                    measurement: { query: query(f) },
                  },
                }))}
              >
                <div className="operations-fields">
                  <Field name="name" label={t("Name", "名前")}>
                    <input
                      name="name"
                      required
                      maxLength={80}
                      defaultValue={editing?.name}
                    />
                  </Field>
                  <Field
                    name="trigger"
                    label={t("Trigger / template", "きっかけ・テンプレート")}
                  >
                    <select
                      value={trigger}
                      onChange={(e) => setTrigger(e.target.value)}
                    >
                      {data?.templates?.map((template) => (
                        <option key={template.key} value={template.type}>
                          {template.name}
                        </option>
                      ))}
                      <option value="OPERATIONS_REQUEST">
                        {t("Operations request", "相談の受信")}
                      </option>
                      <option value="TREND">
                        {t("Metric trend", "指標の変化")}
                      </option>
                    </select>
                  </Field>
                  <Field
                    name="minimumSample"
                    label={t("Minimum sample", "必要な観測数")}
                  >
                    <input
                      name="minimumSample"
                      type="number"
                      min={0}
                      max={1000000}
                      defaultValue={
                        editing?.definition.condition.minimumSample ?? 1
                      }
                      required
                    />
                  </Field>
                  <Field
                    name="destinations"
                    label={t("Notify destinations", "通知先")}
                  >
                    <select
                      name="destinations"
                      multiple
                      required
                      defaultValue={editing?.definition.destinations}
                    >
                      {data?.destinations
                        .filter((d) => d.state === "ENABLED")
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <MetricFields
                  comparison={false}
                  defaults={editing?.definition.measurement.query}
                />
                {trigger === "TREND" && (
                  <>
                    <p>
                      {t(
                        "Trigger metric and period",
                        "きっかけとなる指標と期間",
                      )}
                    </p>
                    <MetricFields
                      prefix="trigger"
                      comparison={false}
                      defaults={
                        editing?.definition.trigger.kind === "TREND"
                          ? editing.definition.trigger.query
                          : undefined
                      }
                    />
                    <div className="operations-fields">
                      <Field name="mode" label={t("Trend rule", "比較方法")}>
                        <select
                          name="mode"
                          defaultValue={
                            editing?.definition.trigger.kind === "TREND"
                              ? editing.definition.trigger.mode
                              : "THRESHOLD"
                          }
                        >
                          {[
                            "THRESHOLD",
                            "WEEK_OVER_WEEK",
                            "PERIOD_OVER_PERIOD",
                            "RELATIVE_CHANGE",
                          ].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </Field>
                      <Field name="direction" label={t("Direction", "方向")}>
                        <select
                          name="direction"
                          defaultValue={
                            editing?.definition.trigger.kind === "TREND"
                              ? editing.definition.trigger.direction
                              : undefined
                          }
                        >
                          <option>ABOVE</option>
                          <option>BELOW</option>
                        </select>
                      </Field>
                      <Field
                        name="threshold"
                        label={t(
                          "Threshold (relative change: 0.2 = 20%)",
                          "しきい値（相対変化: 0.2 = 20%）",
                        )}
                      >
                        <input
                          name="threshold"
                          type="number"
                          step="any"
                          defaultValue={
                            editing?.definition.trigger.kind === "TREND"
                              ? editing.definition.trigger.threshold
                              : 0
                          }
                          required
                        />
                      </Field>
                    </div>
                  </>
                )}
                <DestinationField
                  name="escalationId"
                  optional
                  defaultValue={editing?.definition.escalation?.destinationId}
                />
                <Field
                  name="afterMinutes"
                  label={t("Escalate after minutes", "追加通知までの分数")}
                >
                  <input
                    name="afterMinutes"
                    type="number"
                    min={15}
                    max={10080}
                    defaultValue={
                      editing?.definition.escalation?.afterMinutes ?? 60
                    }
                  />
                </Field>
                {data?.access.features.approval_workflow && (
                  <label>
                    <input
                      name="approval"
                      type="checkbox"
                      defaultChecked={editing?.approval_required}
                    />
                    {t(
                      "Require independent approval",
                      "別の担当者による承認を必要にする",
                    )}
                  </label>
                )}
                <Button>{t("Save draft revision", "改訂を下書き保存")}</Button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setTrigger("FORUM_SUPPORT");
                    }}
                  >
                    {t("Create new", "新規作成")}
                  </button>
                )}
              </form>
            </Gate>
          </section>
          {data?.books?.map((book) => (
            <article className="surface" key={book.id}>
              <h2>
                {book.name} · {t("revision", "改訂")} {book.revision}
              </h2>
              <p>{state(book.state)}</p>
              <p>
                {book.definition.trigger.kind === "ATTENTION"
                  ? book.definition.trigger.type
                  : book.definition.trigger.mode}{" "}
                →{" "}
                {book.definition.destinations
                  .map(
                    (id) =>
                      data.destinations.find((d) => d.id === id)?.name ?? "—",
                  )
                  .join(", ")}
              </p>
              <div className="operations-actions">
                <button
                  disabled={busy || !can("playbooks")}
                  onClick={() => {
                    setEditing(book);
                    setTrigger(
                      book.definition.trigger.kind === "ATTENTION"
                        ? book.definition.trigger.type
                        : "TREND",
                    );
                    window.scrollTo(0, 0);
                  }}
                >
                  {t("Revise", "改訂")}
                </button>
                {can("team_assignment") && book.state === "DRAFT" && (
                  <Field
                    name={"reviewTeam-" + book.id}
                    label={t("Review team", "レビュー担当チーム")}
                  >
                    <select
                      value={reviewTeams[book.id] ?? book.review_team_id ?? ""}
                      onChange={(e) =>
                        setReviewTeams((current) => ({
                          ...current,
                          [book.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">—</option>
                      {data.teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {["SUBMITTED", "APPROVED", "ACTIVE", "ARCHIVED"].map(
                  (value) => (
                    <button
                      key={value}
                      disabled={
                        busy ||
                        !can(
                          "playbooks",
                          value === "APPROVED" ? "GOVERN" : "CONFIGURE",
                        ) ||
                        (value === "SUBMITTED" && book.state !== "DRAFT") ||
                        (value === "APPROVED" && book.state !== "SUBMITTED") ||
                        (value === "ACTIVE" &&
                          !(book.approval_required
                            ? book.state === "APPROVED"
                            : ["DRAFT", "APPROVED"].includes(book.state)))
                      }
                      onClick={() =>
                        void send("playbookTransition", {
                          id: book.id,
                          version: book.version,
                          state: value,
                          ...(value === "SUBMITTED" && can("team_assignment")
                            ? {
                                teamId:
                                  reviewTeams[book.id] ??
                                  book.review_team_id ??
                                  null,
                              }
                            : {}),
                        })
                      }
                    >
                      {value}
                    </button>
                  ),
                )}
                {can("automation_sandbox", "ANALYZE") && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void send("dryRun", { id: book.id, days: 7 })
                    }
                  >
                    {t("Dry run · 7 days", "過去7日で試行")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </>
      )}
      {view === "reports" && (
        <>
          <section className="surface">
            <h2>{t("Report template", "レポートのテンプレート")}</h2>
            <Gate feature="scheduled_reports">
              <form
                onSubmit={submit("reportTemplate", (f) => ({
                  title: text(f, "title"),
                  footer: text(f, "footer"),
                  logoBase64: logo,
                  queries: f.getAll("metrics").map((metric) =>
                    chartQuerySchema.parse({
                      metric,
                      days: number(f, "days"),
                      compare: f.get("compare") === "on",
                    }),
                  ),
                  viewIds: f.getAll("views"),
                  includeAttention: f.get("attention") === "on",
                  includeInterventions: f.get("interventions") === "on",
                }))}
              >
                <Field name="title" label={t("Report title", "タイトル")} />
                <div className="operations-fields">
                  <Field
                    name="metrics"
                    label={t(
                      "Choose up to four charts / saved views in total",
                      "指標・保存ビューを合計4つまで選択",
                    )}
                  >
                    <select name="metrics" multiple defaultValue={["reply"]}>
                      {metrics.map((metric) => (
                        <option key={metric}>{metric}</option>
                      ))}
                    </select>
                  </Field>
                  <Field name="views" label={t("Saved views", "保存ビュー")}>
                    <select name="views" multiple>
                      {data?.views?.map((saved) => (
                        <option key={saved.id} value={saved.id}>
                          {saved.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field name="days" label={t("Period", "期間")}>
                    <select name="days">
                      <option value={7}>7 {t("days", "日")}</option>
                      <option value={30}>30 {t("days", "日")}</option>
                    </select>
                  </Field>
                </div>
                <label>
                  <input name="compare" type="checkbox" />
                  {t("Previous period comparison", "前の期間との比較")}
                </label>
                <label>
                  <input name="attention" type="checkbox" defaultChecked />
                  {t("Attention summary", "対応状況の集計")}
                </label>
                <label>
                  <input name="interventions" type="checkbox" defaultChecked />
                  {t("Intervention reviews", "施策レビュー")}
                </label>
                <Field name="footer" label={t("Footer", "フッター")}>
                  <input name="footer" maxLength={200} />
                </Field>
                <label>
                  {t(
                    "Organization logo · PNG up to 100 KB",
                    "組織ロゴ · PNG 100 KBまで",
                  )}
                  <input
                    type="file"
                    accept="image/png"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        setLogo(null);
                        return;
                      }
                      if (file.size > 100000) {
                        setError("INVALID_PNG_LOGO");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () =>
                        setLogo(String(reader.result).split(",")[1] ?? null);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <Button>{t("Save template", "テンプレートを保存")}</Button>
              </form>
            </Gate>
          </section>
          <section className="surface">
            <h2>{t("Schedule report", "定期レポートを設定")}</h2>
            <Gate feature="scheduled_reports">
              <form
                onSubmit={submit("reportSchedule", (f) => ({
                  templateId: text(f, "templateId"),
                  destinationId: text(f, "destinationId"),
                  format: text(f, "format"),
                  clock: {
                    cadence: text(f, "cadence"),
                    timezone: text(f, "timezone"),
                    day: number(f, "day"),
                    hour: number(f, "hour"),
                    minute: number(f, "minute"),
                  },
                }))}
              >
                <Field name="templateId" label={t("Template", "テンプレート")}>
                  <select name="templateId" required>
                    {data?.reports?.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <DestinationField />
                <div className="operations-fields">
                  <Field name="cadence" label={t("Frequency", "頻度")}>
                    <select name="cadence">
                      <option>WEEKLY</option>
                      <option>MONTHLY</option>
                    </select>
                  </Field>
                  <Field
                    name="day"
                    label={t(
                      "Weekday (0=Sun) / monthly day (1–28)",
                      "曜日（0=日曜）・毎月の日（1〜28）",
                    )}
                  >
                    <input
                      name="day"
                      type="number"
                      min={0}
                      max={28}
                      defaultValue={1}
                    />
                  </Field>
                  <Field name="timezone" label={t("Timezone", "タイムゾーン")}>
                    <input name="timezone" defaultValue="Asia/Tokyo" required />
                  </Field>
                  <Field name="hour" label={t("Hour", "時")}>
                    <input
                      name="hour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={9}
                    />
                  </Field>
                  <Field name="minute" label={t("Minute", "分")}>
                    <input
                      name="minute"
                      type="number"
                      min={0}
                      max={59}
                      defaultValue={0}
                    />
                  </Field>
                  <Field name="format" label={t("Delivery", "送信形式")}>
                    <select name="format">
                      <option>DISCORD</option>
                      {data?.access.features.recurring_exports &&
                        ["CSV", "JSON", "WEBHOOK"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                    </select>
                  </Field>
                </div>
                <Button>{t("Create schedule", "定期送信を作成")}</Button>
              </form>
            </Gate>
          </section>
          {data?.reports?.schedules.map((schedule) => (
            <article className="surface" key={schedule.id}>
              <h2>
                {
                  data.reports?.templates.find(
                    (template) => template.id === schedule.template_id,
                  )?.title
                }
              </h2>
              <p>
                {schedule.cadence} · {schedule.timezone} · {schedule.format} ·{" "}
                {state(schedule.state)}
              </p>
              <p>
                {t("Next", "次回")}: {schedule.next_at}
              </p>
              <button
                disabled={busy || !configure}
                onClick={() =>
                  void send("reportEnabled", {
                    id: schedule.id,
                    enabled: schedule.state !== "ENABLED",
                  })
                }
              >
                {schedule.state === "ENABLED"
                  ? t("Disable", "停止")
                  : t("Review & enable", "確認して再開")}
              </button>
            </article>
          ))}
          <section className="surface">
            <h2>{t("Delivery history", "送信履歴")}</h2>
            {data?.reports?.runs.map((run) => (
              <p key={run.id}>
                {run.scheduled_at} · {state(run.state)} · {run.last_error ?? ""}
              </p>
            ))}
          </section>
        </>
      )}
      {view === "improvements" && (
        <>
          <section className="surface">
            <h2>{t("Record an intervention", "施策を記録")}</h2>
            <Gate feature="improvement_tracking" permission="OPERATE">
              <form
                onSubmit={submit("intervention", (f) => ({
                  title: text(f, "title"),
                  query: query(f),
                  ...(text(f, "teamId") ? { teamId: text(f, "teamId") } : {}),
                }))}
              >
                <Field
                  name="title"
                  label={t("What did you change?", "実施した施策")}
                />
                <MetricFields comparison={false} />
                <TeamField />
                <Button>{t("Record & measure", "記録して測定")}</Button>
              </form>
            </Gate>
            <p>
              {t(
                "Measurement starts with the next full day. Before / after differences do not establish causality.",
                "翌日の開始から期間全体を測定します。前後の変化から因果関係は断定しません。",
              )}
            </p>
          </section>
          {data?.improvements?.map((item) => (
            <article className="surface" key={item.id}>
              <h2>{item.title}</h2>
              <p>
                {state(item.state)} · {t("Review after", "レビュー予定")}:{" "}
                {item.review_at}
              </p>
              {evidence(item.baseline.evidence)}
              {item.after_snapshot && evidence(item.after_snapshot.evidence)}
              {item.comparison && (
                <p>
                  {item.comparison.comparable
                    ? item.comparison.absoluteChange
                    : item.comparison.blockers.join(", ")}{" "}
                  ·{" "}
                  {t(
                    "Observed difference; no causal claim.",
                    "観測された差分です。因果関係を示すものではありません。",
                  )}
                </p>
              )}
            </article>
          ))}
        </>
      )}
      {view === "intake" && (
        <>
          <section className="surface">
            <h2>{t("Create an intake panel", "相談パネルを作成")}</h2>
            <Gate feature="intake_panels">
              <form
                key={editingPanel?.id ?? "new-panel"}
                onSubmit={submit("intake", (f) => ({
                  ...(editingPanel
                    ? { id: editingPanel.id, version: editingPanel.version }
                    : {}),
                  title: text(f, "title"),
                  category: text(f, "category"),
                  ...(data?.access.features.surface_breakdowns
                    ? {
                        destinationId: text(f, "destinationId") || null,
                        fields: formFields,
                      }
                    : {}),
                }))}
              >
                <Field name="title" label={t("Panel title", "タイトル")}>
                  <input
                    name="title"
                    required
                    maxLength={80}
                    defaultValue={editingPanel?.title}
                  />
                </Field>
                <Field
                  name="category"
                  label={t("Request category", "相談の分類")}
                >
                  <input
                    name="category"
                    required
                    maxLength={50}
                    defaultValue={editingPanel?.category}
                  />
                </Field>
                {data?.access.features.surface_breakdowns && (
                  <>
                    <DestinationField
                      optional
                      defaultValue={editingPanel?.destination_id ?? undefined}
                    />
                    {formFields.map((field, index) => (
                      <div className="operations-fields" key={index}>
                        <label>
                          {t("Field key", "項目キー")}
                          <input
                            value={field.key}
                            onChange={(e) =>
                              setFormFields(
                                formFields.map((value, i) =>
                                  i === index
                                    ? { ...value, key: e.target.value }
                                    : value,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          {t("Label", "項目名")}
                          <input
                            value={field.label}
                            maxLength={45}
                            onChange={(e) =>
                              setFormFields(
                                formFields.map((value, i) =>
                                  i === index
                                    ? { ...value, label: e.target.value }
                                    : value,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) =>
                              setFormFields(
                                formFields.map((value, i) =>
                                  i === index
                                    ? { ...value, required: e.target.checked }
                                    : value,
                                ),
                              )
                            }
                          />
                          {t("Required", "必須")}
                        </label>
                        <button
                          type="button"
                          disabled={formFields.length === 1}
                          onClick={() =>
                            setFormFields(
                              formFields.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {t("Remove", "削除")}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={formFields.length >= 5}
                      onClick={() =>
                        setFormFields([
                          ...formFields,
                          {
                            key: "field_" + formFields.length,
                            label: t("Additional context", "補足"),
                            required: false,
                            maxLength: 1000,
                          },
                        ])
                      }
                    >
                      {t("Add field", "項目を追加")}
                    </button>
                  </>
                )}
                <Button>{t("Save draft", "下書き保存")}</Button>
                {editingPanel && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditingPanel(null)}
                  >
                    {t("Create new", "新規作成")}
                  </button>
                )}
              </form>
            </Gate>
            <p>
              {t(
                "Only explicitly submitted form fields are stored. No conversation transcript is collected.",
                "利用者がフォームで送信した項目だけを保存します。会話の記録は収集しません。",
              )}
            </p>
          </section>
          {data?.intake?.panels.map((panel) => (
            <article className="surface" key={panel.id}>
              <h2>{panel.title}</h2>
              <p>
                {panel.category} · {state(panel.state)}
              </p>
              {configure && (
                <div className="operations-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingPanel(panel);
                      setFormFields(panel.fields);
                    }}
                  >
                    {t("Review & edit", "確認・編集")}
                  </button>
                  {panel.state !== "DISABLED" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void send("intakeDisable", {
                          id: panel.id,
                          version: panel.version,
                        })
                      }
                    >
                      {t("Disable", "停止")}
                    </button>
                  )}
                </div>
              )}
              {panel.state === "DRAFT" && can("intake_panels") && (
                <form
                  onSubmit={submit("intakePublish", (f) => ({
                    id: panel.id,
                    version: panel.version,
                    channelId: text(f, "channelId"),
                  }))}
                >
                  <Field
                    name="channelId"
                    label={t("Discord channel ID", "DiscordチャンネルID")}
                  />
                  <Button>{t("Publish to Discord", "Discordに公開")}</Button>
                </form>
              )}
            </article>
          ))}
          <section className="surface">
            <h2>{t("Requests", "相談一覧")}</h2>
            {data?.intake?.requests.map((request) => (
              <p key={request.id}>
                {request.category} · {state(request.status)} ·{" "}
                {request.created_at}{" "}
                {data.access.permissions.includes("OPERATE") && (
                  <button
                    disabled={busy}
                    onClick={() => void send("intakeRead", { id: request.id })}
                  >
                    {t("Read form", "内容を確認")}
                  </button>
                )}
              </p>
            ))}
          </section>
        </>
      )}
      {view === "events" && (
        <>
          <section className="surface">
            <h2>{t("Reusable event template", "繰り返し使えるイベント")}</h2>
            <Gate feature="event_operations">
              <form
                key={editingEvent?.id ?? "new-event"}
                onSubmit={submit("event", (f) => ({
                  ...(editingEvent
                    ? { id: editingEvent.id, revision: editingEvent.revision }
                    : {}),
                  title: text(f, "title"),
                  timezone: text(f, "timezone"),
                  localStart: text(f, "localStart"),
                  durationMinutes: number(f, "durationMinutes"),
                  recurrence: text(f, "recurrence"),
                  location: text(f, "location"),
                }))}
              >
                <Field name="title" label={t("Title", "タイトル")}>
                  <input
                    name="title"
                    defaultValue={editingEvent?.title}
                    required
                    maxLength={100}
                  />
                </Field>
                <div className="operations-fields">
                  <Field
                    name="localStart"
                    label={t("Local start", "現地時刻の開始日時")}
                  >
                    <input
                      name="localStart"
                      type="datetime-local"
                      defaultValue={
                        editingEvent ? localEventStart(editingEvent) : undefined
                      }
                      required
                    />
                  </Field>
                  <Field name="timezone" label={t("Timezone", "タイムゾーン")}>
                    <input
                      name="timezone"
                      defaultValue={editingEvent?.timezone ?? "Asia/Tokyo"}
                      required
                    />
                  </Field>
                  <Field
                    name="durationMinutes"
                    label={t("Duration in minutes", "時間（分）")}
                  >
                    <input
                      name="durationMinutes"
                      type="number"
                      min={1}
                      max={1440}
                      defaultValue={editingEvent?.duration_minutes ?? 60}
                    />
                  </Field>
                  <Field name="recurrence" label={t("Recurrence", "繰り返し")}>
                    <select
                      name="recurrence"
                      defaultValue={editingEvent?.recurrence}
                    >
                      <option>ONCE</option>
                      <option>WEEKLY</option>
                      <option>MONTHLY</option>
                    </select>
                  </Field>
                  <Field
                    name="location"
                    label={t("Location / calendar link", "場所・リンク")}
                  >
                    <input
                      name="location"
                      defaultValue={editingEvent?.location}
                      maxLength={200}
                    />
                  </Field>
                </div>
                <Button>{t("Save event", "イベントを保存")}</Button>
                {editingEvent && (
                  <button type="button" onClick={() => setEditingEvent(null)}>
                    {t("New event", "新しいイベント")}
                  </button>
                )}
              </form>
            </Gate>
          </section>
          {data?.events?.map((event) => (
            <article className="surface" key={event.id}>
              <h2>{event.title}</h2>
              <p>
                {event.starts_at} · {event.timezone} · {event.recurrence} ·{" "}
                {state(event.state)}
              </p>
              {can("event_operations", "READ") && event.state === "ENABLED" && (
                <a href={"/operations/data?format=ics&id=" + event.id}>
                  {t("Calendar link / ICS export", "カレンダーリンク・ICS出力")}
                </a>
              )}
              {can("event_operations") && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditingEvent(event);
                    window.scrollTo(0, 0);
                  }}
                >
                  {t("Edit / review event", "イベントを編集・再確認")}
                </button>
              )}
            </article>
          ))}
          <p>
            {t(
              "Google Calendar sync: PLANNED. Event signup does not prove attendance.",
              "Google Calendar同期: PLANNED。参加登録は実際の出席を証明しません。",
            )}
          </p>
        </>
      )}
      {view === "organization" && (
        <>
          <section className="surface">
            <h2>
              {data?.organization?.name ??
                t("Set up your organization", "組織を設定")}
            </h2>
            <Gate feature="multi_guild" permission="GOVERN">
              {!data?.organization ? (
                <form
                  onSubmit={submit("organization", (f) => ({
                    name: text(f, "name"),
                  }))}
                >
                  <Field name="name" label={t("Organization name", "組織名")} />
                  <Button>{t("Create organization", "組織を作成")}</Button>
                </form>
              ) : (
                <form
                  onSubmit={submit("linkGuild", (f) => ({
                    guildId: text(f, "guildId"),
                  }))}
                >
                  <Field
                    name="guildId"
                    label={t(
                      "Additional Discord server ID",
                      "追加するDiscordサーバーID",
                    )}
                  />
                  <Button>
                    {t("Verify & link server", "確認してサーバーを追加")}
                  </Button>
                </form>
              )}
            </Gate>
          </section>
          <section className="surface">
            <h2>{t("Community command center", "コミュニティ全体の状況")}</h2>
            {data?.communities?.map((community) => (
              <article key={community.guildId}>
                <h3>{community.guildId}</h3>
                <p>
                  {state(community.state)} ·{" "}
                  {t("Open attention", "未完了の対応")}:{" "}
                  {community.openAttention ?? "UNKNOWN"} ·{" "}
                  {t("Sync health", "同期状況")}:{" "}
                  {community.health?.status ??
                    community.health?.state ??
                    "UNKNOWN"}
                </p>
                <p>
                  {t("Change", "変化")}:{" "}
                  {community.change?.comparable
                    ? community.change.absoluteChange
                    : "UNKNOWN"}
                </p>
              </article>
            ))}
            {data?.guilds?.map((guild) => (
              <p key={guild.guild_id}>
                {guild.guild_id} · {state(guild.state)}
                {guild.state === "REQUIRES_REVIEW" &&
                  can("multi_guild", "GOVERN") && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void send("linkGuild", {
                          guildId: guild.guild_id,
                          review: true,
                        })
                      }
                    >
                      {t("Verify & reactivate", "確認して再開")}
                    </button>
                  )}
              </p>
            ))}
            <p>
              {t(
                "Community-level aggregates only. Members are not tracked across servers.",
                "コミュニティ単位の集計だけを表示します。サーバー間で利用者を追跡しません。",
              )}
            </p>
          </section>
          <section className="surface">
            <h2>
              {t("Team members & NEXUS roles", "チームメンバーとNEXUS権限")}
            </h2>
            <Gate feature="rbac" permission="GOVERN">
              <form
                onSubmit={submit("member", (f) => ({
                  userId: text(f, "userId"),
                  name: text(f, "name"),
                  role: text(f, "role"),
                  ...(text(f, "revision")
                    ? { revision: number(f, "revision") }
                    : {}),
                }))}
              >
                <div className="operations-fields">
                  <Field
                    name="userId"
                    label={t(
                      "Staff Discord user ID",
                      "運営担当者のDiscordユーザーID",
                    )}
                  />
                  <Field name="name" label={t("Display name", "表示名")} />
                  <Field name="role" label={t("NEXUS role", "NEXUS権限")}>
                    <select name="role">
                      {["OWNER", "ADMIN", "OPERATOR", "ANALYST", "VIEWER"].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field
                    name="revision"
                    label={t(
                      "Current revision when updating",
                      "更新時は現在の改訂番号",
                    )}
                  >
                    <input name="revision" type="number" min={1} />
                  </Field>
                </div>
                <Button>
                  {t("Verify membership & save", "所属を確認して保存")}
                </Button>
              </form>
            </Gate>
            {data?.members?.map((member) => (
              <p key={member.id}>
                {member.name} · {member.role} · {state(member.state ?? "")} · r
                {member.revision}{" "}
                {govern && (
                  <button
                    disabled={busy}
                    onClick={() => void send("revokeMember", { id: member.id })}
                  >
                    {t("Revoke access", "権限を解除")}
                  </button>
                )}
              </p>
            ))}
            <p>
              {t(
                "Discord roles and NEXUS team roles are separate.",
                "DiscordのRoleとNEXUSのチーム権限は別に管理します。",
              )}
            </p>
          </section>
          <section className="surface">
            <h2>{t("Teams", "担当チーム")}</h2>
            <Gate feature="team_assignment" permission="GOVERN">
              <form
                onSubmit={submit("team", (f) => ({
                  name: text(f, "name"),
                  memberIds: f.getAll("members"),
                }))}
              >
                <Field name="name" label={t("Team name", "チーム名")} />
                <Field name="members" label={t("Members", "担当者")}>
                  <select name="members" multiple required>
                    {data?.members
                      ?.filter((member) => member.state === "ACTIVE")
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button>{t("Create team", "チームを作成")}</Button>
              </form>
            </Gate>
            {data?.teams.map((team) => (
              <p key={team.id}>{team.name}</p>
            ))}
          </section>
          {can("audit_export", "GOVERN") && (
            <section className="surface">
              <h2>{t("Audit export", "監査記録の出力")}</h2>
              <a href="/operations/data?format=audit-csv">CSV</a> ·{" "}
              <a href="/operations/data?format=audit-json">JSON</a>
            </section>
          )}
          <p>
            {t(
              "Ask NEXUS, SAML SSO, SCIM, data residency and custom DPA: PLANNED.",
              "Ask NEXUS、SAML SSO、SCIM、データ保存地域、個別DPA: PLANNED。",
            )}
          </p>
        </>
      )}
      {view === "integrations" && (
        <>
          <section className="surface">
            <h2>{t("Notification destination", "通知先")}</h2>
            {configure && (
              <Gate feature="surface_breakdowns">
                <form
                  onSubmit={submit("destination", (f) => ({
                    name: text(f, "name"),
                    kind: routeKind,
                    ...(routeKind === "DISCORD"
                      ? {
                          channelId: text(f, "channelId"),
                          roleId: text(f, "roleId") || null,
                        }
                      : routeKind === "WEBHOOK"
                        ? { endpointId: text(f, "endpointId") }
                        : { teamId: text(f, "teamId") }),
                  }))}
                >
                  <Field name="name" label={t("Name", "名前")} />
                  <Field
                    name="kind"
                    label={t("Destination type", "通知先の種類")}
                  >
                    <select
                      value={routeKind}
                      onChange={(e) => setRouteKind(e.target.value)}
                    >
                      <option>DISCORD</option>
                      {data?.access.features.webhooks && (
                        <option>WEBHOOK</option>
                      )}
                      {data?.access.features.team_assignment && (
                        <option>TEAM</option>
                      )}
                    </select>
                  </Field>
                  {routeKind === "DISCORD" ? (
                    <>
                      <Field
                        name="channelId"
                        label={t("Channel ID", "チャンネルID")}
                      />
                      {data?.access.features.team_routing && (
                        <Field
                          name="roleId"
                          label={t(
                            "Notify role ID (optional)",
                            "通知するRole ID（任意）",
                          )}
                        >
                          <input name="roleId" />
                        </Field>
                      )}
                    </>
                  ) : routeKind === "WEBHOOK" ? (
                    <Field name="endpointId" label={t("Endpoint", "送信先")}>
                      <select name="endpointId" required>
                        {data?.webhooks?.endpoints
                          .filter((endpoint) => endpoint.state === "ENABLED")
                          .map((endpoint) => (
                            <option key={endpoint.id} value={endpoint.id}>
                              {endpoint.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  ) : (
                    <TeamField />
                  )}
                  <Button>
                    {t("Verify & save destination", "確認して通知先を保存")}
                  </Button>
                </form>
              </Gate>
            )}
            {data?.destinations.map((destination) => (
              <p key={destination.id}>
                {destination.name} · {destination.kind} ·{" "}
                {state(destination.state ?? "")}{" "}
                {configure && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void send("destinationDisable", { id: destination.id })
                    }
                  >
                    {t("Disable", "停止")}
                  </button>
                )}
                {configure && destination.state !== "ENABLED" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void send("destinationResume", { id: destination.id })
                    }
                  >
                    {t("Verify & reactivate", "確認して再開")}
                  </button>
                )}
              </p>
            ))}
          </section>
          <section className="surface">
            <h2>{t("API credentials", "APIの接続情報")}</h2>
            <Gate feature="api">
              <form
                onSubmit={submit("credential", (f) => ({
                  name: text(f, "name"),
                  kind: text(f, "kind"),
                  scopes: f.getAll("scopes"),
                }))}
              >
                <Field name="name" label={t("Name", "名前")} />
                <Field name="kind" label={t("Type", "種類")}>
                  <select name="kind">
                    <option>PERSONAL</option>
                    {data?.access.features.advanced_api && (
                      <option>SERVICE_ACCOUNT</option>
                    )}
                  </select>
                </Field>
                <Field
                  name="scopes"
                  label={t("Allowed access", "利用を許可する情報")}
                >
                  <select
                    name="scopes"
                    multiple
                    required
                    defaultValue={["guild:read", "metrics:read"]}
                  >
                    {[
                      "guild:read",
                      "metrics:read",
                      "attention:read",
                      "interventions:read",
                      ...(data?.access.features.advanced_api
                        ? ["attention:write", "organization:read"]
                        : []),
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Button>{t("Create credential", "接続情報を作成")}</Button>
              </form>
            </Gate>
            {data?.credentials?.map((credential) => (
              <article key={credential.id}>
                <h3>
                  {credential.name} · {state(credential.state ?? "")}
                </h3>
                <p>
                  {credential.prefix} · {credential.scopes.join(", ")}
                </p>
                <button
                  disabled={
                    busy || !configure || credential.state === "REVOKED"
                  }
                  onClick={() =>
                    void send("credentialRevoke", { id: credential.id })
                  }
                >
                  {t("Revoke", "無効化")}
                </button>
                {credential.state === "PAUSED_PLAN_LIMIT" && (
                  <button
                    disabled={busy || !can("api")}
                    onClick={() =>
                      void send("credentialResume", { id: credential.id })
                    }
                  >
                    {t("Review & resume", "確認して再開")}
                  </button>
                )}
              </article>
            ))}
            <p>
              GET /v1/guild · /v1/metrics · /v1/attention · /v1/interventions
            </p>
          </section>
          <section className="surface">
            <h2>{t("Outbound webhooks", "Webhook送信")}</h2>
            <Gate feature="webhooks">
              <form
                onSubmit={submit("webhook", (f) => ({
                  name: text(f, "name"),
                  url: text(f, "url"),
                  events: f.getAll("events"),
                }))}
              >
                <Field name="name" label={t("Name", "名前")} />
                <Field name="url" label={t("HTTPS endpoint", "HTTPS送信先")}>
                  <input name="url" type="url" required maxLength={2048} />
                </Field>
                <Field name="events" label={t("Events", "送信する更新")}>
                  <select
                    name="events"
                    multiple
                    required
                    defaultValue={["attention.created"]}
                  >
                    {[
                      "attention.created",
                      "attention.resolved",
                      "playbook.executed",
                      "intervention.review_ready",
                      "coverage.changed",
                      ...(data?.access.features.recurring_exports
                        ? ["aggregate.export"]
                        : []),
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Button>
                  {t("Create signed webhook", "署名付きWebhookを作成")}
                </Button>
              </form>
            </Gate>
            {data?.webhooks?.endpoints.map((endpoint) => (
              <article key={endpoint.id}>
                <h3>
                  {endpoint.name} · {state(endpoint.state ?? "")}
                </h3>
                <p>
                  {endpoint.url} · {t("Key version", "鍵の版")}:{" "}
                  {endpoint.secret_version}
                </p>
                <button
                  disabled={busy || !can("webhooks")}
                  onClick={() =>
                    void send("webhookRotate", { id: endpoint.id })
                  }
                >
                  {t("Rotate secret", "秘密鍵を更新")}
                </button>
                <button
                  disabled={busy || !configure}
                  onClick={() =>
                    void send("webhookEnabled", {
                      id: endpoint.id,
                      enabled: endpoint.state !== "ENABLED",
                    })
                  }
                >
                  {endpoint.state === "ENABLED"
                    ? t("Disable", "停止")
                    : t("Review & enable", "確認して再開")}
                </button>
              </article>
            ))}
          </section>
          <section className="surface">
            <h2>{t("Webhook delivery logs", "Webhook送信履歴")}</h2>
            {data?.webhooks?.deliveries.map((delivery) => (
              <p key={delivery.id}>
                {state(delivery.state)} · {t("Attempts", "試行")}:{" "}
                {delivery.attempts} · HTTP {delivery.last_status ?? "—"} ·{" "}
                {delivery.last_error ?? ""}
              </p>
            ))}
          </section>
          <p>
            {t(
              "Slack, email, Jira and CRM destinations: PLANNED.",
              "Slack、メール、Jira、CRMへの通知: PLANNED。",
            )}
          </p>
        </>
      )}
    </UiContext>
  );
}
