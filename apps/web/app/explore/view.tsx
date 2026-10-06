"use client";
import { useEffect, useState } from "react";
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
  capabilities: { advanced: boolean; csv: boolean; historyDays: number | null };
  channels: { id: string; type: number; observable: boolean }[];
};
export function ExploreControls({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja",
    [query, setQuery] = useState<ChartQuery>(chartQuerySchema.parse({})),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [shortcut, setShortcut] = useState<string>(""),
    [selected, setSelected] = useState<View | null>(null);
  const url = "/explore/data?q=" + encodeURIComponent(JSON.stringify(query));
  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store" }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "UNAVAILABLE");
      setData(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
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
  }, [url]);
  async function save(action: "saveView" | "saveSegment") {
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSelected(null);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  function patchFilter(patch: Partial<ChartQuery["filter"]>) {
    setQuery((current) => ({
      ...current,
      filter: { ...current.filter, ...patch },
    }));
  }
  const spec = data?.spec,
    maximum = Math.max(
      1,
      ...(spec?.series.flatMap((series) =>
        series.points.map((p) => p.value ?? 0),
      ) ?? []),
    );
  return (
    <>
      <header className="page-head">
        <h1>{ja ? "コミュニティを分析" : "Explore your community"}</h1>
        <p>
          {ja
            ? "観測された集計を比較し、運営の変化を確認します。変化の原因は断定しません。"
            : "Compare aggregate observations and inspect operational changes. A change does not establish its cause."}
        </p>
      </header>
      <section className="surface explore-controls">
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
            {["reply", "forum", "voice", "event", "reaction", "poll"].map(
              (metric) => (
                <option key={metric}>{metric}</option>
              ),
            )}
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
                  data?.capabilities.historyDays !== null &&
                  days > (data?.capabilities.historyDays ?? 30)
                }
              >
                {days} days
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={query.compare}
            disabled={!data?.capabilities.advanced}
            onChange={(e) => setQuery({ ...query, compare: e.target.checked })}
          />
          {ja ? "前の同期間と比較" : "Compare previous period"}
        </label>
        {data?.capabilities.advanced && (
          <>
            <label>
              {ja ? "観測面" : "Surface"}
              <select
                value={query.filter.surface}
                onChange={(e) =>
                  patchFilter({
                    surface: e.target.value as ChartQuery["filter"]["surface"],
                  })
                }
              >
                {["ALL", "TEXT", "FORUM", "VOICE", "EVENT"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
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
                    #{channel.id} · {channel.type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ja
                ? "Role ID（カンマ区切り）"
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
              {ja ? "Recipe revision ID" : "Recipe revision ID"}
              <input
                value={query.filter.recipeVersionId ?? ""}
                onChange={(e) =>
                  patchFilter({ recipeVersionId: e.target.value || null })
                }
              />
            </label>
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
              {ja ? "保存したセグメント" : "Saved segment"}
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
          </>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">{ja ? "確認中…" : "Loading…"}</p>}
      {spec && (
        <>
          <section className="surface">
            <h2>{spec.title}</h2>
            <p>
              {spec.range.from.slice(0, 10)} — {spec.range.to.slice(0, 10)} ·{" "}
              {spec.evidence.coverageState}
            </p>
            <strong>{spec.evidence.value ?? "NO DATA"}</strong>
            <svg
              role="img"
              aria-label={spec.title}
              viewBox="0 0 960 310"
              style={{ width: "100%", maxHeight: 350 }}
            >
              {spec.series[0]?.points.map((point, index) => {
                const width = 900 / spec.series[0]!.points.length,
                  height = ((point.value ?? 0) / maximum) * 240;
                return (
                  <g key={point.bucket}>
                    <title>
                      {point.bucket}: {point.value ?? "NO DATA"} ·{" "}
                      {point.evidence.coverageState}
                    </title>
                    <rect
                      x={30 + index * width}
                      y={270 - height}
                      width={Math.max(1, width - 2)}
                      height={point.value === null ? 5 : Math.max(1, height)}
                      fill={point.value === null ? "#707e74" : "#a5cd51"}
                    />
                    {spec.series[1]?.points[index]?.value != null && (
                      <circle
                        cx={30 + (index + 0.5) * width}
                        cy={
                          270 -
                          (spec.series[1]!.points[index]!.value! / maximum) *
                            240
                        }
                        r={3}
                        fill="#71b8ee"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
            {spec.comparison && (
              <p>
                {ja ? "前の期間" : "Previous"}:{" "}
                {spec.comparison.value ?? "UNKNOWN"} ·{" "}
                {spec.comparison.comparable
                  ? (spec.comparison.absoluteChange ?? "UNKNOWN")
                  : spec.comparison.blockers.join(", ")}{" "}
                {spec.comparison.comparable &&
                spec.comparison.relativeChange !== null
                  ? `(${Math.round(spec.comparison.relativeChange * 100)}%)`
                  : ""}
              </p>
            )}
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
            <details>
              <summary>Evidence</summary>
              <p>{spec.evidence.definition}</p>
              <p>{spec.evidence.coverageReasons.join(", ") || "COMPLETE"}</p>
              <p>{spec.evidence.observationState}</p>
              {spec.caveats.map((caveat) => (
                <p key={caveat}>{caveat}</p>
              ))}
            </details>
          </section>
          {!!spec.breakdowns?.length && (
            <section className="surface">
              <h2>
                {ja
                  ? "チャンネル比較とDrilldown"
                  : "Channel comparison and drilldown"}
              </h2>
              {spec.breakdowns.map((target) => (
                <details key={target.channelId}>
                  <summary>
                    #{target.channelId} · {target.evidence.value ?? "NO DATA"}
                  </summary>
                  {target.points.map((point) => (
                    <p key={point.bucket}>
                      {point.bucket.slice(0, 10)} · {point.value ?? "NO DATA"} ·{" "}
                      {point.evidence.coverageState}
                    </p>
                  ))}
                  <button
                    onClick={() =>
                      patchFilter({ channelIds: [target.channelId] })
                    }
                  >
                    {ja ? "このチャンネルを分析" : "Explore this channel"}
                  </button>
                </details>
              ))}
            </section>
          )}
          {!!spec.heatmap.length && (
            <section className="surface">
              <h2>{ja ? "曜日 × 時間" : "Weekday × hour"}</h2>
              <p>
                {query.timezone} · ? = NO DATA · 0 ={" "}
                {ja ? "観測済み、該当なし" : "observed, none recorded"}
              </p>
              <div className="heatmap-grid">
                {spec.heatmap.map((cell) => (
                  <span
                    key={cell.weekday + ":" + cell.hour}
                    title={`${cell.weekday} · ${cell.hour}:00 · ${cell.value ?? "NO DATA"}`}
                    style={{
                      background:
                        cell.value === null
                          ? "#26342b"
                          : `rgba(165,205,81,${Math.min(1, 0.08 + (cell.value ?? 0) / Math.max(1, ...spec.heatmap.map((c) => c.value ?? 0)))})`,
                    }}
                  >
                    {cell.value === null ? "?" : cell.value}
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {data?.capabilities.advanced && (
        <section className="surface">
          <h2>
            {ja
              ? "保存ビューとレポートショートカット"
              : "Saved views and report shortcuts"}
          </h2>
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
            disabled={busy || !name}
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
            disabled={busy || !name}
            onClick={() => void save("saveSegment")}
          >
            {ja ? "セグメントを保存" : "Save segment"}
          </button>
          {data.views.map((view) => (
            <button
              key={view.id}
              onClick={() => {
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
    </>
  );
}
