import Dashboard from '../dashboard-data';
export const dynamic='force-dynamic';
export default async function DashboardIndex({searchParams}:{searchParams:Promise<{view?:string}>}){const {view}=await searchParams;return Dashboard({view});}
