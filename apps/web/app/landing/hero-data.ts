import type { homeSummaryModel } from "../home-summary-model";

// Public, immutable illustration only. No guild IDs, users, posts or data reads.
// Keep the state/record vocabulary checked against the product's display model.
const records = [
  {
    id: "synthetic-response-1",
    name: "Reply Rescue",
    startedAt: "2026-10-01T09:00:00Z",
    state: "collecting",
    kind: "response",
  },
] satisfies ReturnType<typeof homeSummaryModel>["records"];

export const heroSample = {
  state: "partial",
  attention: 2,
  records,
  recordCount: records.length,
} satisfies Pick<
  ReturnType<typeof homeSummaryModel>,
  "state" | "attention" | "records" | "recordCount"
>;
