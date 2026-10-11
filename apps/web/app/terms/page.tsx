import { LegalStatusView } from "../legal/status-view";
import { SiteShell, siteLocale } from "../public-ui";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Terms of Service · NEXUS",
  robots: { index: false, follow: true },
};
export default async function Terms() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <LegalStatusView locale={locale} document="terms" />
    </SiteShell>
  );
}
