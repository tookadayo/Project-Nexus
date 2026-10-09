import { createRoot } from "../../apps/web/node_modules/react-dom/client";
import Console, { type ProductData } from "../../apps/web/app/console";
import { dashboardView } from "../../apps/web/app/navigation-model";
import { HomeSummary } from "../../apps/web/app/home-summary";
import { ServerConnection } from "../../apps/web/app/link/connection";
import { OperationsNavigation } from "../../apps/web/app/operations/navigation";
import { ExploreControls } from "../../apps/web/app/explore/view";
import { OperationsControls } from "../../apps/web/app/operations/view";
const query = new URL(location.href).searchParams;
const data: ProductData = {
  home: null,
  journey: null,
  community: null,
  opportunities: null,
  actions: null,
  results: null,
  weeklyStatus: null,
  audit: [],
  options: { channels: [], roles: [], events: [], available: false },
  admin: null,
  selectedGuildId: "111111111111111111",
  guilds: [
    {
      id: "111111111111111111",
      name: "合成データ 🧭 とても長い日本語コミュニティ名 — Synthetic community",
      installed: true,
      installUrl: null,
    },
    {
      id: "222222222222222222",
      name: "Synthetic server B",
      installed: true,
      installUrl: null,
    },
  ],
};
const locale = query.get("locale") === "en" ? "en" : "ja";
if (query.get("state") === "PAUSED" || query.get("state") === "EXPIRED")
  data.betaState = query.get("state") as "PAUSED" | "EXPIRED";
const preview = query.get("preview");
const root = createRoot(document.getElementById("root")!);
if (preview === "zero" || preview === "unknown") {
  data.community = {
    daily: { ready: true, attentionCount: preview === "zero" ? 0 : null },
    generatedAt: "2026-10-09T00:00:00Z",
  } as ProductData["community"];
  data.results = { generatedAt: "2026-10-09T00:00:00Z", items: [], simple: [] };
  root.render(
    <div className="product">
      <main className="content">
        <HomeSummary
          data={data}
          locale={locale}
          removed={0}
          onNavigate={() => {}}
          onDetails={() => {}}
        />
      </main>
    </div>,
  );
} else if (preview === "connection")
  root.render(
    <div className="product">
      <main className="content">
        <ServerConnection
          guildId={data.selectedGuildId!}
          locale={locale}
          development={false}
          beta
        />
      </main>
    </div>,
  );
else if (preview === "operations")
  root.render(
    <main className="operations-page">
      <OperationsNavigation locale={locale} active="reports" />
    </main>,
  );
else if (preview === "explore-error")
  root.render(
    <main className="operations-page">
      <ExploreControls locale={locale} />
    </main>,
  );
else if (preview === "operations-error")
  root.render(
    <main className="operations-page">
      <OperationsControls locale={locale} initialView="attention" />
    </main>,
  );
else
  root.render(
    <Console
      data={data}
      initialLocale={locale}
      initialView={dashboardView(query.get("view"))}
    />,
  );
