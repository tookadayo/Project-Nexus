import { SiteShell, siteLocale, copy } from "../public-ui";
import { billingContext } from "./context";
import { BillingControls } from "./controls";
import { planCopy } from "../../../../packages/settings/src/plan-copy";
import {
  discordBillingConfiguration,
  nativeBillingCapability,
  discordStoreUrl,
} from "../../../../packages/settings/src/billing-provider";
import { featureDecision } from "../../../../packages/settings/src/billing-domain";
import { currentRecipe } from "../../../../packages/settings/src/recipes";
import { RecipeControls } from "./recipe-controls";
export async function BillingView({
  section = "overview",
}: {
  section?: "overview" | "manage" | "promotions";
}) {
  const locale = await siteLocale();
  let context;
  try {
    context = await billingContext();
  } catch {
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>{copy(locale, "プランと支払い", "Plans and billing")}</h1>
          <p>
            {copy(
              locale,
              "現在の権限を確認して、このサーバーのプランを表示します。",
              "Sign in and verify this server to view its plan with current authorization.",
            )}
          </p>
          <a className="button button-primary" href="/servers">
            {copy(locale, "サーバーを選ぶ", "Choose a server")}
          </a>
        </section>
      </SiteShell>
    );
  }
  const status = await context.billing.status(context.scope),
    native = nativeBillingCapability(discordBillingConfiguration()),
    store = discordStoreUrl(discordBillingConfiguration());
  return (
    <SiteShell locale={locale}>
      <section className="site-section">
        <p className="site-eyebrow">NEXUS · {context.scope.guildId}</p>
        <h1>{copy(locale, "プランと支払い", "Plans and billing")}</h1>
        <nav className="billing-nav" aria-label="Billing">
          <a href="/billing">{copy(locale, "現在のプラン", "Current plan")}</a>
          <a href="/billing/plans">
            {copy(locale, "プランを比較", "Compare plans")}
          </a>
          <a href="/billing/manage">
            {copy(locale, "支払いを管理", "Manage billing")}
          </a>
          <a href="/billing/promotions">
            {copy(locale, "プロモーション", "Promotions")}
          </a>
        </nav>
        <article className="billing-card">
          <span className="badge badge-violet">{status.plan}</span>
          <h2>{planCopy[status.plan].heading[locale === "ja" ? 0 : 1]}</h2>
          <p>
            {copy(locale, "契約元", "Provider")}:{" "}
            {status.subscriptions
              .map((subscription) => subscription.provider)
              .join(" / ") || copy(locale, "契約なし", "No subscription")}
          </p>
          {status.subscriptions.map((subscription) => (
            <p key={subscription.id}>
              {subscription.status} ·{" "}
              {copy(locale, "更新／終了日", "Renewal / end")}:{" "}
              {subscription.periodEnd
                ? new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(subscription.periodEnd))
                : copy(locale, "未確定", "Not confirmed")}
            </p>
          ))}
          <p>
            {copy(locale, "月間観測人数", "Observed members this month")}:{" "}
            {status.usage.used.toLocaleString()} /{" "}
            {status.usage.included?.toLocaleString() ??
              copy(locale, "個別", "Custom")}{" "}
            · {copy(locale, "運用上の目安", "Soft allowance")}
          </p>
          <p>
            {copy(locale, "表示できる集計履歴", "Visible aggregate history")}:{" "}
            {status.limits.historyDays ?? copy(locale, "個別", "Custom")}{" "}
            {copy(locale, "日", "days")}
          </p>
        </article>
        {status.conflict && (
          <p role="alert" className="billing-warning">
            {copy(
              locale,
              "支払い元が重複しています。現在は上位の有効プランを利用できます。契約を確認してください。自動キャンセルは行いません。",
              "Overlapping paid providers need review. The higher valid plan applies temporarily. Review both subscriptions; none is automatically canceled.",
            )}
          </p>
        )}
        {status.grace && (
          <p role="status" className="billing-warning">
            {copy(
              locale,
              "支払い状態を確認中です。最後に確認できたプランを一定期間維持しています。",
              "Billing status needs confirmation. Last known good access is preserved for a bounded grace period.",
            )}
          </p>
        )}
        {status.grants.length > 0 && (
          <article className="billing-card">
            <h2>{copy(locale, "利用特典", "Active benefits")}</h2>
            <ul>
              {status.grants.map((grant) => (
                <li key={grant.id}>
                  {grant.plan ??
                    copy(locale, "追加機能", "Additional features")}{" "}
                  ·{" "}
                  {copy(
                    locale,
                    grant.source === "PARTNER"
                      ? "パートナー特典"
                      : grant.source === "DEBUG"
                        ? "開発用の期限付き特典"
                        : "利用特典",
                    grant.source === "PARTNER"
                      ? "Partner grant"
                      : grant.source === "DEBUG"
                        ? "Development grant"
                        : "Benefit",
                  )}{" "}
                  ·{" "}
                  {grant.endsAt
                    ? new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                      }).format(new Date(grant.endsAt))
                    : copy(locale, "取消まで", "Until revoked")}
                </li>
              ))}
            </ul>
          </article>
        )}
        {status.recoveryUntil && (
          <p>
            {copy(
              locale,
              "上位履歴の復旧期限",
              "Higher-history recovery deadline",
            )}
            :{" "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
              new Date(status.recoveryUntil),
            )}
          </p>
        )}
        {status.pausedRules.length > 0 && (
          <p>
            {copy(
              locale,
              "プラン条件により一時停止した設定",
              "Settings paused by plan",
            )}
            : {status.pausedRules.length}
          </p>
        )}
        {section === "manage" && (
          <>
            <p>
              {copy(
                locale,
                "外部決済は準備中です。プラン変更の内容を確認できます。",
                "External checkout is unconfigured. You can review a plan change preview.",
              )}
            </p>
            {native === "AVAILABLE" && store && (
              <a className="button button-primary" href={store}>
                {copy(
                  locale,
                  "Discordで支払いを管理",
                  "Manage billing in Discord",
                )}
              </a>
            )}
            <BillingControls locale={locale} mode="preview" />
          </>
        )}
        {section === "promotions" && (
          <BillingControls locale={locale} mode="promotion" />
        )}
        {section === "manage" &&
          featureDecision(status, "custom_recipe").allowed && (
            <RecipeControls
              locale={locale}
              recipe={await currentRecipe(context.services.db, context.scope)}
            />
          )}
        <p className="pricing-note">
          {copy(
            locale,
            "測定根拠・観測範囲・接続障害・プライバシー・削除は全プランで利用できます。",
            "Evidence, coverage, integration warnings, privacy and deletion remain included in every plan.",
          )}
        </p>
      </section>
    </SiteShell>
  );
}
