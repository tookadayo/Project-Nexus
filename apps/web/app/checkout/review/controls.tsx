"use client";
import { useRef, useState } from "react";
import { offeringAmount, offeringTaxLabel, type CheckoutOrder } from "../order";
export function CheckoutReview({
  order,
  connected,
  taxBehavior,
}: {
  order: CheckoutOrder;
  connected: boolean;
  taxBehavior: "INCLUSIVE" | "EXCLUSIVE";
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [code, setCode] = useState("");
  const pending = useRef(false),
    key = useRef<string | null>(null),
    reserveKey = useRef<{ code: string; key: string } | null>(null);
  const ja = order.locale === "ja";
  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (!connected) {
        const response = await fetch("/checkout/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guildId: order.guildId, confirm: true }),
        });
        if (!response.ok) throw new Error("CONNECT_FAILED");
        window.location.reload();
        return;
      }
      key.current ??= crypto.randomUUID();
      let promotionReservationId: string | undefined;
      if (code.trim()) {
        if (reserveKey.current?.code !== code.trim())
          reserveKey.current = { code: code.trim(), key: crypto.randomUUID() };
        const response = await fetch("/checkout/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reserve",
            guildId: order.guildId,
            offeringId: order.offeringId,
            idempotencyKey: reserveKey.current.key,
            code: code.trim(),
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        promotionReservationId = result.id;
      }
      const response = await fetch("/checkout/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          guildId: order.guildId,
          offeringId: order.offeringId,
          idempotencyKey: key.current,
          promotionReservationId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.kind === "HOSTED") {
        window.location.assign(result.url);
        return;
      }
      const confirmation = new URL(
        result.confirmationUrl,
        window.location.origin,
      );
      window.location.assign(
        `/checkout/payment?receipt=${encodeURIComponent(confirmation.searchParams.get("receipt")!)}`,
      );
    } catch (error) {
      const expired =
        error instanceof Error && error.message === "BILLING_SESSION_EXPIRED";
      if (expired) key.current = null;
      setMessage(
        expired
          ? ja
            ? "Checkoutの有効期限が切れました。再度開始してください。"
            : "Checkout expired. Start a new Checkout."
          : ja
            ? "操作を完了できませんでした。権限と契約状態を再確認してください。支払いは自動で再試行しません。"
            : "This action could not be completed. Recheck your authority and billing state before retrying.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="checkout-review-card">
      <p className="site-eyebrow">ORDER SUMMARY</p>
      <h2>{order.plan}</h2>
      <p className="checkout-price">
        {offeringAmount(order)} <small>/{ja ? "月" : "month"}</small>
      </p>
      <p>
        {offeringTaxLabel(taxBehavior, order.locale)} ·{" "}
        {ja ? "月ごとに更新" : "Renews monthly"}
      </p>
      <div className="checkout-guild">
        <span aria-hidden="true" className="checkout-guild-icon">
          #
        </span>
        <div>
          <strong>{order.guildName}</strong>
          <p>{ja ? "現在のOwner権限を確認済み" : "Current Owner verified"}</p>
        </div>
      </div>
      {!connected ? (
        <p>
          {ja
            ? "接続するサーバーとNEXUS Webへのアクセスを確認し、明示的に接続してください。"
            : "Confirm this server and connect it to NEXUS Web to continue."}
        </p>
      ) : (
        <>
          <p>
            {ja
              ? "最終的な割引・税・合計額は、Stripeの決済画面で確認してください。"
              : "Review the final discount, tax and total in the Stripe payment form."}
          </p>
          <label className="checkout-label">
            {ja ? "割引コード（任意）" : "Discount code (optional)"}
            <input
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                key.current = null;
              }}
              type="password"
              autoComplete="off"
              maxLength={128}
              disabled={busy}
            />
          </label>
        </>
      )}
      <button
        className="button button-primary"
        onClick={() => void submit()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy
          ? ja
            ? "確認中…"
            : "Confirming…"
          : connected
            ? ja
              ? "支払いへ進む"
              : "Continue to payment"
            : ja
              ? "このサーバーをNEXUSに接続"
              : "Connect this server to NEXUS"}
      </button>
      <p role="alert" aria-live="polite">
        {message}
      </p>
      <a href={`/checkout?offering=${order.offeringId}`}>
        {ja ? "別のサーバーを選ぶ" : "Choose another server"}
      </a>
    </div>
  );
}
