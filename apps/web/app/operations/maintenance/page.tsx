import { cookies } from "next/headers";
import { OperationsNavigation } from "../navigation";
import { MaintenanceWorkspace } from "./view";
import "./maintenance.css";
export const dynamic="force-dynamic";
export default async function MaintenancePage(){
 const jar=await cookies(),locale=jar.get('nexus_locale')?.value==='ja'?'ja':'en',guildId=jar.get('nexus_guild')?.value??'';
 return <main className="operations-page maintenance-page"><OperationsNavigation locale={locale} active="maintenance"/><MaintenanceWorkspace key={guildId} guildId={guildId} locale={locale}/></main>;
}
