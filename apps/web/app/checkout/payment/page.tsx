import { SiteShell, siteLocale, copy } from "../../public-ui";
import { CheckoutPayment } from "./element";
import { checkoutReceiptContext } from "../receipt-context";
import { commercialLaunch } from "../../../../../packages/settings/src/billing/commerce";
export const dynamic = "force-dynamic";
export default async function Payment({
  searchParams,
}: {
  searchParams: Promise<{ receipt?: string }>;
}) {
  const locale = await siteLocale(),
    { receipt } = await searchParams;
  let context;
  try {
    context = await checkoutReceiptContext(receipt);
  } catch {
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(
              locale,
              "Checkoutを確認できません",
              "Checkout is unavailable",
            )}
          </h1>
          <p>
            {copy(
              locale,
              "Discordセッションと購入情報を確認してください。",
              "Check your Discord session and order.",
            )}
          </p>
          <a href="/pricing">{copy(locale, "プランを見る", "View plans")}</a>
        </section>
      </SiteShell>
    );
  }
  if (!["CONFIRMING", "ACTION_REQUIRED"].includes(context.confirmation))
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>{context.confirmation}</h1>
          <a
            href={`/checkout/confirmation?receipt=${encodeURIComponent(receipt!)}`}
          >
            {copy(locale, "契約状態を見る", "View subscription confirmation")}
          </a>
          <a href={`/checkout?offering=${context.offering.id}`}>
            {copy(locale, "Checkoutへ戻る", "Return to Checkout")}
          </a>
        </section>
      </SiteShell>
    );
  const result = context.result,
    key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (result?.kind !== "ELEMENTS" || !result.clientSecret || !key)
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(
              locale,
              "支払いフォームを確認してください",
              "Review your payment form",
            )}
          </h1>
          {result?.url &&
          new URL(result.url).origin === "https://checkout.stripe.com" ? (
            <a className="button button-primary" href={result.url}>
              Continue to Stripe
            </a>
          ) : (
            <p role="status">
              {copy(
                locale,
                "Stripeの接続を確認中です。契約状態は変更しません。",
                "Stripe is unavailable. Your subscription state is preserved.",
              )}
            </p>
          )}
        </section>
      </SiteShell>
    );
  return (
    <SiteShell locale={locale}>
      <section className="site-section checkout-intro">
        <header className="checkout-heading">
          <h1>{copy(locale, "安全なCheckout", "Secure Checkout")}</h1>
          <span>Stripe</span>
        </header>
        <CheckoutPayment
          clientSecret={result.clientSecret}
          publishableKey={key}
          confirmationUrl={`/checkout/confirmation?receipt=${encodeURIComponent(receipt!)}`}
          order={{
            offeringId: context.offering.id,
            plan: context.offering.planKey,
            guildId: context.scope.guildId,
            guildName: context.result?.guildName ?? context.scope.guildId,
            currency: context.offering.currency!,
            amountMinor: context.offering.unitAmountMinor!,
            locale,
            sandbox: !commercialLaunch().livemode,
          }}
        />
      </section>
    </SiteShell>
  );
}
