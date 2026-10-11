import { LegalStatusView } from "./status-view";
import { SiteShell, siteLocale } from "../public-ui";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Terms and privacy · NEXUS",
  robots: { index: false, follow: true },
};
export default async function Legal() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <LegalStatusView locale={locale} />
    </SiteShell>
  );
}
