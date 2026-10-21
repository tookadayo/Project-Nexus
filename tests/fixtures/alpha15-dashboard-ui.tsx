import {createRoot} from "../../apps/web/node_modules/react-dom/client";
import Console, {type ProductData} from "../../apps/web/app/console";
import {Alpha15Dashboard} from "../../apps/web/app/alpha15-dashboard";
import "../../apps/web/app/style.css";
import "../../apps/web/app/product.css";
import "../../apps/web/app/brand.css";

const query = new URLSearchParams(location.search), locale = query.get("locale") === "ja" ? "ja" : "en";
const guild = "321111111111111111";
const data: ProductData = {
  home: null, community: null, journey: null, opportunities: null, actions: null, results: null,
  weeklyStatus: null, audit: [], admin: null, options: {channels: [], roles: [], events: [], available: false},
  selectedGuildId: guild, guilds: [{id: guild, name: "Synthetic Community", installed: true, installUrl: null}],
};
createRoot(document.getElementById("root")!).render(query.get("surface") === "console"
  ? <Console data={data} initialLocale={locale} initialView={0}/>
  : <main style={{maxWidth: 1120, margin: "auto", padding: "0 16px"}}><h1>{locale === "ja" ? "ホーム" : "Home"}</h1><Alpha15Dashboard guildId={guild} locale={locale}/></main>);
