import {cookies} from "next/headers";
import {OperationsNavigation} from "../operations/navigation";
import {OnboardingFlowWorkspace} from "./view";
import "./workspace.css";
export const dynamic = "force-dynamic";
export default async function OnboardingFlowsPage() {const jar = await cookies(), locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en", guildId = jar.get("nexus_guild")?.value ?? ""; return <main className="operations-page onboarding-flow-page"><OperationsNavigation locale={locale} active="onboarding-flows" /><OnboardingFlowWorkspace key={guildId} guildId={guildId} locale={locale} /></main>;}
