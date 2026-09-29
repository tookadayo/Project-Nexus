import Dashboard from '../../dashboard-data';
export const dynamic='force-dynamic';
export default async function GuildDashboard({params}:{params:Promise<{guildId:string}>}){
 const {guildId}=await params;
 return Dashboard({guildId});
}
