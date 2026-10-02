"use client";
import { useState, type FormEvent } from "react";
import { plans } from "../../../../packages/settings/src/plan-registry";
import {
  featureCopy,
  limitCopy,
} from "../../../../packages/settings/src/plan-copy";
import type { PlanChangePreview } from "../../../../packages/settings/src/billing";
export function BillingControls({
  locale,
  mode,
}: {
  locale: "ja" | "en";
  mode: "preview" | "promotion";
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<PlanChangePreview | null>(null),
    ja = locale === "ja";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      const response = await fetch("/billing/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "promotion"
            ? { action: "redeem", code: data.get("code") }
            : {
                action: "preview",
                targetPlan: data.get("plan"),
                provider: data.get("provider"),
              },
        ),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(
          ja
            ? "この操作を完了できません。コードと現在の権限を確認してください。"
            : "This action could not be completed. Check the code and your current authority.",
        );
        return;
      }
      if (mode === "promotion") {
        form.reset();
        setMessage(
          ja
            ? `${result.plan}を利用できます。期限: ${result.benefitEnd ? new Date(result.benefitEnd).toLocaleDateString("ja-JP") : "取消まで"}`
            : `${result.plan} is available. Valid until ${result.benefitEnd ? new Date(result.benefitEnd).toLocaleDateString("en-US") : "revoked"}.`,
        );
      } else setPreview(result);
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
      <form onSubmit={submit} className="billing-form">
        {mode === "promotion" ? (
          <label>
            {ja ? "プロモーションコード" : "Promotion code"}
            <input
              name="code"
              type="password"
              autoComplete="off"
              maxLength={128}
              required
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            <label>
              {ja ? "変更先" : "Target plan"}
              <select name="plan">
                {plans.map((plan) => (
                  <option key={plan}>{plan}</option>
                ))}
              </select>
            </label>
            <label>
              {ja ? "支払い元" : "Provider"}
              <select name="provider">
                <option value="STRIPE">{ja ? "Web" : "Web"}</option>
                <option value="DISCORD">Discord</option>
              </select>
            </label>
          </>
        )}
        <button className="button button-primary" disabled={busy}>
          {mode === "promotion"
            ? ja
              ? "特典を適用"
              : "Redeem benefit"
            : ja
              ? "変更内容を確認"
              : "Preview change"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      {preview && (
        <div role="status">
          <h3>
            {preview.currentPlan} → {preview.targetPlan}
          </h3>
          <p>
            {ja ? "適用予定" : "Effective"}:{" "}
            {preview.effectiveAt
              ? new Date(preview.effectiveAt).toLocaleDateString(locale)
              : ja
                ? "決済側の確認後"
                : "After provider confirmation"}
          </p>
          <p>
            {ja ? "新しく使える機能" : "Features gained"}:{" "}
            {preview.featuresGained
              .map((key) => featureCopy[key][ja ? 0 : 1])
              .join(" · ") || "—"}
          </p>
          <p>
            {ja ? "使えなくなる機能" : "Features lost"}:{" "}
            {preview.featuresLost
              .map((key) => featureCopy[key][ja ? 0 : 1])
              .join(" · ") || "—"}
          </p>
          <ul>
            {preview.limitsChanged.map((limit) => (
              <li key={limit.key}>
                {limitCopy[limit.key][ja ? 0 : 1]}:{" "}
                {limit.from ?? (ja ? "個別" : "Custom")} →{" "}
                {limit.to ?? (ja ? "個別" : "Custom")}
              </li>
            ))}
          </ul>
          <p>
            {ja ? "履歴の表示日数" : "History visibility"}:{" "}
            {preview.historyVisibilityChange.fromDays} →{" "}
            {preview.historyVisibilityChange.toDays}
          </p>
          <p>
            {ja ? "一時停止する自動化" : "Automations that pause"}:{" "}
            {preview.automationsThatWillPause.length}
          </p>
          <p>
            {ja ? "サーバー割当の確認" : "Guild allocation review"}:{" "}
            {preview.guildAssignmentImpact.requiresReview
              ? ja
                ? "必要"
                : "Required"
              : "—"}
          </p>
          <p>
            {ja
              ? "税・金額・日割りは決済側で確認します。これはプラン変更の完了ではありません。"
              : "Prices, tax and proration are confirmed by the provider. This preview does not change your plan."}
          </p>
        </div>
      )}
    </div>
  );
}
