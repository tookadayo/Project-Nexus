import { assert } from "../../shared/src/index";
import type { EvaluatedValue } from "./types";
import { MAX_WAIT_SECONDS } from "./types";

/** A bounded read fixes every scheduling input once. It never extends the Run. */
export function fixedPollBounds(
  values: { maxAttempts: EvaluatedValue; interval: EvaluatedValue; until: EvaluatedValue },
  runDeadline: Date,
  maximum: number,
) {
  const { maxAttempts, interval, until } = values;
  assert(Object.values(values).every(value => !value.provenance.some(source => source.sensitive || source.resumable === false)),
    "AUTOMATION_STATE_NOT_RESUMABLE");
  assert(maxAttempts.type === "Number" && typeof maxAttempts.value === "number" &&
    Number.isSafeInteger(maxAttempts.value) && maxAttempts.value >= 1 && maxAttempts.value <= maximum,
  "AUTOMATION_POLL_ATTEMPTS");
  assert(interval.type === "Duration" && typeof interval.value === "number" &&
    Number.isFinite(interval.value) && interval.value > 0 && interval.value <= MAX_WAIT_SECONDS,
  "AUTOMATION_POLL_INTERVAL");
  assert(until.type === "Instant" && typeof until.value === "string" && Number.isFinite(Date.parse(until.value)),
    "AUTOMATION_INSTANT_INVALID");
  const deadline = new Date(until.value);
  assert(deadline <= runDeadline, "AUTOMATION_DEADLINE_EXCEEDED");
  return { maxAttempts: maxAttempts.value, intervalSeconds: interval.value, deadline: deadline.toISOString() };
}
