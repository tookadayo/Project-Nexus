import { SiteShell, siteLocale, copy } from "../../public-ui";
import { internalBillingContext } from "../context";
import { AdminBillingControls } from "./controls";
import { billingAudit } from "../../../../../packages/settings/src/billing";
export const dynamic = "force-dynamic";
export default async function BillingAdmin() {
  const locale = await siteLocale();
  try {
    const context = await internalBillingContext(
      "View internal billing administration",
    );
    await billingAudit(
      context.services.db,
      null,
      context.actor.hash,
      "billing.admin_viewed",
    );
  } catch {
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(locale, "NEXUS内部管理", "NEXUS internal administration")}
          </h1>
          <p>
            {copy(
              locale,
              "NEXUS内部管理者としてログインしてください。Discordの管理者権限だけでは利用できません。",
              "Sign in as a NEXUS internal administrator. Discord administrator permissions do not grant access.",
            )}
          </p>
          <a href="/auth/login">{copy(locale, "ログイン", "Log in")}</a>
        </section>
      </SiteShell>
    );
  }
  return (
    <SiteShell locale={locale}>
      <section className="site-section">
        <h1>
          {copy(
            locale,
            "プロモーションと利用特典の内部管理",
            "Internal promotion and grant administration",
          )}
        </h1>
        <AdminBillingControls locale={locale} />
      </section>
    </SiteShell>
  );
}
