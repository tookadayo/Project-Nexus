"use client";
import { useId, useRef, useState, useEffect } from "react";
import { ConfirmationDialog } from "./confirmation-dialog";
import type { ChartSpec } from "../../../packages/analytics/src/chart-spec";
import { chartLinePath } from "../../../packages/analytics/src/chart-language";
import {
  chartTitle,
  chartUnit,
  chartValue,
  chartDate,
  evidenceLabel,
  graphMaximum,
  metricDescription,
  coverageReason,
  heatMix,
  type ChartLocale,
} from "./chart-presentation";
import "./observation-chart.css";
type Selection = { label: string; value: number | null; coverage?: string };
/** Pure presentation: no fetch, credentials, mutation, quota or tenant hooks. */
export function ObservationChart({
  spec,
  locale,
  compact = false,
  onChannelSelect,
}: {
  spec: ChartSpec;
  locale: ChartLocale;
  compact?: boolean;
  onChannelSelect?: (id: string) => void;
}) {
  const ja = locale === "ja",
    id = useId(),
    plotContainer = useRef<HTMLDivElement>(null),
    [plotWidth, setPlotWidth] = useState(760),
    origin = useRef<HTMLElement | SVGElement | null>(null),
    [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => {
    const element = plotContainer.current;
    if (!element) return;
    const measure = () =>
      setPlotWidth(Math.max(200, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const current = spec.series.find((s) => s.key === "CURRENT")?.points ?? [],
    previous = spec.series.find((s) => s.key === "PREVIOUS")?.points ?? [],
    max = graphMaximum(spec),
    stride = Math.max(
      1,
      Math.ceil(
        current.length / Math.max(2, Math.floor((plotWidth - 72) / 65)),
      ),
    ),
    unit = chartUnit(locale),
    value = (n: number | null) => chartValue(n, locale),
    date = (s: string) => chartDate(s, locale),
    pointX = (index: number) =>
      60 + ((index + 0.5) * (plotWidth - 72)) / Math.max(1, current.length),
    pointY = (n: number) => 256 - (n / max) * 210;
  const open = (selected: Selection, target: HTMLElement | SVGElement) => {
    origin.current = target;
    setSelection(selected);
  };
  const label = (index: number) => {
    const p = current[index]!;
    return `${ja ? "本期間" : "Current period"}: ${date(p.bucket)} · ${value(p.value)} ${unit}${previous[index] ? ` / ${ja ? "比較期間" : "Previous period"}: ${date(previous[index]!.bucket)} · ${value(previous[index]!.value)} ${unit}` : ""}`;
  };
  const weekdays = ja
      ? ["日", "月", "火", "水", "木", "金", "土"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    heatMax = Math.max(0, ...spec.heatmap.map((c) => c.value ?? 0));
  return (
    <section
      className={`observation-chart${compact ? " compact" : ""}`}
      aria-labelledby={id + "-title"}
    >
      <p className="chart-purpose">
        {ja ? "日ごとの活動の変化" : "How activity changes over time"}
      </p>
      <h2 id={id + "-title"}>{chartTitle(spec, locale)}</h2>
      <p>{metricDescription[spec.metric][ja ? 0 : 1]}</p>
      <p>
        {date(spec.range.from)} — {date(spec.range.to)}{" "}
        {ja ? "（終了時点を含まない）" : "(end exclusive)"} · UTC
      </p>
      <p className="chart-total">
        {ja ? "合計" : "Total"}: <strong>{value(spec.evidence.value)}</strong>{" "}
        {unit} · {evidenceLabel(spec.evidence.observationState, locale)} ·{" "}
        {evidenceLabel(spec.evidence.coverageState, locale)}
      </p>
      <div className="chart-legend">
        <span className="chart-current">
          ● ━ {ja ? "本期間" : "Current period"}
        </span>
        {previous.length > 0 && (
          <span className="chart-previous">
            ◆ ┄ {ja ? "比較期間" : "Previous period"}:{" "}
            {date(previous[0]!.bucket)} — {date(previous.at(-1)!.bucket)}
          </span>
        )}
        <span>
          ?{" "}
          {ja ? "欠測・不明（ゼロとは別）" : "Missing / unavailable (not zero)"}
        </span>
      </div>
      {previous.length > 0 && (
        <p className="chart-note">
          {ja
            ? "比較期間の同じ経過日の値を重ねています。実際の日付は値の一覧で確認できます。"
            : "Previous-period values are aligned by elapsed day. The value table shows both actual dates."}
        </p>
      )}
      <div ref={plotContainer} className="chart-plot-scroll">
        <svg
          className="observation-plot"
          viewBox={`0 0 ${plotWidth} 310`}
          role="group"
          aria-label={
            ja
              ? "日別の件数。各点の選択または下の一覧で値を確認できます。"
              : "Daily observations. Select a point or use the value table below."
          }
        >
          <text x="58" y="18">
            {unit}
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction, i) => (
            <g key={i}>
              <line
                x1="58"
                x2={plotWidth - 12}
                y1={256 - fraction * 210}
                y2={256 - fraction * 210}
                className="chart-gridline"
              />
              <text x="50" y={260 - fraction * 210} textAnchor="end">
                {new Intl.NumberFormat(locale, {
                  maximumFractionDigits: 1,
                }).format(max * fraction)}
              </text>
            </g>
          ))}
          <path
            className="chart-line"
            d={chartLinePath(current, pointX, pointY)}
          />
          {previous.length > 0 && (
            <path
              className="chart-line chart-line-previous"
              d={chartLinePath(previous, pointX, pointY)}
            />
          )}
          {current.map((p, i) => {
            const step = (plotWidth - 72) / Math.max(1, current.length),
              x = 60 + i * step,
              height = p.value === null ? 0 : (p.value / max) * 210;
            return (
              <g
                key={p.bucket}
                role="button"
                tabIndex={0}
                aria-label={label(i)}
                onClick={(e) =>
                  open(
                    {
                      label: label(i),
                      value: p.value,
                      coverage: p.evidence.coverageState,
                    },
                    e.currentTarget,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(
                      {
                        label: label(i),
                        value: p.value,
                        coverage: p.evidence.coverageState,
                      },
                      e.currentTarget,
                    );
                  }
                }}
              >
                <title>{label(i)}</title>
                <rect
                  className="chart-hit"
                  x={x}
                  y="30"
                  width={step}
                  height="230"
                />
                {p.value === null ? (
                  <text x={x + step / 2} y="245" textAnchor="middle">
                    ?
                  </text>
                ) : (
                  <circle
                    className="chart-point"
                    cx={x + step / 2}
                    cy={256 - height}
                    r="4"
                  />
                )}
                {previous[i]?.value != null && (
                  <rect
                    className="chart-dot"
                    x={x + step / 2 - 3.5}
                    y={256 - (previous[i]!.value! / max) * 210 - 3.5}
                    width="7"
                    height="7"
                  />
                )}
                {((i % stride === 0 && current.length - 1 - i >= stride / 2) ||
                  i === current.length - 1) && (
                  <text x={x + step / 2} y="279" textAnchor="middle">
                    {new Date(p.bucket).toISOString().slice(5, 10)}
                  </text>
                )}
              </g>
            );
          })}
          <text x={plotWidth / 2} y="304" textAnchor="middle">
            {ja ? "日付（UTC）" : "Date (UTC)"}
          </text>
        </svg>
      </div>
      {spec.comparison && (
        <p>
          {ja ? "比較期間の合計" : "Previous total"}:{" "}
          {value(spec.comparison.value)} {unit} ·{" "}
          {spec.comparison.comparable
            ? `${ja ? "確認できた差" : "Observed difference"}: ${value(spec.comparison.absoluteChange)} ${unit}${spec.comparison.relativeChange === null ? "" : ` (${new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(spec.comparison.relativeChange)})`}`
            : evidenceLabel(spec.comparison.blockers[0] ?? "UNKNOWN", locale)}
          .{" "}
          {ja
            ? "変化の原因や対応の効果は断定できません。"
            : "This does not establish cause or the effect of an intervention."}
        </p>
      )}
      <details className="chart-values">
        <summary>
          {ja ? "すべての日付と値を表示" : "Show all dates and values"}
        </summary>
        <div
          className="chart-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={
            ja
              ? "日別の値の一覧。横にスクロールできます。"
              : "Daily value table. Scroll horizontally."
          }
        >
          <table>
            <caption>{unit} · UTC</caption>
            <thead>
              <tr>
                <th>{ja ? "本期間の日付" : "Current date"}</th>
                <th>{ja ? "本期間" : "Current"}</th>
                {previous.length > 0 && (
                  <>
                    <th>{ja ? "比較期間の日付" : "Previous date"}</th>
                    <th>{ja ? "比較期間" : "Previous"}</th>
                  </>
                )}
                <th>{ja ? "詳細" : "Details"}</th>
              </tr>
            </thead>
            <tbody>
              {current.map((p, i) => (
                <tr key={p.bucket}>
                  <th scope="row">{date(p.bucket)}</th>
                  <td>{value(p.value)}</td>
                  {previous.length > 0 && (
                    <>
                      <td>
                        {previous[i]
                          ? date(previous[i]!.bucket)
                          : ja
                            ? "対応なし"
                            : "No corresponding day"}
                      </td>
                      <td>{value(previous[i]?.value ?? null)}</td>
                    </>
                  )}
                  <td>
                    <button
                      type="button"
                      onClick={(e) =>
                        open(
                          {
                            label: label(i),
                            value: p.value,
                            coverage: p.evidence.coverageState,
                          },
                          e.currentTarget,
                        )
                      }
                    >
                      {ja ? "値を見る" : "View value"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {!compact && !!spec.breakdowns?.length && (
        <details>
          <summary>{ja ? "チャンネルごとの内訳" : "Channel breakdown"}</summary>
          {spec.breakdowns.map((b) => (
            <details key={b.channelId}>
              <summary>
                #{b.channelId}: {value(b.evidence.value)} {unit} ·{" "}
                {evidenceLabel(b.evidence.coverageState, locale)}{" "}
              </summary>
              <div
                className="chart-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={
                  ja ? "チャンネルの日別の値" : "Daily channel values"
                }
              >
                <table>
                  <thead>
                    <tr>
                      <th>{ja ? "日付 (UTC)" : "Date (UTC)"}</th>
                      <th>{unit}</th>
                      <th>{ja ? "取得範囲" : "Coverage"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.points.map((p) => (
                      <tr key={p.bucket}>
                        <th scope="row">{date(p.bucket)}</th>
                        <td>{value(p.value)}</td>
                        <td>
                          {evidenceLabel(p.evidence.coverageState, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {onChannelSelect && (
                <button
                  type="button"
                  onClick={() => onChannelSelect(b.channelId)}
                >
                  {ja ? "このチャンネルを分析" : "Explore this channel"}
                </button>
              )}
            </details>
          ))}
        </details>
      )}
      {!compact && !!spec.heatmap.length && (
        <section>
          <h3>
            {ja ? "曜日・時間ごとの件数" : "Activity by weekday and hour"}
          </h3>
          <p>
            {spec.range.timezone} · {unit} ·{" "}
            {ja
              ? "色が濃いほど件数が多い"
              : "Darker blue means more recorded activities"}
            : 0–{heatMax}.{" "}
            {ja
              ? "?は欠測・不明、0は取得できた範囲でのゼロです。"
              : "? means unavailable; 0 is an observed zero."}
          </p>
          <p>
            {ja
              ? "横にスクロールして各時間を確認できます。セルを選ぶと詳細が開きます。選択したタイムゾーンで曜日・時間を集計します（同じ曜日・時間の繰り返しを合算）。"
              : "Scroll horizontally to see every hour. Select a cell for details. Weekday/hour buckets combine occurrences in the selected timezone."}
          </p>
          <div
            className="chart-table-scroll heatmap"
            tabIndex={0}
            role="region"
            aria-label={ja ? "曜日と時間の一覧" : "Weekday and hour table"}
          >
            <table>
              <thead>
                <tr>
                  <th>{ja ? "曜日 / 時" : "Day / hour"}</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} scope="col">
                      {h}:00
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekdays.map((day, d) => (
                  <tr key={day}>
                    <th scope="row">{day}</th>
                    {Array.from({ length: 24 }, (_, h) => {
                      const n =
                          spec.heatmap.find(
                            (c) => c.weekday === d && c.hour === h,
                          )?.value ?? null,
                        ratio = n === null ? 0 : n / Math.max(1, heatMax);
                      return (
                        <td key={h}>
                          <button
                            type="button"
                            className={
                              n === null
                                ? "heat-unknown"
                                : ratio > 0.7
                                  ? "heat-high"
                                  : "heat-low"
                            }
                            style={
                              n === null
                                ? undefined
                                : {
                                    backgroundColor: `color-mix(in srgb, #2758ca ${heatMix(ratio)}%, white)`,
                                  }
                            }
                            aria-label={`${day} ${h}:00 ${spec.range.timezone}: ${value(n)} ${unit}`}
                            onClick={(e) =>
                              open(
                                {
                                  label: `${day} ${h}:00 ${spec.range.timezone}`,
                                  value: n,
                                },
                                e.currentTarget,
                              )
                            }
                          >
                            {n === null ? "?" : n}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <details>
        <summary>
          {ja ? "取得範囲と測定の根拠" : "Coverage and measurement evidence"}
        </summary>
        <p>
          {evidenceLabel(spec.evidence.observationState, locale)} ·{" "}
          {evidenceLabel(spec.evidence.coverageState, locale)}
        </p>
        <p>
          {ja ? "集計に使えた記録数" : "Records used"}:{" "}
          {spec.evidence.sampleSize}
        </p>
        {spec.evidence.coverageReasons.length > 0 && (
          <p>
            {ja
              ? spec.evidence.coverageReasons
                  .map((r) => coverageReason(r, locale))
                  .join(" ")
              : spec.evidence.coverageReasons
                  .map((r) => coverageReason(r, locale))
                  .join(" ")}
          </p>
        )}
        <p>
          {ja
            ? "日別グラフは完了したUTC日を使用します。ロール条件は現在確認できた所属に基づきます。活動の件数を個人の評価や継続参加率として扱いません。変化の原因や対応の効果は断定できません。時間別の取得範囲は保持された元の記録に限られ、欠測を0件には置き換えません。"
            : "Daily charts use completed UTC days. Role filters use the current observed cohort. Observation counts are not individual scores or retention rates. Changes do not establish causes or intervention effects. Hourly coverage is limited to retained raw observations; missing values are not zero."}
        </p>
      </details>
      {selection && (
        <ConfirmationDialog
          className="chart-dialog"
          label={ja ? "値の詳細" : "Value details"}
          returnFocus={origin}
          onCancel={() => setSelection(null)}
        >
          <h3 id={id + "-detail"}>{ja ? "値の詳細" : "Value details"}</h3>
          {selection && (
            <>
              <p>{selection.label}</p>
              <p>
                {value(selection.value)} {unit}
              </p>
              {selection.coverage && (
                <p>{evidenceLabel(selection.coverage, locale)}</p>
              )}
            </>
          )}
          <button type="button" onClick={() => setSelection(null)}>
            {ja ? "閉じる" : "Close"}
          </button>
        </ConfirmationDialog>
      )}
    </section>
  );
}
