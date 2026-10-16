import { renderToStaticMarkup } from "react-dom/server";
import Console, { type ProductData } from "../../apps/web/app/console";
import type { KPI } from "../../packages/presentation/src/types";

// Real Console markup, isolated from providers. Both unknown and observed zero
// appear in the saved record so presentation cannot silently collapse them.
const time = "2026-10-09T12:00:00Z";
const metric = (current: number | null): KPI => ({
  key: "direct_reply_connection_rate",
  current,
  previous: null,
  delta: null,
  sampleSize: current === null ? 0 : 8,
  maturity: current === null ? "unavailable" : "provisional",
  coverage: {
    status: current === null ? "unavailable" : "healthy",
    label: current === null ? "unavailable" : "healthy",
    notes: current === null ? ["no_verified_data"] : [],
    coverageRatio: current === null ? null : 1,
  },
});

export function renderPreviews() {
  const previews: Record<string, string> = {};
  for (const locale of ["ja", "en"] as const) {
    const data: ProductData = {
      home: null,
      community: null,
      journey: null,
      opportunities: null,
      actions: null,
      results: {
        generatedAt: time,
        items: [],
        simple: [
          {
            actionId: "synthetic-phase-b-response",
            name: "Reply Rescue",
            metric: "direct_reply_connection_rate",
            startedAt: time,
            collecting: true,
            controlledAvailable: false,
            before: metric(null),
            after: metric(0),
          },
        ],
      },
      weeklyStatus: null,
      audit: [],
      admin: null,
      options: { channels: [], roles: [], events: [], available: false },
    };
    previews[`history-${locale}`] = renderToStaticMarkup(
      <Console data={data} initialLocale={locale} initialView={3} />,
    );
  }
  return previews;
}
