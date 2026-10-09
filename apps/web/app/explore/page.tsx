import { exploreQuery } from "./navigation";
import { cookies } from "next/headers";
import { OperationsNavigation } from "../operations/navigation";
import { ExploreControls } from "./view";
export const dynamic = "force-dynamic";
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const scope = (await cookies()).get("nexus_guild")?.value ?? "";
  const filters = new URLSearchParams();
  for (const key of ["guild", "q"])
    if (typeof params[key] === "string") filters.set(key, params[key]);
  const initialQuery = exploreQuery(filters, scope);
  const locale =
    (await cookies()).get("nexus_locale")?.value === "ja" ? "ja" : "en";
  return (
    <main className="operations-page">
      <OperationsNavigation locale={locale} />
      <ExploreControls
        key={scope}
        locale={locale}
        scope={scope}
        initialQuery={initialQuery}
        filtersReset={Boolean(params.q) && filters.get("guild") !== scope}
      />
    </main>
  );
}
