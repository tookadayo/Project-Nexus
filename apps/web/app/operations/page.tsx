import { cookies } from "next/headers";
import { OperationsNavigation } from "./navigation";
import { OperationsControls } from "./view";
export const dynamic = "force-dynamic";
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
        locale={locale}
        initialView={
          typeof params.view === "string" ? params.view : "attention"
        }
      />
    </main>
  );
}
