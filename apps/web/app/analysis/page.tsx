import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardContext } from "../auth/session";
import { FailureNotice } from "../failure-ui";
import { userFailure } from "../../../../packages/shared/src/errors";
import { OperationsNavigation } from "../operations/navigation";
import { AnalysisWorkspace } from "./view";
export const dynamic = "force-dynamic";
export default async function AnalysisPage() {
  const jar = await cookies(), locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en";
  let current;
  try { current = await dashboardContext(jar.get("nexus_session")?.value, jar.get("nexus_guild")?.value); }
  catch (error) { return <main><FailureNotice locale={locale} failure={userFailure(error, "NOT_STARTED", { action: "analysis", stage: "authorization" })} /><a href="/servers">{locale === "ja" ? "サーバー選択へ戻る" : "Back to server selection"}</a></main>; }
  if (!current) redirect("/servers");
  return <main className="operations-page"><OperationsNavigation locale={locale} active="analysis" /><AnalysisWorkspace key={`${current.guildId}-${locale}`} locale={locale} guildId={current.guildId} /></main>;
}
