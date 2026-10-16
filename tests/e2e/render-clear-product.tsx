import { renderToStaticMarkup } from "react-dom/server";
import { ObservationChart } from "../../apps/web/app/observation-chart";
import { Attention } from "../../apps/web/app/attention";
import { HomeSummary } from "../../apps/web/app/home-summary";
import type { ProductData } from "../../apps/web/app/console";
import { demoChart } from "../../apps/web/app/landing/demo-data";
import { heroSample } from "../../apps/web/app/landing/hero-data";
import "../../apps/web/app/workspace.css";

// Capture the real display components with synthetic inputs, never a connected UI.
export function renderPreviews() {
  const previews: Record<string, string> = {};
  for (const locale of ["ja", "en"] as const) {
    const data = {
      home: null,
      community: null,
      results: {
        generatedAt: heroSample.records[0]!.startedAt,
        items: [],
        simple: [
          {
            actionId: "synthetic-response-1",
            name: "Reply Rescue",
            startedAt: heroSample.records[0]!.startedAt,
            collecting: true,
          },
        ],
      },
    } as unknown as ProductData;
    previews[`analysis-${locale}`] = renderToStaticMarkup(
      <ObservationChart spec={demoChart(7)} locale={locale} />,
    );
    previews[`history-${locale}`] = renderToStaticMarkup(
      <HomeSummary
        data={data}
        locale={locale}
        onNavigate={() => {}}
        onDetails={() => {}}
      />,
    );
    previews[`attention-${locale}`] = renderToStaticMarkup(
      <Attention
        ready
        items={[
          {
            channelId: "333333333333333333",
            messageId: "444444444444444444",
            url: "https://discord.com/channels/111111111111111111/333333333333333333/444444444444444444",
            waitingMinutes: 45,
            status: "OPEN",
            surface: "TEXT",
            purpose: "SUPPORT",
          },
        ]}
        locale={locale}
        channels={[{ id: "333333333333333333", label: "#sample-help" }]}
        minutes={30}
        onChange={() => {}}
        onSnooze={() => {}}
        onRefresh={() => {}}
        onRules={() => {}}
      />,
    );
  }
  return previews;
}
