import { cookies } from "next/headers";
import { checkoutReceiptContext } from "./receipt-context";
import { PendingControls } from "./pending-controls";
export async function pendingCheckout() {
  const token = (await cookies()).get("nexus_checkout_receipt")?.value;
  if (!token) return null;
  try {
    const context = await checkoutReceiptContext(token);
    return ["CONFIRMING", "ACTION_REQUIRED"].includes(context.confirmation)
      ? { context, token }
      : null;
  } catch {
    return null;
  }
}
export function PendingCheckout({
  token,
  locale,
}: {
  token: string;
  locale: "ja" | "en";
}) {
  return (
    <section className="site-section checkout-intro">
      <h1>
        {locale === "ja"
          ? "前のCheckoutを確認してください"
          : "Review your pending Checkout"}
      </h1>
      <p>
        {locale === "ja"
          ? "サーバーを変更する前に、作成済みのCheckoutを失効させてください。"
          : "Expire the previous Checkout before choosing a different server."}
      </p>
      <a
        className="button button-primary"
        href={`/checkout/payment?receipt=${encodeURIComponent(token)}`}
      >
        {locale === "ja" ? "支払いを再開" : "Resume payment"}
      </a>
      <PendingControls token={token} locale={locale} />
    </section>
  );
}
