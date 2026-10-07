import { SiteShell, copy, siteLocale } from "../../public-ui";
import { checkoutReceiptContext } from "../receipt-context";
import { CheckoutConfirmation } from "./state";
export const dynamic = "force-dynamic";
export default async function Confirmation({
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
              "支払いを確認しています",
              "Payment confirmation pending",
            )}
          </h1>
          <p>
            {copy(
              locale,
              "購入時のDiscordセッションでログインして、契約状態を確認してください。決済画面から戻ったことだけでは、プランは有効になりません。",
              "Sign in with the Discord session used for your purchase to check the subscription. Returning from Checkout alone does not activate a plan.",
            )}
          </p>
          <a href="/billing/manage" className="button button-primary">
            {copy(locale, "支払いを管理", "Manage billing")}
          </a>
        </section>
      </SiteShell>
    );
  }
  return (
    <SiteShell locale={locale}>
      <section className="site-section checkout-intro">
        <p className="site-eyebrow">NEXUS · SUBSCRIPTION CONFIRMATION</p>
        <h1>{copy(locale, "契約の確認", "Subscription confirmation")}</h1>
        <div className="checkout-review-card">
          <h2>{context.offering.planKey}</h2>
          <p>
            {copy(locale, "対象サーバー", "Discord server")}:{" "}
            <strong>
              {context.result?.guildName ?? context.scope.guildId}
            </strong>
          </p>
          <CheckoutConfirmation
            receipt={receipt!}
            initial={context.confirmation}
            locale={locale}
          />
          {["EXPIRED", "FAILED"].includes(context.confirmation) && (
            <a href={`/checkout?offering=${context.offering.id}`}>
              {copy(locale, "購入情報を再確認", "Review your order again")}
            </a>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
