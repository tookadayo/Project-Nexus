import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardContext } from "../auth/session";
import { siteLocale } from "../public-ui";
import { FailureNotice } from "../failure-ui";
import { userFailure } from "../../../../packages/shared/src/errors";
import { AutomationWorkspace } from "./workspace";

export const dynamic = "force-dynamic";
/** Server gate protects the route; each BFF request independently rechecks current access. */
export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; flow?: string; run?: string }>;
}) {
  const jar = await cookies(),
    locale = await siteLocale();
  let context;
  try {
    context = await dashboardContext(
      jar.get("nexus_session")?.value,
      jar.get("nexus_guild")?.value,
    );
  } catch (error) {
    return (
      <main className="servers-content">
        <FailureNotice
          locale={locale}
          failure={userFailure(error, "NOT_STARTED", {
            action: "automation",
            stage: "authorization",
          })}
        />
        <a href="/servers">
          {locale === "ja" ? "サーバー選択へ戻る" : "Back to server selection"}
        </a>
      </main>
    );
  }
  if (!context) redirect("/servers");
  const query = await searchParams,
    requested = query.template;
  const reference = (value: string | undefined) =>
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
      ? value
      : undefined;
  const initialFlowId =
      query.flow && /^[a-zA-Z0-9_-]{1,100}$/.test(query.flow)
        ? query.flow
        : undefined,
    initialRunId = reference(query.run);
  const template =
    requested &&
    ["schedule", "approval", "ticket", "interaction"].includes(requested)
      ? (requested as "schedule" | "approval" | "ticket" | "interaction")
      : undefined;
  return (
    <>
      <nav className="automation-page-return">
        <a href={`/dashboard/${context.guildId}`}>
          {locale === "ja" ? "← ダッシュボードへ戻る" : "← Back to dashboard"}
        </a>
        <form action="/locale" method="post">
          <input
            type="hidden"
            name="locale"
            value={locale === "ja" ? "en" : "ja"}
          />
          <button type="submit">
            {locale === "ja" ? "English" : "日本語"}
          </button>
        </form>
      </nav>
      <AutomationWorkspace
        key={`${context.guildId}-${locale}-${initialFlowId ?? ""}`}
        locale={locale}
        guildId={context.guildId}
        guildName={
          context.guilds.find((item) => item.id === context.guildId)?.name
        }
        readOnly={!context.operationsCanConfigure}
        initialTemplate={template}
        initialFlowId={initialFlowId}
        initialRunId={initialRunId}
      />
    </>
  );
}
