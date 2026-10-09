import { LegalStatusView } from "../legal/status-view";
import { SiteShell, siteLocale } from "../public-ui";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Privacy Policy · NEXUS",
  robots: { index: false, follow: true },
};
export default async function Privacy() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <LegalStatusView locale={locale} document="privacy" />
    </SiteShell>
  );
}
