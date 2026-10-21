import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {authMode, installUrl, openSession} from "../auth/session";
import {siteLocale} from "../public-ui";
import {SetupWizard} from "./wizard";
import "./setup.css";

export const dynamic = "force-dynamic";

export default async function SetupPage({searchParams}: {searchParams: Promise<{guild?: string; edit?: string}>}) {
  const {guild, edit} = await searchParams;
  if (!guild || !/^\d{17,20}$/.test(guild)) redirect("/servers");
  if (authMode() !== "development") {
    const session = await openSession((await cookies()).get("nexus_session")?.value);
    if (!session) redirect("/auth/login");
  }
  return <SetupWizard key={guild} locale={await siteLocale()} guildId={guild} installUrl={installUrl(guild)} editing={edit === "1"}/>;
}
