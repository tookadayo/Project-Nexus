import { cookies } from "next/headers";
import { OperationsNavigation } from "./navigation";
import { OperationsControls } from "./view";
export const dynamic = "force-dynamic";
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = (await cookies()).get("nexus_guild")?.value ?? "";
  const locale =
      (await cookies()).get("nexus_locale")?.value === "ja" ? "ja" : "en",
    params = await searchParams;
  return (
    <main className="operations-page">
      <OperationsNavigation
        locale={locale}
        active={typeof params.view === "string" ? params.view : "attention"}
      />
      <OperationsControls
        key={scope}
        scope={scope}
        locale={locale}
        initialView={
          typeof params.view === "string" ? params.view : "attention"
        }
      />
    </main>
  );
}
