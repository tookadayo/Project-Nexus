import {
  trace,
  isSpanContextValid,
  metrics,
  SpanStatusCode,
  type Attributes,
} from "@opentelemetry/api";
const tracer = trace.getTracer("nexus.operations", "0.6"),
  meter = metrics.getMeter("nexus.operations", "0.6");
const duration = meter.createHistogram("nexus.operation.duration", {
    unit: "ms",
  }),
  failures = meter.createCounter("nexus.operation.failures");
const allowed = new Set([
  "signal.kind",
  "metric.key",
  "action.kind",
  "stage",
  "queue",
  "observation.state",
  "coverage.state",
  "error.category",
  "definition.version",
]);
export function safeTraceAttributes(attributes: Attributes) {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) =>
        allowed.has(key) &&
        typeof value === "string" &&
        value.length <= 96 &&
        !/\b\d{17,20}\b/.test(value),
    ),
  );
}
export async function traceStep<T>(
  name: string,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    { attributes: safeTraceAttributes(attributes) },
    async (span) => {
      const started = performance.now();
      try {
        return await work();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        failures.add(1, { stage: name });
        throw error;
      } finally {
        duration.record(performance.now() - started, { stage: name });
        span.end();
      }
    },
  );
}
export function traceSync<T>(
  name: string,
  attributes: Attributes,
  work: () => T,
): T {
  return tracer.startActiveSpan(
    name,
    { attributes: safeTraceAttributes(attributes) },
    (span) => {
      try {
        return work();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
export function traceCorrelation() {
  const span = trace.getActiveSpan()?.spanContext();
  return span && isSpanContextValid(span)
    ? { traceId: span.traceId, spanId: span.spanId }
    : {};
}
