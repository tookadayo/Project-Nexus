"use client";
import { useState, type FormEvent } from "react";
export function AdminBillingControls({ locale }: { locale: "ja" | "en" }) {
  const [result, setResult] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    ja = locale === "ja";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setCode("");
    const data = new FormData(event.currentTarget);
    try {
      const payload = JSON.parse(String(data.get("payload") || "{}"));
      const response = await fetch("/billing/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: data.get("action"),
          reason: data.get("reason"),
          ...payload,
        }),
      });
      const body = await response.json();
      if (body.code) {
        setCode(body.code);
        delete body.code;
      }
      setResult(
        response.ok
          ? JSON.stringify(body, null, 2)
          : ja
            ? "操作を完了できません。権限と入力を確認してください。"
            : "Action could not be completed. Check your authority and input.",
      );
    } catch {
      setResult(
        ja
          ? "入力または接続を確認してください。"
          : "Check the input and connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="billing-card">
      <p>
        {ja
          ? "全操作を監査記録に残します。コードは生成時に一度だけ表示します。"
          : "Every action is audited. Plaintext codes are shown only at generation."}
      </p>
      <form onSubmit={submit} className="billing-form">
        <label>
          {ja ? "操作" : "Action"}
          <select name="action">
            {[
              ["create_campaign", "Create campaign"],
              ["activate_campaign", "Activate discount after policy checks"],
              ["generate_code", "Generate code"],
              ["search", "Search campaigns"],
              ["revoke_code", "Revoke code"],
              ["revoke_campaign", "Revoke campaign"],
              ["history", "Redemption history"],
              ["issue_grant", "Issue Partner / Debug / Contract grant"],
              ["revoke_grant", "Revoke grant"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {ja ? "理由（必須）" : "Reason (required)"}
          <input name="reason" minLength={8} maxLength={500} required />
        </label>
        <label>
          {ja ? "操作の入力（JSON）" : "Action input (JSON)"}
          <textarea
            name="payload"
            rows={10}
            maxLength={16384}
            defaultValue={'{\n  "query": ""\n}'}
          />
        </label>
        <details>
          <summary>{ja ? "入力例" : "Input examples"}</summary>
          <p>
            Search: query. Codes/history/revoke: id (campaign ID for generation
            and history). Issue grant: scope and grant. Revoke grant: scope and
            id. Campaign creation: campaign.
          </p>
          <pre>
            {JSON.stringify(
              {
                campaign: {
                  name: "Community trial",
                  benefitType: "TRIAL",
                  targetPlan: "GROWTH",
                  durationDays: 90,
                  validFrom: "2026-10-02T00:00:00Z",
                  allowedPlans: ["FREE", "STARTER"],
                  allowedProviders: ["MANUAL", "STRIPE", "DISCORD"],
                  stackingPolicy: "DENY",
                  maxRedemptions: 10,
                },
              },
              null,
              2,
            )}
          </pre>
          <pre>
            {JSON.stringify(
              {
                scope: {
                  organizationId: "Organization UUID",
                  guildId: "Discord guild ID",
                },
                grant: { source: "DEBUG", plan: "GROWTH", durationDays: 7 },
              },
              null,
              2,
            )}
          </pre>
          <p>
            Partner: source PARTNER, untilRevoked true. Debug: expires by
            default in 7 days, maximum 30 days. Contract: explicit scoped
            limits. No code may grant Partner or Debug access to a guild admin.
          </p>
        </details>
        <button className="button button-primary" disabled={busy}>
          {ja ? "実行" : "Run action"}
        </button>
      </form>
      {code && (
        <p role="status">
          {ja ? "一度だけ表示されるコード" : "Code shown once"}:{" "}
          <code>{code}</code>
        </p>
      )}
      {result && (
        <pre role="status" className="billing-result">
          {result}
        </pre>
      )}
    </article>
  );
}
