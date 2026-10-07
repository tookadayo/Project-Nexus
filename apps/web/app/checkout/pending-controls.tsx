"use client";
import { useState, useRef } from "react";
export function PendingControls({
  token,
  locale,
}: {
  token: string;
  locale: "ja" | "en";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    ja = locale === "ja";
  async function abandon() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/checkout/abandon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: token }),
      });
      if (!response.ok) throw new Error("CHECKOUT_EXPIRY_UNCONFIRMED");
      window.location.reload();
    } catch {
      setError(
        ja
          ? "Checkoutの失効を確認できません。再購入は保留してください。"
          : "Checkout expiry could not be confirmed. Keep the new purchase on hold.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="button button-secondary"
        onClick={() => void abandon()}
        disabled={busy}
        aria-busy={busy}
      >
        {ja
          ? "前のCheckoutを失効して選び直す"
          : "Expire Checkout and choose again"}
      </button>
      <p role="alert">{error}</p>
    </>
  );
}
