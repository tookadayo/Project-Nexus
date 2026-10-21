import {cookies} from "next/headers";
import {OperationsNavigation} from "../operations/navigation";
import {LifecycleWorkspace} from "./view";
import "./workspace.css";
export const dynamic = "force-dynamic";
export default async function ExperimentsPage() {const jar = await cookies(), locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en", guildId = jar.get("nexus_guild")?.value ?? ""; return <main className="operations-page lifecycle-page"><OperationsNavigation locale={locale} active="experiments" /><LifecycleWorkspace key={guildId} domain="experiment" locale={locale} guildId={guildId} /></main>;}
