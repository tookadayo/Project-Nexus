import {cookies} from "next/headers";
import {operationsContext} from "../operations/context";
import {OperationsNavigation} from "../operations/navigation";
import {FailureNotice} from "../failure-ui";
import {userFailure} from "../../../../packages/shared/src/errors";
import {HealthWorkspace} from "./view";
export const dynamic = "force-dynamic";
export default async function HealthPage() {
  const locale = (await cookies()).get("nexus_locale")?.value === "ja" ? "ja" : "en";
  try {
    const current = await operationsContext();
    return <main className="operations-page"><OperationsNavigation locale={locale} active="health" /><HealthWorkspace key={`${current.scope.guildId}-${locale}`} guildId={current.scope.guildId} locale={locale}/></main>;
  } catch (error) {
    return <main><FailureNotice locale={locale} failure={userFailure(error, "NOT_STARTED", {action: "health", stage: "authorization"})}/><a href="/servers">{locale === "ja" ? "サーバー選択へ戻る" : "Back to server selection"}</a></main>;
  }
}
