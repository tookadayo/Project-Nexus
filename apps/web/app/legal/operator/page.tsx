import { LegalStatusView } from "../status-view";
import { SiteShell, siteLocale } from "../../public-ui";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Operator information · NEXUS",
  robots: { index: false, follow: true },
};
export default async function Page() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <LegalStatusView locale={locale} document="operator" />
    </SiteShell>
  );
}
