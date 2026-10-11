import { createRoot } from "../../apps/web/node_modules/react-dom/client";
import type { ProductData } from "../../apps/web/app/console";
import { HomeSummary } from "../../apps/web/app/home-summary";

// Isolated browser presentation fixture. No endpoint, provider or production data.
const root = document.getElementById("root")!;
const locale = root.dataset.locale === "en" ? "en" : "ja";
const state = root.dataset.state;
const time = "2026-10-09T12:00:00Z";
const data = {
  home: {
    generatedAt: time,
    kpis: [],
    dataHealth: {
      label: "healthy",
      notes: [],
      coverageRatio: 1,
      status: "healthy",
    },
    setup: { required: false, steps: [] },
  },
  community: {
    generatedAt: time,
    daily: {
      ready: true,
      attentionCount: 2,
      todayJoined: 4,
      yesterdayJoined: 6,
      from: "2026-10-09T00:00:00Z",
      timezone: "UTC",
    },
  },
  results: {
    generatedAt: time,
    items: [],
    simple: [
      {
        actionId: "permitted-synthetic-record",
        name:
          locale === "ja"
            ? "長いサーバー名でも確認できる、保存された対応の記録（合成データ）"
            : "A saved response with a long community label (synthetic data)",
        startedAt: time,
        collecting: false,
      },
    ],
  },
} as unknown as ProductData;
if (state === "zero") data.community!.daily.attentionCount = 0;
if (state === "unknown") {
  data.home = null;
  data.community = null;
  data.results = null;
}
if (state === "partial") {
  data.community!.daily.todayJoined = null;
  data.results = null;
}
if (state === "collecting") {
  data.community = null;
  data.results = { generatedAt: time, items: [], simple: [] };
  data.home!.setup = {
    ...data.home!.setup,
    required: true,
    steps: [
      { key: "measuring", complete: false, reason: "measurement_waiting" },
    ],
  };
}
if (state === "paused" || state === "expired")
  data.betaState = state === "paused" ? "PAUSED" : "EXPIRED";
createRoot(root).render(
  <div className="product">
    <main
      className="content"
      style={{
        margin: "0 auto",
        width: "100%",
        maxWidth: 1320,
        gridColumn: "1 / -1",
      }}
    >
      <HomeSummary
        data={data}
        locale={locale}
        onNavigate={(view) => {
          root.dataset.action = String(view);
        }}
        onDetails={() => {
          root.dataset.action = "details";
        }}
      />
    </main>
  </div>,
);
