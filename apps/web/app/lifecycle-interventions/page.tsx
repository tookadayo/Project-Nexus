import {cookies} from "next/headers";
import {OperationsNavigation} from "../operations/navigation";
import {LifecycleWorkspace} from "../experiments/view";
import "../experiments/workspace.css";
export const dynamic = "force-dynamic";
export default async function InterventionsPage() {const jar = await cookies(), locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en", guildId = jar.get("nexus_guild")?.value ?? ""; return <main className="operations-page lifecycle-page"><OperationsNavigation locale={locale} active="lifecycle-interventions" /><LifecycleWorkspace key={guildId} domain="intervention" locale={locale} guildId={guildId} /></main>;}
