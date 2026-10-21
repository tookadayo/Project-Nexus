import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {authorizedGuilds, openSession, authMode, validateOAuthSession} from "../auth/session";
import {SiteHeader, copy, siteLocale} from "../public-ui";
import {ServerCards} from "./cards";
import {FailureNotice} from "../failure-ui";
import {userFailure} from "../../../../packages/shared/src/errors";

export const dynamic = "force-dynamic";
export default async function Servers() {
  if (authMode() === "development") redirect("/dashboard");
  const locale = await siteLocale();
  const session = await openSession((await cookies()).get("nexus_session")?.value);
  if (!session) redirect("/auth/login");
  let guilds;
  try {
    await validateOAuthSession(session);
    guilds = await authorizedGuilds(session.accessToken, session.userId);
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_EXPIRED") redirect("/auth/expired");
    return <div className="servers-page"><SiteHeader locale={locale}/><main className="servers-content"><FailureNotice locale={locale} failure={userFailure(error, "NOT_STARTED", {action: "servers", stage: "list"})}/><a className="button button-primary" href="/servers">{copy(locale, "再試行", "Retry")}</a></main></div>;
  }
  return <div className="servers-page" lang={locale}><SiteHeader locale={locale}/><main className="servers-content"><p className="site-eyebrow">YOUR DISCORD SERVERS</p><h1>{copy(locale, "管理するサーバーを選ぶ", "Choose a server to manage")}</h1><p>{copy(locale, "このサーバーを設定するボタンから、現在の管理資格とBotの参加を確認します。既存の設定は引き継ぎ、不足している項目だけをWebで整えます。", "Choose a server to check your current management access and bot installation. Existing settings are preserved; finish only the missing items on the web.")}</p><ServerCards locale={locale} guilds={guilds}/><p><a href="/auth/disconnect">{copy(locale, "個人の接続を解除", "Disconnect personal account")}</a> · <a href="/auth/logout">{copy(locale, "別のアカウントでログイン", "Sign in with another account")}</a></p></main></div>;
}
