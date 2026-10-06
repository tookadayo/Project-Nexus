"use client";
import { useRef, useState, type FormEvent } from "react";
import type { Plan } from "../../../../packages/settings/src/plan-registry";
type Offering = {
  id: string;
  plan: Plan;
  currency: string;
  unitAmountMinor: number;
  interval: string;
};
type Action = {
  provider: string;
  method: string;
  available: boolean;
  offerings?: Offering[];
};
export function CommerceControls({
  locale,
  currentPlan,
  purchase,
  manage,
  selectedOffering,
}: {
  locale: "ja" | "en";
  currentPlan: Plan;
  purchase: Action[];
  manage: Action[];
  selectedOffering?: string;
}) {
  const ja = locale === "ja",
    checkout = purchase.find((a) => a.method === "CHECKOUT" && a.available),
    change = manage.find((a) => a.method === "CHANGE" && a.available);
  const offerings = (change ?? checkout)?.offerings ?? [],
    keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [paymentUrl, setPaymentUrl] = useState<string>();
  const busyRef = useRef(false);
  const key = (identity: string) => {
    let value = keys.current.get(identity);
    if (!value) {
      value = crypto.randomUUID();
      keys.current.set(identity, value);
    }
    return value;
  };
  async function request(
    action: string,
    offeringId?: string,
    code?: string,
    promotionReservationId?: string,
  ) {
    const response = await fetch("/billing/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        idempotencyKey: key(
          `${action}:${offeringId ?? ""}:${promotionReservationId ?? code ?? ""}`,
        ),
        ...(offeringId ? { offeringId } : {}),
        ...(code ? { code } : {}),
        ...(promotionReservationId ? { promotionReservationId } : {}),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "BILLING_ACTION_FAILED");
    return result;
  }
  async function run(action: string, offeringId?: string, code?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const reservation =
        action === "checkout" && code
          ? await request("reserve", offeringId, code)
          : undefined;
      const result = await request(
        action,
        offeringId,
        undefined,
        reservation?.id,
      );
      if (result.state === "PAYMENT_ACTION_REQUIRED" && result.paymentUrl) {
        setPaymentUrl(result.paymentUrl);
        setMessage(
          ja
            ? "アップグレードの支払い・追加認証をStripeで完了してください。確認が完了するまで現在のプランを維持します。"
            : "Complete the upgrade payment or authentication on Stripe. Your current plan remains active until confirmation.",
        );
        return;
      }
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setMessage(
        ja
          ? "変更を受け付けました。契約状態を確認しています。"
          : "Change received. Confirming subscription state.",
      );
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "BILLING_ACTION_FAILED";
      setMessage(
        [
          "BILLING_RECONCILE_REQUIRED",
          "BILLING_CHECKOUT_IN_PROGRESS",
          "BILLING_EXISTING_SUBSCRIPTION",
        ].includes(code)
          ? ja
            ? "購入または変更を確認中です。支払い管理画面で状態を確認してください。"
            : "A purchase or change needs confirmation. Check the billing state before trying again."
          : ja
            ? "操作を完了できませんでした。現在の契約と権限を確認してください。"
            : "This action could not be completed. Check your current subscription and authority.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      change ? "change" : "checkout",
      String(form.get("offeringId")),
      String(form.get("promotion") ?? "").trim() || undefined,
    );
  }
  return (
    <article className="billing-card">
      <h2>
        {ja ? "購入と契約の管理" : "Purchase and subscription management"}
      </h2>
      {offerings.length > 0 && (
        <form onSubmit={submit} className="billing-form">
          <label>
            {ja ? "変更先のプラン" : "Target plan"}
            <select
              name="offeringId"
              defaultValue={selectedOffering}
              disabled={busy}
              required
            >
              {offerings
                .filter((o) => !change || o.plan !== currentPlan)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.plan} ·{" "}
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: o.currency,
                    }).format(o.unitAmountMinor / 100)}{" "}
                    /{" "}
                    {o.interval === "MONTH"
                      ? ja
                        ? "月"
                        : "month"
                      : ja
                        ? "年"
                        : "year"}
                  </option>
                ))}
            </select>
          </label>
          {!change && (
            <label>
              {ja ? "割引コード（任意）" : "Discount code (optional)"}
              <input
                name="promotion"
                type="password"
                autoComplete="off"
                maxLength={128}
                disabled={busy}
              />
            </label>
          )}
          <p>
            {change
              ? ja
                ? "アップグレードは日割り料金の支払確認後に即時適用。ダウングレードは現在の有料期間終了時に適用します。"
                : "Upgrades apply after payment of an immediate prorated invoice. Downgrades apply at the end of the current paid period."
              : ja
                ? "支払いはStripeの安全なページで行います。NEXUSへカード番号は保存しません。"
                : "Payment takes place on Stripe's hosted page. NEXUS does not store card numbers."}
          </p>
          <button className="button button-primary" disabled={busy}>
            {busy
              ? ja
                ? "確認中…"
                : "Confirming…"
              : change
                ? ja
                  ? "プラン変更を申し込む"
                  : "Request plan change"
                : ja
                  ? "Checkoutへ進む"
                  : "Continue to Checkout"}
          </button>
        </form>
      )}
      {manage
        .filter(
          (a) =>
            a.available && ["PORTAL", "CANCEL", "PAYMENT"].includes(a.method),
        )
        .map((a) => (
          <button
            key={a.method}
            className="button button-secondary"
            disabled={busy}
            onClick={() => void run(a.method.toLowerCase())}
          >
            {a.method === "PAYMENT"
              ? ja
                ? "保留中の支払いを確認"
                : "Review pending payment"
              : a.method === "PORTAL"
                ? ja
                  ? "支払い方法・請求履歴を管理"
                  : "Manage payment methods and invoices"
                : ja
                  ? "有料期間の終了時に解約"
                  : "Cancel at period end"}
          </button>
        ))}
      {!checkout && !manage.some((a) => a.available) && (
        <p>
          {ja
            ? "この契約の支払い操作は現在利用できません。"
            : "Billing actions for this subscription are currently unavailable."}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {paymentUrl && (
        <a className="button button-primary" href={paymentUrl}>
          {ja ? "Stripeで支払い・認証を完了" : "Complete payment on Stripe"}
        </a>
      )}
    </article>
  );
}
