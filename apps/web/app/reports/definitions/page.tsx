import {cookies} from "next/headers";
import {OperationsNavigation} from "../../operations/navigation";
import {ReportDefinitionsWorkspace} from "./view";
export const dynamic="force-dynamic";
export default async function ReportDefinitionsPage(){
 const jar=await cookies(),locale=jar.get("nexus_locale")?.value==="ja"?"ja":"en",guildId=jar.get("nexus_guild")?.value??"";
 return <main className="operations-page"><OperationsNavigation locale={locale} active="report-definitions"/><ReportDefinitionsWorkspace key={guildId} guildId={guildId} locale={locale}/></main>;
}
