import Dashboard from '../../dashboard-data';
export const dynamic='force-dynamic';
export default async function GuildDashboard({params,searchParams}:{params:Promise<{guildId:string}>;searchParams:Promise<{view?:string}>}){
 const {guildId}=await params;
 const {view}=await searchParams;return Dashboard({guildId,view});
}
