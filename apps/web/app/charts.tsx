"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActionPresentation,
  ExperimentPresentation,
  JourneyStage,
  ResponseDistribution,
  RetentionCohort,
  TrendPoint,
} from "../../../packages/presentation/src/types";
import "./legacy-charts.css";
import { heatMix } from "./chart-presentation";

type Locale = "ja" | "en";
const COLORS = {
  primary: "#2758ca",
  previous: "#765027",
  grid: "#dbe3ef",
  text: "#53627a",
};
const tooltipStyle = {
  background: "#ffffff",
  color: "#172b4d",
  border: "1px solid #b8c7de",
  borderRadius: 8,
};
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const unknown = (locale: Locale) =>
  locale === "ja" ? "確認できません" : "Unavailable";
const display = (value: number | null, locale: Locale) =>
  value === null
    ? unknown(locale)
    : new Intl.NumberFormat(locale).format(value);
const maturityLabel = (value: string, locale: Locale) =>
  ({
    mature: locale === "ja" ? "集計期間終了" : "Completed period",
    provisional: locale === "ja" ? "集計途中" : "Period in progress",
    unavailable: unknown(locale),
  })[value] ?? unknown(locale);
const coverageLabel = (value: string, locale: Locale) =>
  ({
    healthy:
      locale === "ja" ? "対象範囲のデータあり" : "Data available within scope",
    degraded: locale === "ja" ? "一部のデータのみ" : "Partial data",
    incomplete: locale === "ja" ? "データが不足しています" : "Incomplete data",
    unavailable: unknown(locale),
  })[value] ?? unknown(locale);
