import { pendingCheckout, PendingCheckout } from "../pending";
import { SiteShell, siteLocale, copy } from "../../public-ui";
import { billingContext } from "../../billing/context";
import { publicBillingCatalog } from "../../billing/catalog";
import { CheckoutReview } from "./controls";
import { commercialLaunch } from "../../../../../packages/settings/src/billing/commerce";
export const dynamic = "force-dynamic";
export default async function Review({
  searchParams,
}: {
  searchParams: Promise<{ offering?: string; guild?: string }>;
}) {
  const locale = await siteLocale(),
    { offering: offeringId, guild } = await searchParams,
    catalog = await publicBillingCatalog(),
    offering = catalog.offerings.find((row) => row.id === offeringId);
  if (!offering || !guild || !/^\d{17,20}$/.test(guild))
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(
              locale,
              "プランとサーバーを選択してください",
              "Choose a plan and server",
            )}
          </h1>
          <a href="/pricing">{copy(locale, "プランを見る", "View plans")}</a>
        </section>
      </SiteShell>
    );
  const pending = await pendingCheckout();
  if (pending)
    return (
      <SiteShell locale={locale}>
        <PendingCheckout token={pending.token} locale={locale} />
      </SiteShell>
    );
  let context;
  try {
    context = await billingContext("CHECKOUT", guild, false);
  } catch {
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(
              locale,
              "現在のOwner権限を確認できません",
              "Current ownership could not be verified",
            )}
          </h1>
          <p>
            {copy(
              locale,
              "サーバーのOwnerがログインし、NEXUSがインストールされていることを確認してください。",
              "Sign in as the Server Owner and confirm NEXUS is installed.",
            )}
          </p>
          <a
            className="button button-discord"
            href={`/auth/login?offering=${offering.id}`}
          >
            {copy(locale, "Discordでログイン", "Sign in with Discord")}
          </a>
          <a
            className="button button-secondary"
            href={`/checkout?offering=${offering.id}`}
          >
            {copy(locale, "サーバーを選び直す", "Choose a server again")}
          </a>
        </section>
      </SiteShell>
    );
  }
  let blocked: string | undefined;
  try {
    await context.billing.assertNewCheckout(context.scope, "STRIPE");
  } catch (error) {
    blocked = error instanceof Error ? error.message : "BILLING_UNAVAILABLE";
  }
  if (blocked)
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(
              locale,
              blocked === "BILLING_ORGANIZATION_LICENSE_EXISTS"
                ? "組織のScaleプランでカバーされています"
                : "契約状態を確認してください",
              blocked === "BILLING_ORGANIZATION_LICENSE_EXISTS"
                ? "Covered by your organization plan"
                : "Review your existing billing state",
            )}
          </h1>
          <p>
            {copy(
              locale,
              "既存の契約または確認待ちの購入があります。新しい契約を作成する前に、支払い管理で状態を確認してください。",
              "An existing subscription or pending purchase needs review before starting a new contract.",
            )}
          </p>
          <a href="/billing/manage" className="button button-primary">
            {copy(locale, "支払いを管理", "Manage billing")}
          </a>
        </section>
      </SiteShell>
    );
  const connected =
    (
      await context.services.verification.connection(
        context.scope,
        context.session.userId,
      )
    ).state === "VERIFIED";
  return (
    <SiteShell locale={locale}>
      <section className="site-section checkout-intro">
        <p className="site-eyebrow">NEXUS · SECURE CHECKOUT</p>
        <h1>{copy(locale, "注文内容を確認", "Review your order")}</h1>
        {!commercialLaunch().livemode && (
          <p className="badge">
            {copy(
              locale,
              "Sandbox · 実際の請求はありません",
              "Sandbox · No real-money charge",
            )}
          </p>
        )}
        <CheckoutReview
          connected={connected}
          order={{
            offeringId: offering.id,
            plan: offering.plan_key,
            guildId: guild,
            guildName: context.snapshot.member.guildName ?? guild,
            currency: offering.currency,
            amountMinor: offering.final_price_minor,
            locale,
            sandbox: !commercialLaunch().livemode,
          }}
        />
      </section>
    </SiteShell>
  );
}
