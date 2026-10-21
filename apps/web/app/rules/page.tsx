import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardContext } from "../auth/session";
import { OperationsNavigation } from "../operations/navigation";
import { FailureNotice } from "../failure-ui";
import { userFailure } from "../../../../packages/shared/src/errors";
import { RulesWorkspace } from "./view";
import "./rules.css";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const jar = await cookies();
  const locale = jar.get("nexus_locale")?.value === "ja" ? "ja" : "en";
  let context;
  try {
    context = await dashboardContext(jar.get("nexus_session")?.value, jar.get("nexus_guild")?.value);
  } catch (error) {
    return <main className="operations-page rules-page">
      <FailureNotice locale={locale} failure={userFailure(error, "NOT_STARTED", {action: "rule-suggestions", stage: "authorization"})} />
      <a href="/servers">{locale === "ja" ? "サーバー選択へ戻る" : "Back to server selection"}</a>
    </main>;
  }
  if (!context) redirect("/servers");
  return <main className="operations-page rules-page">
    <OperationsNavigation locale={locale} active="rules" />
    <RulesWorkspace key={`${context.guildId}-${locale}`} locale={locale} guildId={context.guildId}
      guildName={context.guilds.find((guild) => guild.id === context.guildId)?.name} />
  </main>;
}