function ValueTable({
  locale,
  title,
  headers,
  rows,
}: {
  locale: Locale;
  title: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="legacy-chart-values">
      <summary>
        {locale === "ja" ? "値と集計条件を見る" : "View values and conditions"}
      </summary>
      <div
        className="legacy-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th scope="row" key={cellIndex}>
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
export function MetricCard({
  label,
  value,
  previous,
  delta,
  sample,
  maturity,
  coverageStatus,
  coverageLabel,
}: {
  label: string;
  value: string;
  previous: string;
  delta: string;
  sample: number;
  maturity: string;
  coverageStatus: string;
  coverageLabel: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <h3>{label}</h3>
        <span className={`health ${coverageStatus}`}>{coverageLabel}</span>
      </div>
      <strong className="value">{value}</strong>
      <div className="comparison">
        <span>{previous}</span>
        <span
          className={
            delta.startsWith("+") ? "up" : delta.startsWith("−") ? "down" : ""
          }
        >
          {delta}
        </span>
      </div>
      <footer>
        n = {sample.toLocaleString()} · {maturity}
      </footer>
    </article>
  );
}
export function TrendChart({
  title,
  points,
  emptyLabel,
  locale = "en",
}: {
  title: string;
  points: TrendPoint[];
  emptyLabel: string;
  locale?: Locale;
}) {
  const ja = locale === "ja",
    values = points.map((p) => ({
      ...p,
      label: p.bucket.slice(5),
      display: p.value === null ? null : p.value * 100,
    }));
  return (
    <section className="chart-card legacy-chart">
      <h3>{title}</h3>
      <p className="legacy-chart-note">
        {ja
          ? "日ごとの割合（%） · UTC。空白は欠測・不明です。"
          : "Daily rate (%) · UTC. Gaps mean missing or unavailable values."}
      </p>
      {points.some((p) => p.value !== null) ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            accessibilityLayer
            data={values}
            margin={{ top: 12, right: 8, bottom: 0, left: -18 }}
          >
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="label" stroke={COLORS.text} fontSize={12} />
            <YAxis
              stroke={COLORS.text}
              fontSize={12}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [`${Number(v).toFixed(1)}%`, title]}
            />
            <Line
              type="linear"
              dataKey="display"
              stroke={COLORS.primary}
              strokeWidth={2.4}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <EmptyChart label={emptyLabel} />
      )}
      <ValueTable
        locale={locale}
        title={title}
        headers={[
          ja ? "日付 (UTC)" : "Date (UTC)",
          "%",
          ja ? "対象件数" : "Sample records",
          ja ? "集計期間" : "Period",
          ja ? "取得範囲" : "Coverage",
        ]}
        rows={points.map((p) => [
          p.bucket,
          p.value === null ? unknown(locale) : pct(p.value),
          p.sampleSize,
          maturityLabel(p.maturity, locale),
          coverageLabel(p.coverage.status, locale),
        ])}
      />
    </section>
  );
}
export function JourneyFunnel({
  stages,
  labels,
}: {
  stages: JourneyStage[];
  labels: Record<string, string | readonly string[]>;
}) {
  return (
    <section
      className="funnel"
      aria-label={String(labels.milestones ?? "Journey milestones")}
    >
      {stages.map((stage) => (
        <div className="funnel-stage" key={stage.key}>
          <div>
            <span>{String(labels[stage.key] ?? stage.key)}</span>
            <strong>
              {stage.value === null
                ? "—"
                : stage.valueKind === "rate"
                  ? pct(stage.value)
                  : stage.value.toLocaleString()}
            </strong>
          </div>
          <footer>
            <span>
              {String(labels[stage.sampleKind] ?? stage.sampleKind)} n=
              {stage.sampleSize.toLocaleString()}
            </span>
            <span>
              {String(labels[stage.maturity] ?? stage.maturity)} ·{" "}
              {String(labels[stage.coverage.label] ?? stage.coverage.label)}
            </span>
          </footer>
        </div>
      ))}
    </section>
  );
}
export function CohortHeatmap({
  cohorts,
  labels,
  locale = "en",
}: {
  cohorts: RetentionCohort[];
  labels: { cohort: string; members: string; empty: string };
  locale?: Locale;
}) {
  const ja = locale === "ja",
    days = [1, 7, 30];
  return (
    <section className="chart-card legacy-chart">
      <h3>{labels.cohort}</h3>
      <p className="legacy-chart-note">
        {ja
          ? "参加後の日別の活動割合（%）。濃い青ほど高い割合です。空欄は0%ではありません。"
          : "Activity rate (%) by day after joining. Darker blue means a higher rate; unavailable values are not 0%."}
      </p>
      {cohorts.length ? (
        <div
          className="legacy-chart-scroll"
          tabIndex={0}
          role="region"
          aria-label={labels.cohort}
        >
          <table className="cohort-value-table">
            <caption>{labels.cohort} · UTC</caption>
            <thead>
              <tr>
                <th scope="col">
                  {ja ? "参加日 / 人数" : "Join date / members"}
                </th>
                {days.map((day) => (
                  <th key={day} scope="col">
                    {ja ? `参加後${day}日目` : `Day ${day}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.slice(-12).map((cohort) => (
                <tr key={cohort.cohort}>
                  <th scope="row">
                    {cohort.cohort}
                    <small>
                      {labels.members}: {cohort.members}
                    </small>
                  </th>
                  {(["d1", "d7", "d30"] as const).map((key) => (
                    <td
                      key={key}
                      style={{
                        background:
                          cohort[key] === null
                            ? "#f3f5f8"
                            : `color-mix(in srgb, #2758ca ${heatMix(cohort[key]!)}%, white)`,
                        color:
                          cohort[key] !== null && cohort[key]! > 0.7
                            ? "white"
                            : "#172b4d",
                      }}
                    >
                      <strong>
                        {cohort[key] === null
                          ? unknown(locale)
                          : pct(cohort[key])}
                      </strong>
                      <small>
                        {maturityLabel(cohort.maturity[key], locale)}
                      </small>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyChart label={labels.empty} />
      )}
    </section>
  );
}
export function ResponseDistributionChart({
  rows,
  title,
  labels,
  emptyLabel,
  locale = "en",
}: {
  rows: ResponseDistribution[];
  title: string;
  labels: Record<ResponseDistribution["bucket"], string>;
  emptyLabel: string;
  locale?: Locale;
}) {
  const ja = locale === "ja",
    unit = ja ? "件" : "records",
    data = rows.map((row) => ({
      name: labels[row.bucket],
      value: row.count ?? undefined,
    }));
  return (
    <section className="chart-card legacy-chart">
      <h3>{title}</h3>
      <p className="legacy-chart-note">
        {ja
          ? "最初の返信までの時間別の件数"
          : "Records by time to first response"}{" "}
        · {unit}
      </p>
      {rows.some((row) => row.count !== null) ? (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            accessibilityLayer
            layout="vertical"
            data={data}
            margin={{ top: 8, right: 15, bottom: 8, left: 0 }}
          >
            <CartesianGrid stroke={COLORS.grid} horizontal={false} />
            <XAxis
              type="number"
              stroke={COLORS.text}
              fontSize={12}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke={COLORS.text}
              fontSize={12}
              width={128}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, unit]} />
            <Bar
              dataKey="value"
              fill={COLORS.primary}
              radius={[0, 5, 5, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <EmptyChart label={emptyLabel} />
      )}
      <ValueTable
        locale={locale}
        title={title}
        headers={[ja ? "返信までの時間" : "Time to response", unit, "%"]}
        rows={rows.map((row) => [
          labels[row.bucket],
          display(row.count, locale),
          row.rate === null ? unknown(locale) : pct(row.rate),
        ])}
      />
    </section>
  );
}
export function ExperimentComparison({
  item,
  labels,
  locale = "en",
}: {
  item: ExperimentPresentation;
  labels: { control: string; treatment: string; rate: string };
  locale?: Locale;
}) {
  const ja = locale === "ja",
    data = [
      {
        name: labels.control,
        rate: item.control.rate === null ? undefined : item.control.rate * 100,
        n: item.control.sampleSize,
      },
      {
        name: labels.treatment,
        rate:
          item.treatment.rate === null ? undefined : item.treatment.rate * 100,
        n: item.treatment.sampleSize,
      },
    ];
  return (
    <div className="legacy-chart">
      <p className="legacy-chart-note">{labels.rate} (%)</p>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 15, right: 12, bottom: 0, left: -15 }}
        >
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" stroke={COLORS.text} />
          <YAxis stroke={COLORS.text} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [`${Number(v).toFixed(1)}%`, labels.rate]}
          />
          <Bar dataKey="rate" radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {data.map((_, index) => (
              <Cell
                key={index}
                fill={index ? COLORS.primary : COLORS.previous}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ValueTable
        locale={locale}
        title={labels.rate}
        headers={[
          ja ? "対象" : "Group",
          "%",
          ja ? "対象件数" : "Sample records",
        ]}
        rows={data.map((row) => [
          row.name,
          row.rate === undefined ? unknown(locale) : `${row.rate.toFixed(1)}%`,
          row.n,
        ])}
      />
    </div>
  );
}
export function DeliveryFunnelChart({
  action,
  labels,
  locale = "en",
}: {
  action: ActionPresentation;
  labels: {
    triggered: string;
    eligible: string;
    approved: string;
    delivered: string;
  };
  locale?: Locale;
}) {
  const ja = locale === "ja",
    data = [
      [labels.triggered, action.delivery.triggered],
      [labels.eligible, action.delivery.eligible],
      [labels.approved, action.delivery.approved],
      [labels.delivered, action.delivery.delivered],
    ].map(([name, value]) => ({ name, value })),
    title = ja ? "段階別の記録件数" : "Records at each stage";
  return (
    <div className="legacy-chart">
      <p className="legacy-chart-note">{title}</p>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 15, bottom: 4, left: 0 }}
        >
          <XAxis
            type="number"
            stroke={COLORS.text}
            allowDecimals={false}
            fontSize={12}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={COLORS.text}
            width={108}
            fontSize={12}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [v, ja ? "件" : "records"]}
          />
          <Bar
            dataKey="value"
            fill={COLORS.primary}
            radius={[0, 5, 5, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      <ValueTable
        locale={locale}
        title={title}
        headers={[ja ? "段階" : "Stage", ja ? "件数" : "Records"]}
        rows={data.map((row) => [row.name!, row.value!])}
      />
    </div>
  );
}
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="chart-empty">
      <span>—</span>
      <p>{label}</p>
    </div>
  );
}
