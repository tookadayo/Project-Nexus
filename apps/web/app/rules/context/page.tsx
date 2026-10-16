import {cookies} from "next/headers";
import {OperationsNavigation} from "../../operations/navigation";
import {OperationalContextWorkspace} from "./view";
import "./workspace.css";
export default async function OperationalContextPage() {const stored = await cookies(), locale = stored.get("nexus_locale")?.value === "en" ? "en" : "ja", guildId = stored.get("nexus_guild")?.value ?? ""; return <><OperationsNavigation active="rules" locale={locale} /><OperationalContextWorkspace locale={locale} guildId={guildId} /></>;}
