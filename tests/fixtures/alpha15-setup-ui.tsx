import {createRoot} from "../../apps/web/node_modules/react-dom/client";
import {SetupWizard} from "../../apps/web/app/setup/wizard";
import "../../apps/web/app/setup/setup.css";

const search = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(<SetupWizard locale={search.get("locale") === "ja" ? "ja" : "en"} guildId="321111111111111111" installUrl="https://discord.com/oauth2/authorize?client_id=321111111111111119" editing={search.get("edit") === "1"}/>);
