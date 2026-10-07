"use client";
import { useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  PaymentElement,
  ContactDetailsElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { type CheckoutOrder } from "../order";
const instances = new Map<string, ReturnType<typeof loadStripe>>();
function stripeFor(key: string) {
  let stripe = instances.get(key);
  if (!stripe) {
    stripe = loadStripe(key);
    instances.set(key, stripe);
  }
  return stripe;
}
export function CheckoutPayment({
  clientSecret,
  publishableKey,
  confirmationUrl,
  order,
}: {
  clientSecret: string;
  publishableKey: string;
  confirmationUrl: string;
  order: CheckoutOrder;
}) {
  const options = useMemo(
    () => ({
      clientSecret,
      elementsOptions: {
        appearance: {
          theme: "stripe" as const,
          variables: { colorPrimary: "#6756de", borderRadius: "10px" },
        },
      },
    }),
    [clientSecret],
  );
  return (
    <CheckoutElementsProvider
      stripe={stripeFor(publishableKey)}
      options={options}
    >
      <PaymentForm order={order} confirmationUrl={confirmationUrl} />
    </CheckoutElementsProvider>
  );
}
function PaymentForm({
  order,
  confirmationUrl,
}: {
  order: CheckoutOrder;
  confirmationUrl: string;
}) {
  const state = useCheckoutElements(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    ja = order.locale === "ja";
  if (state.type === "loading")
    return (
      <p role="status">
        {ja
          ? "Stripeの支払いフォームを読み込み中…"
          : "Loading Stripe payment form…"}
      </p>
    );
  if (state.type === "error")
    return (
      <p role="alert">
        {ja
          ? "支払いフォームを読み込めませんでした。再読み込みしてください。"
          : "The payment form is unavailable. Please reload to try again."}
      </p>
    );
  const checkout = state.checkout;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await checkout.confirm();
      if (result.type === "error") {
        setError(result.error.message);
        return;
      }
      window.location.assign(confirmationUrl);
    } catch {
      setError(
        ja
          ? "支払いの結果を確認できませんでした。Stripeの状態を確認してください。"
          : "The payment result could not be confirmed. Review the payment state on Stripe.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="checkout-grid" onSubmit={(event) => void submit(event)}>
      <section
        className="checkout-payment-fields"
        aria-label={ja ? "支払い情報" : "Payment"}
      >
        <h2>{ja ? "支払い" : "Payment"}</h2>
        <ContactDetailsElement />
        <PaymentElement
          options={{ layout: "accordion" }}
          onLoadError={() =>
            setError(
              ja
                ? "支払い情報を読み込めませんでした。"
                : "Payment details could not be loaded.",
            )
          }
        />
        <p className="checkout-security">
          {ja
            ? "支払い情報はStripeが安全に処理します。NEXUSはカード番号やCVCを保存しません。"
            : "Payment information is securely handled by Stripe. NEXUS does not store your card number or CVC."}
        </p>
        <p>Secure by Stripe</p>
        <p role="alert" aria-live="polite">
          {error}
        </p>
      </section>
      <aside className="checkout-order">
        <p className="site-eyebrow">ORDER SUMMARY</p>
        <h2>{order.plan}</h2>
        <p>
          {ja ? "USD月額サブスクリプション" : "Monthly subscription in USD"}
        </p>
        <div className="checkout-guild">
          <span aria-hidden="true" className="checkout-guild-icon">
            #
          </span>
          <div>
            <strong>{order.guildName}</strong>
            <p>{ja ? "Owner権限確認済み" : "Owner verified"}</p>
          </div>
        </div>
        {order.sandbox && (
          <p className="badge">
            Sandbox · {ja ? "実際の請求はありません" : "No real-money charge"}
          </p>
        )}
      </aside>
      <div className="checkout-totals">
        <dl>
          <div>
            <dt>{ja ? "小計" : "Subtotal"}</dt>
            <dd>{checkout.total.subtotal.amount}</dd>
          </div>
          <div>
            <dt>{ja ? "割引" : "Discount"}</dt>
            <dd>{checkout.total.discount.amount}</dd>
          </div>
          <div>
            <dt>{ja ? "税" : "Tax"}</dt>
            <dd>{checkout.total.taxExclusive.amount}</dd>
          </div>
          <div className="checkout-total">
            <dt>{ja ? "合計" : "Total"}</dt>
            <dd>{checkout.total.total.amount}</dd>
          </div>
        </dl>
        <p>
          {ja
            ? "請求額はStripeの注文情報に基づきます。"
            : "Amounts reflect your order on Stripe."}
        </p>
      </div>
      <div className="checkout-submit">
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || !checkout.canConfirm}
          aria-busy={busy}
        >
          {busy
            ? ja
              ? "支払いを送信中…"
              : "Submitting payment…"
            : ja
              ? `${order.plan}を開始`
              : `Start ${order.plan}`}
        </button>
        <p>
          <a href="/privacy">
            {ja ? "プライバシーポリシー" : "Privacy policy"}
          </a>{" "}
          · <a href="/terms">{ja ? "利用規約" : "Terms"}</a>
        </p>
        <p>
          {ja
            ? "支払い後、NEXUSが契約を確認してからプランを有効化します。"
            : "After payment, NEXUS confirms your subscription before activating the plan."}
        </p>
      </div>
    </form>
  );
}
