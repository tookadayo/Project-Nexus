import Dashboard from "../../dashboard-data";
export const dynamic = "force-dynamic";
export default async function GuildDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ view?: string; range?: string; tab?: string }>;
}) {
  const { guildId } = await params;
  const { view, range, tab } = await searchParams;
  return Dashboard({ guildId, view, range, tab });
}
