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

const COLORS = {
  lime: "#c8f169",
  mint: "#7ce0b1",
  blue: "#79a7ff",
  amber: "#f4c56a",
  muted: "#485448",
  empty: "#293129",
};
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
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
}: {
  title: string;
  points: TrendPoint[];
  emptyLabel: string;
}) {
  const values = points.map((p) => ({
    ...p,
    label: p.bucket.slice(5),
    display: p.value === null ? undefined : p.value * 100,
  }));
  return (
    <section className="chart-card">
      <h3>{title}</h3>
      {points.some((p) => p.value !== null) ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={values}
            margin={{ top: 12, right: 8, bottom: 0, left: -18 }}
          >
            <CartesianGrid stroke="#283229" vertical={false} />
            <XAxis dataKey="label" stroke="#778277" fontSize={11} />
            <YAxis
              stroke="#778277"
              fontSize={11}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: "#182019",
                border: "1px solid #39463a",
              }}
              formatter={(v) => [`${Number(v).toFixed(1)}%`, ""]}
            />
            <Line
              type="monotone"
              dataKey="display"
              stroke={COLORS.lime}
              strokeWidth={2.4}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <EmptyChart label={emptyLabel} />
      )}
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
}: {
  cohorts: RetentionCohort[];
  labels: { cohort: string; members: string; empty: string };
}) {
  return (
    <section className="chart-card heatmap">
      <h3>{labels.cohort}</h3>
      {cohorts.length ? (
        <div className="heat-grid">
          <div className="heat-head">{labels.members}</div>
          <div className="heat-head">D1</div>
          <div className="heat-head">D7</div>
          <div className="heat-head">D30</div>
          {cohorts.slice(-12).flatMap((c) => [
            <div className="cohort-label" key={`${c.cohort}-label`}>
              <span>{c.cohort.slice(5)}</span>
              <small>n={c.members}</small>
            </div>,
            ...(["d1", "d7", "d30"] as const).map((key) => (
              <div
                className="heat-cell"
                key={`${c.cohort}-${key}`}
                style={{ "--heat": c[key] ?? 0 } as React.CSSProperties}
                title={`${key.toUpperCase()}: ${pct(c[key])}`}
              >
                {pct(c[key])}
              </div>
            )),
          ])}
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
}: {
  rows: ResponseDistribution[];
  title: string;
  labels: Record<ResponseDistribution["bucket"], string>;
  emptyLabel: string;
}) {
  const data = rows.map((r) => ({
    name: labels[r.bucket],
    value: r.count ?? undefined,
  }));
  return (
    <section className="chart-card">
      <h3>{title}</h3>
      {rows.some((r) => r.count !== null) ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 20, left: -18 }}
          >
            <CartesianGrid stroke="#283229" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="#778277"
              fontSize={10}
              angle={-18}
              textAnchor="end"
            />
            <YAxis stroke="#778277" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: "#182019",
                border: "1px solid #39463a",
              }}
            />
            <Bar dataKey="value" fill={COLORS.mint} radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <EmptyChart label={emptyLabel} />
      )}
    </section>
  );
}
export function ExperimentComparison({
  item,
  labels,
}: {
  item: ExperimentPresentation;
  labels: { control: string; treatment: string; rate: string };
}) {
  const data = [
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
    <ResponsiveContainer width="100%" height={210}>
      <BarChart
        data={data}
        margin={{ top: 15, right: 12, bottom: 0, left: -15 }}
      >
        <CartesianGrid stroke="#283229" vertical={false} />
        <XAxis dataKey="name" stroke="#8a978a" />
        <YAxis stroke="#8a978a" tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={{ background: "#182019", border: "1px solid #39463a" }}
          formatter={(v) => [`${Number(v).toFixed(1)}%`, labels.rate]}
        />
        <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i ? COLORS.lime : COLORS.blue} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
export function DeliveryFunnelChart({
  action,
  labels,
}: {
  action: ActionPresentation;
  labels: {
    triggered: string;
    eligible: string;
    approved: string;
    delivered: string;
  };
}) {
  const data = [
    [labels.triggered, action.delivery.triggered],
    [labels.eligible, action.delivery.eligible],
    [labels.approved, action.delivery.approved],
    [labels.delivered, action.delivery.delivered],
  ].map(([name, value]) => ({ name, value }));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 15, bottom: 4, left: 12 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          stroke="#8a978a"
          width={75}
          fontSize={11}
        />
        <Tooltip
          contentStyle={{ background: "#182019", border: "1px solid #39463a" }}
        />
        <Bar dataKey="value" fill={COLORS.mint} radius={[0, 5, 5, 0]} />
      </BarChart>
    </ResponsiveContainer>
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
