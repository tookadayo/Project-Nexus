"use client";
import { useRef, useState } from "react";
export function PersonalPaymentControls({
  accountId,
  locale,
  canPortal,
}: {
  accountId: string;
  locale: "ja" | "en";
  canPortal: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const keys = useRef<Partial<Record<"portal" | "cancel", string>>>({});
  const ja = locale === "ja";
  async function submit(action: "portal" | "cancel") {
    setBusy(true);
    setMessage("");
    const idempotencyKey = (keys.current[action] ??= crypto.randomUUID());
    try {
      const response = await fetch("/billing/payments/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          accountId,
          idempotencyKey,
          ...(action === "cancel" ? { confirmed } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(
          ja
            ? "支払いを確認できません。再ログインして、支払いの権限を確認してください。"
            : "We could not verify this payment. Sign in again and check your billing authority.",
        );
        return;
      }
      if (
        action === "portal" &&
        typeof result.url === "string" &&
        new URL(result.url).origin === "https://billing.stripe.com"
      ) {
        window.location.assign(result.url);
        return;
      }
      setMessage(
        ja
          ? "期間終了時の解約を受け付けました。支払い画面で最新の状況を確認してください。"
          : "Cancellation at the end of the current period was requested. Check the payment portal for its latest status.",
      );
    } catch {
      setMessage(
        ja
          ? "接続を確認して再試行してください。"
          : "Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="billing-card">
      {canPortal && (
        <button disabled={busy} onClick={() => void submit("portal")}>
          {ja ? "請求・支払方法を確認" : "View invoices and payment methods"}
        </button>
      )}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {ja
          ? "現在の期間が終わった時点で、この契約を解約します。"
          : "Cancel this subscription when the current billing period ends."}
      </label>
      <button
        disabled={busy || !confirmed}
        onClick={() => void submit("cancel")}
      >
        {ja ? "期間終了時に解約" : "Cancel at period end"}
      </button>
      <p role="status">{message}</p>
      <a href="/auth/login?next=%2Fbilling%2Fpayments">
        {ja ? "再ログイン" : "Sign in again"}
      </a>
    </div>
  );
}
