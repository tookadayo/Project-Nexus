import { cookies } from "next/headers";
import { OperationsNavigation } from "../operations/navigation";
import { PersonalizationWorkspace } from "../preferences/view";
import "../preferences/personalization.css";
export const dynamic = "force-dynamic";
export default async function TemplatesPage() {
  const jar = await cookies(), locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en";
  return <main className="operations-page personalization-page"><OperationsNavigation locale={locale} active="templates" />
    <PersonalizationWorkspace key={jar.get("nexus_guild")?.value ?? ""} kind="templates" locale={locale} guildId={jar.get("nexus_guild")?.value ?? ""} />
  </main>;
}
