import { metrics } from "@opentelemetry/api";
const meter = metrics.getMeter("nexus.analysis", "0.6"),
  events = meter.createCounter("nexus.analysis.events"),
  delay = meter.createHistogram("nexus.analysis.queue_delay", { unit: "ms" }),
  duration = meter.createHistogram("nexus.analysis.run_duration", {
    unit: "ms",
  });
export const analysisEvents = [
  "analysis_requested",
  "analysis_reserved",
  "analysis_enqueued",
  "analysis_started",
  "analysis_completed",
  "analysis_failed",
  "analysis_retried",
  "analysis_recovered",
  "analysis_usage_consumed",
  "analysis_usage_released",
  "analysis_duplicate_reused",
] as const;
export function analysisEvent(event: (typeof analysisEvents)[number]) {
  events.add(1, { event });
}
export function analysisTiming(kind: "delay" | "duration", ms: number) {
  (kind === "delay" ? delay : duration).record(Math.max(0, ms));
}
const queueMetrics = Object.fromEntries(
  ["waiting", "active", "prioritized", "oldest_waiting_ms", "failure_rate"].map(
    (key) => [key, meter.createGauge("nexus.analysis.queue." + key)],
  ),
);
export function analysisQueueMetrics(values: Record<string, number>) {
  for (const [key, value] of Object.entries(values))
    if (Number.isFinite(value)) queueMetrics[key]?.record(value);
}
