import { SiteShell, siteLocale, copy } from "../public-ui";
import { billingContext } from "./context";
import { BillingControls } from "./controls";
import { planCopy } from "../../../../packages/settings/src/plan-copy";
import { currentRecipe } from "../../../../packages/settings/src/recipes";
import { RecipeControls } from "./recipe-controls";
import { CommerceControls } from "./commerce-controls";
export async function BillingView({
  section = "overview",
  selectedOffering,
}: {
  section?: "overview" | "manage" | "promotions";
  selectedOffering?:string;
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
  const status = await context.billing.view(context.scope),
    externalConfigured = status.presentation.billingActions.purchase.some(
      (action) => action.method === "CHECKOUT" && action.configured,
    ),
    store = status.presentation.billingActions.purchase.find(
      (action) => action.provider === "DISCORD" && action.available,
    )?.url;
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
          <a href="/billing/payments">
            {copy(locale, "自分が管理している支払い", "My payments")}
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
              {subscription.scheduledPlan && <> · {copy(locale,"変更予定","Scheduled change")}: {subscription.scheduledPlan} {subscription.scheduledAt ? new Date(subscription.scheduledAt).toLocaleDateString(locale):""}</>}
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
        {context.ownership==="BILLING_OWNERSHIP_REVIEW" && <p role="status" className="billing-warning">{copy(locale,"DiscordのOwnerと支払いの責任者が異なります。契約は維持されます。支払い情報の引き継ぎは確認が必要です。","The current Discord Owner differs from the Primary Billing Principal. Your subscription remains active; financial ownership needs review.")}</p>}
        {context.ownership==="UNCLAIMED" && status.subscriptions.some(s=>s.provider==="STRIPE") && <p role="status" className="billing-warning">{copy(locale,"この既存契約の金融権限は確認が必要です。現在のOwnerへ自動で請求情報を公開しません。","Financial authority for this historical contract requires review before exposing billing details.")}</p>}
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
            {context.canManage && <CommerceControls locale={locale} currentPlan={status.subscriptions.find(s=>s.provider==="STRIPE" && s.status==="ACTIVE")?.plan ?? status.plan} purchase={[]} manage={status.presentation.billingActions.manage.filter(action=>action.method!=="PORTAL" || context.canPortal)} selectedOffering={selectedOffering}/>}
            <p>
              {copy(
                locale,
                externalConfigured
                  ? "変更内容のプレビューも確認できます。支払い操作後は契約の確認結果が反映されます。"
                  : "外部決済は準備中です。プラン変更の内容を確認できます。",
                externalConfigured
                  ? "You can also review a plan change preview. Billing changes appear after subscription confirmation."
                  : "External checkout is unconfigured. You can review a plan change preview.",
              )}
            </p>
            {context.canManage && store && (
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
        {section === "promotions" && context.canManage && (
          <BillingControls locale={locale} mode="promotion" />
        )}
        {section === "manage" &&
          context.canCommunity && status.presentation.featureDecisions.custom_recipe.allowed && (
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
