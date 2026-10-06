import { cookies } from "next/headers";
import { OperationsNavigation } from "../operations/navigation";
import { ExploreControls } from "./view";
export const dynamic = "force-dynamic";
export default async function ExplorePage() {
  const locale =
    (await cookies()).get("nexus_locale")?.value === "ja" ? "ja" : "en";
  return (
    <main className="operations-page">
      <OperationsNavigation locale={locale} />
      <ExploreControls locale={locale} />
    </main>
  );
}
