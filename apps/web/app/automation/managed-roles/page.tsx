import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardContext } from "../../auth/session";
import { siteLocale } from "../../public-ui";
import { FailureNotice } from "../../failure-ui";
import { userFailure } from "../../../../../packages/shared/src/errors";
import { ManagedRoleWorkspace } from "./workspace";
export const dynamic = "force-dynamic";
export default async function ManagedRolesPage() {
  const jar = await cookies(), locale = await siteLocale();
  let context;
  try { context = await dashboardContext(jar.get("nexus_session")?.value, jar.get("nexus_guild")?.value); }
  catch (error) { return <main><FailureNotice locale={locale} failure={userFailure(error, "NOT_STARTED", { action: "automation", stage: "authorization" })}/><a href="/servers">{locale === "ja" ? "サーバー選択へ戻る" : "Back to server selection"}</a></main>; }
  if (!context) redirect("/servers");
  return <ManagedRoleWorkspace key={context.guildId + locale} guildId={context.guildId} locale={locale} readOnly={!context.operationsCanConfigure}/>;
}
