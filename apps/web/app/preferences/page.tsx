import { cookies } from "next/headers";
import { OperationsNavigation } from "../operations/navigation";
import { PersonalizationWorkspace } from "./view";
import "./personalization.css";
export const dynamic = "force-dynamic";
export default async function PreferencesPage() {
  const jar = await cookies(), locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en";
  return <main className="operations-page personalization-page"><OperationsNavigation locale={locale} active="preferences" />
    <PersonalizationWorkspace key={jar.get("nexus_guild")?.value ?? ""} kind="preferences" locale={locale} guildId={jar.get("nexus_guild")?.value ?? ""} />
  </main>;
}
