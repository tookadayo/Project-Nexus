import {createRoot} from "react-dom/client";
import {HealthWorkspace} from "../../apps/web/app/health/view";
const locale = new URLSearchParams(location.search).get("locale") === "ja" ? "ja" : "en";
createRoot(document.getElementById("root")!).render(<HealthWorkspace guildId="884111111111111111" locale={locale}/>);
