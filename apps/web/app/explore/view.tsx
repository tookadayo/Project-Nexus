"use client";
import "./explore.css";
import { ObservationChart } from "../observation-chart";
import { CurrentAccessPanel } from "../current-access";
import type { CurrentAccess } from "../../../../packages/operations/src/access-presentation";
import { metricLabels, surfaceLabels } from "../analysis-labels";
import { useDraft, useUnsavedChanges } from "../navigation-safety";
import { exploreLocation, exploreQuery } from "./navigation";
import { safeError } from "../safe-error";
import { useEffect, useState, useRef, type SetStateAction } from "react";
import {
  chartQuerySchema,
  type ChartSpec,
  type ChartQuery,
} from "../../../../packages/analytics/src/chart-spec";
type View = ChartQuery & {
  id: string;
  name: string;
  revision: number;
  shortcut: string | null;
};
type Data = {
  spec: ChartSpec;
  views: View[];
  segments: { id: string; name: string; filters: ChartQuery["filter"] }[];
  capabilities: {
    advanced: boolean;
    compare: boolean;
    canSave: boolean;
    saveReason: string | null;
    csv: boolean;
    historyDays: number | null;
    access?: CurrentAccess;
  };
  channels: { id: string; type: number; observable: boolean }[];
};
const defaultQuery = chartQuerySchema.parse({});
export function ExploreControls({
  locale,
  scope = "",
  initialQuery = defaultQuery,
  filtersReset = false,
}: {
  locale: "ja" | "en";
  scope?: string;
  initialQuery?: ChartQuery;
  filtersReset?: boolean;
}) {
  const ja = locale === "ja",
    [query, setQueryState] = useState<ChartQuery>(initialQuery),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [saving, setSaving] = useState(false),
    [name, setName] = useState(""),
    [shortcut, setShortcut] = useState<string>(""),
    [selected, setSelected] = useState<View | null>(null),
    [filtersOpen, setFiltersOpen] = useState(
      initialQuery.filter.surface !== "ALL" ||
        initialQuery.filter.channelIds.length > 0 ||
        initialQuery.filter.roleIds.length > 0 ||
        initialQuery.filter.categoryIds.length > 0 ||
        Boolean(initialQuery.filter.recipeVersionId),
    );
  const savingRef = useRef(false);
  const draft = useDraft({ name, shortcut, query });
  const canLeave = useUnsavedChanges(
    (Boolean(name || selected) && draft.dirty) || saving,
    locale,
  );
  const navigation = useRef({ canLeave });
  navigation.current = { canLeave };
  const index = useRef(0);
  function setQuery(update: SetStateAction<ChartQuery>) {
    const next = typeof update === "function" ? update(query) : update;
    if (scope && chartQuerySchema.safeParse(next).success) {
      index.current += 1;
      window.history.pushState(
        {
          ...window.history.state,
          nexusExplore: { scope, index: index.current },
        },
        "",
        exploreLocation(next, scope),
      );
    }
    setQueryState(next);
  }
  useEffect(() => {
    if (!scope) return;
    index.current =
      window.history.state?.nexusExplore?.scope === scope
        ? window.history.state.nexusExplore.index
        : 0;
    window.history.replaceState(
      {
        ...window.history.state,
        nexusExplore: { scope, index: index.current },
      },
      "",
      exploreLocation(initialQuery, scope),
    );
    let restoring = false;
    const restore = (event: PopStateEvent) => {
      if (restoring) {
        restoring = false;
        return;
      }
      const target = event.state?.nexusExplore;
      if (!navigation.current.canLeave()) {
        restoring = true;
        window.history.go(
          target?.scope === scope ? index.current - target.index : 1,
        );
        return;
      }
      index.current = target?.scope === scope ? target.index : 0;
      setQueryState(
        exploreQuery(new URL(window.location.href).searchParams, scope),
      );
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [scope, initialQuery]);
  const url =
    "/explore/data?guild=" +
    encodeURIComponent(scope) +
    "&q=" +
    encodeURIComponent(JSON.stringify(query));
  useEffect(() => {
    let active = true;
    setData(null);
    setBusy(true);
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [url, reload]);
  async function save(action: "saveView" | "saveSegment") {
    if (savingRef.current || !data?.capabilities.canSave) return;
    savingRef.current = true;
    setSaving(true);
    setBusy(true);
    setError("");
    try {
      const payload =
        action === "saveView"
          ? {
              action,
              view: {
                ...query,
                name,
                shortcut: shortcut || null,
                ...(selected
                  ? { id: selected.id, revision: selected.revision }
                  : {}),
              },
            }
          : { action, segment: { name, filters: query.filter } };
      const response = await fetch("/explore/data", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Nexus-Guild": scope,
          },
          body: JSON.stringify(payload),
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error);
      draft.saved();
      setSelected(null);
      setReload((current) => current + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "UNAVAILABLE");
    } finally {
      savingRef.current = false;
      setSaving(false);
      setBusy(false);
    }
  }
  function patchFilter(patch: Partial<ChartQuery["filter"]>) {
    setQuery((current) => ({
      ...current,
      filter: { ...current.filter, ...patch },
    }));
  }
  const spec = data?.spec;
  const filtered =
    query.filter.surface !== "ALL" ||
    query.filter.channelIds.length > 0 ||
    query.filter.roleIds.length > 0 ||
    query.filter.categoryIds.length > 0 ||
    Boolean(query.filter.recipeVersionId);
  return (
    <div className="explore-workspace">
      {filtersReset && (
        <p role="status">
          {ja
            ? "サーバーが変わったか、条件を確認できないため、絞り込み条件を初期状態に戻しました。"
            : "Filters were reset because the server changed or the conditions could not be verified."}
        </p>
      )}
      <header className="page-head">
        <h1>{ja ? "コミュニティを分析" : "Explore your community"}</h1>
        <p>
          {ja
            ? "活動の推移と対象ごとの差を確認します。集計の変化だけで原因は断定しません。"
            : "See activity over time and differences across channels. A change in the data does not establish its cause."}
        </p>
      </header>
      {data?.capabilities.access && (
        <CurrentAccessPanel access={data.capabilities.access} locale={locale} />
      )}
      <section
        className="surface explore-controls"
        aria-label={ja ? "分析する条件" : "Analysis conditions"}
      >
        <div className="explore-primary-controls">
          <label>
            {ja ? "指標" : "Metric"}
            <select
              value={query.metric}
              onChange={(e) =>
                setQuery({
                  ...query,
                  metric: e.target.value as ChartQuery["metric"],
                })
              }
            >
              {(
                [
                  "reply",
                  "forum",
                  "voice",
                  "event",
                  "reaction",
                  "poll",
                ] as const
              ).map((metric) => (
                <option key={metric} value={metric}>
                  {metricLabels[metric][locale]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {ja ? "期間" : "Period"}
            <select
              value={query.days}
              onChange={(e) =>
                setQuery({
                  ...query,
                  days: Number(e.target.value) as ChartQuery["days"],
                })
              }
            >
              {[7, 30, 90].map((days) => (
                <option
                  key={days}
                  value={days}
                  disabled={
                    data?.capabilities.historyDays != null &&
                    days > data.capabilities.historyDays
                  }
                >
                  {days} {ja ? "日" : "days"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={query.compare}
              disabled={!query.compare && !data?.capabilities.compare}
              onChange={(e) =>
                setQuery({ ...query, compare: e.target.checked })
              }
            />
            {ja ? "前の同期間と比較" : "Compare previous period"}
          </label>
          {query.compare && (
            <button
              type="button"
              onClick={() => setQuery({ ...query, compare: false })}
            >
              {ja ? "比較を解除" : "Turn off comparison"}
            </button>
          )}
        </div>
        <p className="explore-read-note">
          {ja
            ? "条件を変えると集計を表示します。この画面の確認で詳細分析の利用枠は消費しません。"
            : "Results update as you change the conditions. Viewing this page does not consume detailed analysis credits."}
        </p>
        {data?.capabilities.advanced && (
          <details
            className="explore-filter-details"
            open={filtersOpen}
            onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
          >
            <summary>
              {ja ? "対象を絞り込む" : "Refine the scope"}
              {filtered && (
                <span>{ja ? " · 絞り込み中" : " · Filters applied"}</span>
              )}
            </summary>
            <div className="explore-filter-grid">
              <label>
                {ja ? "活動の種類" : "Activity type"}
                <select
                  value={query.filter.surface}
                  onChange={(e) =>
                    patchFilter({
                      surface: e.target
                        .value as ChartQuery["filter"]["surface"],
                    })
                  }
                >
                  {(["ALL", "TEXT", "FORUM", "VOICE", "EVENT"] as const).map(
                    (value) => (
                      <option key={value} value={value}>
                        {surfaceLabels[value][locale]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {ja ? "チャンネル（複数選択）" : "Channels (select several)"}
                <select
                  multiple
                  value={query.filter.channelIds}
                  onChange={(e) =>
                    patchFilter({
                      channelIds: Array.from(
                        e.target.selectedOptions,
                        (option) => option.value,
                      ),
                    })
                  }
                >
                  {data.channels.map((channel) => (
                    <option
                      key={channel.id}
                      value={channel.id}
                      disabled={!channel.observable}
                    >
                      #{channel.id} ·{" "}
                      {channel.type === 15
                        ? ja
                          ? "フォーラム"
                          : "Forum"
                        : [2, 13].includes(channel.type)
                          ? ja
                            ? "ボイス"
                            : "Voice"
                          : ja
                            ? "テキスト"
                            : "Text"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {ja
                  ? "ロールID（カンマ区切り）"
                  : "Role cohort IDs (comma separated)"}
                <input
                  value={query.filter.roleIds.join(",")}
                  onChange={(e) =>
                    patchFilter({
                      roleIds: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                {ja ? "カテゴリーID" : "Category IDs"}
                <input
                  value={query.filter.categoryIds.join(",")}
                  onChange={(e) =>
                    patchFilter({
                      categoryIds: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                {ja
                  ? "測定方法の版ID（任意）"
                  : "Measurement recipe version ID (optional)"}
                <input
                  aria-describedby="recipe-version-help"
                  value={query.filter.recipeVersionId ?? ""}
                  onChange={(e) =>
                    patchFilter({ recipeVersionId: e.target.value || null })
                  }
                />
              </label>
              <p id="recipe-version-help">
                {ja
                  ? "特定の測定方法の版で得た記録に絞る場合だけ、その版のID（UUID）を入力します。改訂番号ではありません。空欄では版による絞り込みを行いません。"
                  : "Enter the version ID (UUID), not its revision number, only to filter records collected with that measurement recipe version. Leave blank to include all versions."}
              </p>
              <label>
                {ja ? "タイムゾーン" : "Timezone"}
                <input
                  value={query.timezone}
                  onChange={(e) =>
                    setQuery({ ...query, timezone: e.target.value })
                  }
                />
              </label>
              <label>
                {ja ? "保存した絞り込み条件" : "Saved filters"}
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const segment = data.segments.find(
                      (s) => s.id === e.target.value,
                    );
                    if (segment) patchFilter(segment.filters);
                  }}
                >
                  <option value="">—</option>
                  {data.segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        )}
      </section>
      {error && <p role="alert">{safeError(error, locale)}</p>}
      {busy && <p role="status">{ja ? "確認中…" : "Loading…"}</p>}
      {spec && (
        <>
          <ObservationChart
            spec={spec}
            locale={locale}
            onChannelSelect={(id) => {
              setFiltersOpen(true);
              patchFilter({ channelIds: [id] });
            }}
          />
          <p>
            <a href={url + "&format=png"}>
              {ja ? "Discordと同じPNGを保存" : "Download the Discord PNG"}
            </a>
            {data?.capabilities.csv && (
              <>
                {" "}
                ·{" "}
                <a href={url + "&format=csv"}>
                  {ja ? "集計CSV" : "Aggregate CSV"}
                </a>
              </>
            )}
          </p>
        </>
      )}
      {data?.capabilities.advanced && (
        <section className="surface explore-save">
          <h2>
            {ja
              ? "保存ビューとレポートショートカット"
              : "Saved views and report shortcuts"}
          </h2>
          {!data.capabilities.canSave && (
            <p role="status">
              {safeError(data.capabilities.saveReason ?? "UNAVAILABLE", locale)}
            </p>
          )}
          <label>
            {ja ? "名前" : "Name"}
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {ja ? "Discordショートカット" : "Discord shortcut"}
            <select
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
            >
              <option value="">—</option>
              <option value="support-health">/nexus support-health</option>
              <option value="newcomer-flow">/nexus newcomer-flow</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !name || !data.capabilities.canSave}
            onClick={() => void save("saveView")}
          >
            {selected
              ? ja
                ? "ビューを更新"
                : "Update view"
              : ja
                ? "ビューを保存"
                : "Save view"}
          </button>
          <button
            disabled={busy || !name || !data.capabilities.canSave}
            onClick={() => void save("saveSegment")}
          >
            {ja ? "絞り込み条件を保存" : "Save filters"}
          </button>
          {data.views.map((view) => (
            <button
              key={view.id}
              onClick={() => {
                if (!canLeave()) return;
                draft.saved({
                  name: view.name,
                  shortcut: view.shortcut ?? "",
                  query: {
                    metric: view.metric,
                    days: view.days,
                    compare: view.compare,
                    timezone: view.timezone,
                    filter: view.filter,
                  },
                });
                setSelected(view);
                setName(view.name);
                setShortcut(view.shortcut ?? "");
                setQuery({
                  metric: view.metric,
                  days: view.days,
                  compare: view.compare,
                  timezone: view.timezone,
                  filter: view.filter,
                });
              }}
            >
              {view.name} · {view.days}d
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
