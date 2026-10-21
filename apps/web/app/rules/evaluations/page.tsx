import {cookies} from "next/headers";
import {operationsContext} from "../../operations/context";
import {OperationsNavigation} from "../../operations/navigation";
import {FailureNotice} from "../../failure-ui";
import {userFailure} from "../../../../../packages/shared/src/errors";
import {RuleEvaluationsWorkspace} from "./view";
export const dynamic = "force-dynamic";
export default async function RuleEvaluationsPage() {
  const locale = (await cookies()).get("nexus_locale")?.value === "ja" ? "ja" : "en";
  try {const c = await operationsContext(); return <main className="operations-page"><OperationsNavigation locale={locale} active="rule-evaluations"/><RuleEvaluationsWorkspace key={`${c.scope.guildId}-${locale}`} guildId={c.scope.guildId} locale={locale}/></main>;}
  catch (error) {return <main><FailureNotice locale={locale} failure={userFailure(error, "NOT_STARTED", {action: "rule-evaluations", stage: "authorization"})}/><a href="/servers">{locale === "ja" ? "サーバー選択へ戻る" : "Back to server selection"}</a></main>;}
}
