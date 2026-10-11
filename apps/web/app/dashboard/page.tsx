import Dashboard from "../dashboard-data";
export const dynamic = "force-dynamic";
export default async function DashboardIndex({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; range?: string; tab?: string }>;
}) {
  const { view, range, tab } = await searchParams;
  return Dashboard({ view, range, tab });
}
