"use client";
import { useEffect, useState } from "react";
const states = [
  "CONFIRMING",
  "ACTIVE",
  "ACTION_REQUIRED",
  "FAILED",
  "EXPIRED",
] as const;
export type ConfirmationState = (typeof states)[number];
export function CheckoutConfirmation({
  receipt,
  initial,
  locale,
}: {
  receipt: string;
  initial: ConfirmationState;
  locale: "ja" | "en";
}) {
  const [state, setState] = useState(initial),
    [unavailable, setUnavailable] = useState(false);
  const ja = locale === "ja";
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function poll() {
      try {
        const response = await fetch(
          `/checkout/status?receipt=${encodeURIComponent(receipt)}`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const result = await response.json();
          if (!stopped && states.includes(result.state)) {
            setState(result.state);
            setUnavailable(false);
            if (result.state === "ACTIVE") return;
          }
        } else if (!stopped) setUnavailable(true);
      } catch {
        if (!stopped) setUnavailable(true);
      }
      if (!stopped && ++attempts < 100)
        timer = setTimeout(poll, Math.min(10000, 3000 + attempts * 200));
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [receipt]);
  const text = {
    CONFIRMING: ja
      ? "NEXUSがStripeとの契約を確認しています。確認が完了するまで、以前の利用権限を維持します。"
      : "NEXUS is confirming your subscription with Stripe. Your previous access remains in effect until confirmation.",
    ACTIVE: ja ? "プランが有効になりました。" : "Your plan is active.",
    ACTION_REQUIRED: ja
      ? "Stripeで支払い・追加認証を完了してください。"
      : "Complete payment or additional authentication on Stripe.",
    FAILED: ja
      ? "Checkoutを完了できませんでした。"
      : "Checkout could not be completed.",
    EXPIRED: ja
      ? "Checkoutの有効期限が切れました。購入情報を再確認して再度開始してください。"
      : "Checkout expired. Review your order before starting a new Checkout.",
  };
  return (
    <div className="checkout-confirmation" data-state={state}>
      <p role="status" aria-live="polite">
        <strong>{state}</strong> — {text[state]}
      </p>
      {unavailable && (
        <p role="status">
          {ja
            ? "現在の状態を再確認できません。支払い済みの場合は、再購入せずに時間をおいて確認してください。"
            : "The current state could not be refreshed. If you have paid, check again shortly before starting another purchase."}
        </p>
      )}
      {state === "ACTION_REQUIRED" && (
        <a
          className="button button-primary"
          href={`/checkout/payment?receipt=${encodeURIComponent(receipt)}`}
        >
          {ja ? "Stripeの支払いに戻る" : "Return to Stripe payment"}
        </a>
      )}
      {state === "ACTIVE" && (
        <a className="button button-primary" href="/billing/manage">
          {ja ? "支払いを管理" : "Manage billing"}
        </a>
      )}
      <button
        className="button button-secondary"
        onClick={() => window.location.reload()}
      >
        {ja ? "状態を再確認" : "Refresh confirmation"}
      </button>
    </div>
  );
}
