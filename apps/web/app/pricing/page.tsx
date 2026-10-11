import { FeatureComparison, publicFeatureLabel } from "./comparison";
import { PricingFaq } from "./faq";
import { BetaNotice } from "../landing/beta-notice";
import { limitCopy } from "../../../../packages/settings/src/plan-copy";
import {
  featureAvailability,
  planRegistry,
  plans,
  type EntitlementFeature,
  type Plan,
} from "../../../../packages/settings/src/plan-registry";
import { SiteShell, copy, siteLocale } from "../public-ui";
import { publicBillingCatalog } from "../billing/catalog";
import { offeringAmount, offeringTaxLabel } from "../checkout/order";
import "./pricing.css";
const planNames = {
  FREE: "Free",
  STARTER: "Starter",
  GROWTH: "Growth",
  SCALE: "Scale",
  ENTERPRISE: "Enterprise",
} as const;
const planPurposes: Record<Plan, readonly [string, string]> = {
  FREE: ["活動の状況を確認する", "See community activity"],
  STARTER: ["活動の流れを詳しく見る", "Explore activity in more detail"],
  GROWTH: [
    "運営の対応と記録を確認する",
    "Review community actions and records",
  ],
  SCALE: [
    "複数サーバーをチームで運営する",
    "Manage multiple servers as a team",
  ],
  ENTERPRISE: ["利用条件を相談する", "Discuss your requirements"],
};
// An excerpt of existing available capabilities, not a second entitlement registry.
const planHighlights: Record<Plan, readonly EntitlementFeature[]> = {
  FREE: ["core_observation", "fallback_onboarding", "interventions"],
  STARTER: ["csv_export", "saved_views", "heatmaps"],
  GROWTH: ["attention_escalation", "scheduled_reports", "attention_inbox"],
  SCALE: ["multi_guild", "rbac", "audit_export"],
  ENTERPRISE: [],
};

export const dynamic = "force-dynamic";
export default async function Pricing() {
  const locale = await siteLocale(),
    language = locale === "ja" ? 0 : 1;
  const { launch, offerings, status } = await publicBillingCatalog();
  const canPurchase = status === "READY" && launch.checkoutEnabled;
  return (
    <SiteShell locale={locale}>
      <BetaNotice
        locale={locale}
        purchaseMode={
          launch.publishPrices
            ? launch.livemode
              ? "live"
              : "sandbox"
            : "closed"
        }
      />
      <section className="site-section pricing-intro r3-pricing-intro">
        <h1>{copy(locale, "プランを比較する", "Compare plans")}</h1>
        <p>
          {copy(
            locale,
            "使える機能や利用上限を、プランごとに確認できます。",
            "Compare the features and usage limits included in each plan.",
          )}
        </p>
        <p className="r3-pricing-status">
          {copy(
            locale,
            canPurchase
              ? launch.livemode
                ? "USD月額プラン"
                : "Sandbox検証 · 暫定USD価格 · 実際の請求はありません"
              : status === "UNAVAILABLE"
                ? "現在、料金を確認できません。"
                : status === "EMPTY"
                  ? "有料プランの準備中です。"
                  : "有料プランの価格は未公開です。現在、購入はできません。",
            canPurchase
              ? launch.livemode
                ? "Monthly USD plans"
                : "Sandbox testing · Provisional USD prices · No real-money charge"
              : status === "UNAVAILABLE"
                ? "Prices are currently unavailable."
                : status === "EMPTY"
                  ? "Paid plans are being prepared."
                  : "Paid plan prices are not published. Purchases are currently unavailable.",
          )}
        </p>
        {status === "UNAVAILABLE" && (
          <p role="status">
            {copy(
              locale,
              "現在、料金を取得できません。時間をおいて再読み込みしてください。価格の確認ができるまで購入手続きは開始できません。",
              "Prices are temporarily unavailable. Reload this page shortly. Purchase cannot start until prices are confirmed.",
            )}{" "}
            <a href="/pricing">{copy(locale, "再読み込み", "Reload prices")}</a>
          </p>
        )}
        {status === "EMPTY" && (
          <p role="status">
            {copy(
              locale,
              "現在、購入可能な有料プランはありません。",
              "No paid plans are currently available for purchase.",
            )}
          </p>
        )}
      </section>
      <section
        className="pricing-grid r3-pricing-grid"
        aria-label={copy(locale, "通常プラン一覧", "Standard plans")}
      >
        {plans.map((plan, index) => {
          const spec = planRegistry[plan],
            previous = index ? plans[index - 1]! : null;
          const offering = offerings.find((o) => o.plan_key === plan);
          const highlights = planHighlights[plan].filter(
            (feature) =>
              featureAvailability[feature] === "available" &&
              spec.features.includes(feature),
          );
          return (
            <article
              className="price-card r3-price-card"
              key={plan}
              data-pricing-plan={plan}
            >
              <h2 className="r3-plan-name">{planNames[plan]}</h2>
              <p className="r3-plan-purpose">{planPurposes[plan][language]}</p>
              <div className="r3-plan-price">
                <div className={"price" + (offering ? " r3-price-amount" : "")}>
                  {plan === "FREE" ? (
                    copy(locale, "無料", "Free")
                  ) : plan === "ENTERPRISE" ? (
                    copy(locale, "個別相談", "Contact us")
                  ) : offering ? (
                    <>
                      {offeringAmount({
                        locale,
                        currency: offering.currency,
                        amountMinor: offering.final_price_minor,
                      })}
                      <small>/{copy(locale, "月", "month")}</small>
                    </>
                  ) : status === "UNAVAILABLE" ? (
                    copy(locale, "料金を確認できません", "Price unavailable")
                  ) : (
                    copy(locale, "価格は未公開", "Price not published")
                  )}
                </div>
                {offering && (
                  <p className="price-tax">
                    {offeringTaxLabel(offering.tax_behavior, locale)}
                    {" · "}
                    {copy(locale, "月ごとに更新", "Renews monthly")}
                  </p>
                )}
              </div>
              {plan === "FREE" ? (
                <a
                  className="button button-primary r3-plan-cta"
                  href="/support"
                >
                  {copy(locale, "招待Betaの参加案内", "Invitation Beta access")}
                </a>
              ) : offering && canPurchase ? (
                <a
                  className="button button-primary r3-plan-cta"
                  href={"/checkout?offering=" + offering.id}
                >
                  {copy(
                    locale,
                    launch.livemode
                      ? plan + "を選ぶ"
                      : plan + "をSandboxで確認",
                    launch.livemode
                      ? "Choose " + planNames[plan]
                      : "Test " + planNames[plan] + " in Sandbox",
                  )}
                </a>
              ) : (
                <a
                  className="button button-secondary r3-plan-cta"
                  href="/support"
                >
                  {copy(
                    locale,
                    plan === "ENTERPRISE"
                      ? "問い合わせる"
                      : "公開準備中 · 問い合わせる",
                    plan === "ENTERPRISE" ? "Contact" : "Coming soon · Contact",
                  )}
                </a>
              )}
              <div className="r3-plan-conditions">
                {previous && plan !== "ENTERPRISE" && (
                  <p className="price-inherits">
                    {copy(
                      locale,
                      planNames[previous] + "の利用可能な機能を含みます。",
                      "Includes available " +
                        planNames[previous] +
                        " features.",
                    )}
                  </p>
                )}
                <p className="price-usage">
                  {plan === "ENTERPRISE"
                    ? copy(
                        locale,
                        "利用条件は個別にお問い合わせください。",
                        "Contact us to discuss custom usage terms.",
                      )
                    : plan === "SCALE"
                      ? copy(
                          locale,
                          spec.limits.guilds +
                            "サーバーの組織運営 · " +
                            spec.limits.historyDays +
                            "日の集計履歴",
                          spec.limits.guilds +
                            " communities per organization · " +
                            spec.limits.historyDays +
                            " days of aggregate history",
                        )
                      : copy(
                          locale,
                          spec.limits.guilds +
                            "サーバーの登録枠 · " +
                            spec.limits.historyDays +
                            "日の集計履歴",
                          spec.limits.guilds +
                            " server allowance · " +
                            spec.limits.historyDays +
                            " days of aggregate history",
                        )}
                </p>
              </div>
              <div className="r3-plan-features">
                <h3>{copy(locale, "主な機能", "Key features")}</h3>
                {plan === "ENTERPRISE" ? (
                  <p>
                    {copy(
                      locale,
                      "Scaleの利用可能な機能を含みます。",
                      "Includes available Scale features.",
                    )}
                  </p>
                ) : (
                  <ul>
                    {highlights.map((feature) => (
                      <li key={feature} data-highlight-feature={feature}>
                        <span aria-hidden="true">✓</span>
                        {publicFeatureLabel(feature, locale)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <a className="r3-plan-details" href="#feature-comparison-title">
                {copy(locale, "すべての機能を比較", "Compare all features")}
                <span aria-hidden="true"> →</span>
              </a>
            </article>
          );
        })}
      </section>
      <div className="site-section r3-plan-note">
        <p>
          {copy(
            locale,
            "Freeでは、コミュニティに合うプリセットを1つ確認して利用できます。基本的な行動の流れ（Journey）の集計も含みます。各カードは主な機能の抜粋です。",
            "Free lets you confirm and use one matching preset recipe, including a basic Journey summary. Each card shows selected features.",
          )}{" "}
          <a href="#feature-comparison-title">
            {copy(locale, "全機能を比較", "Compare all features")}
          </a>
          {" · "}
          <a href="#plan-limits">
            {copy(locale, "利用上限と条件", "Limits and conditions")}
          </a>
        </p>
      </div>
      <section className="site-section pricing-payment-info">
        <h2>
          {copy(locale, "購入と支払いについて", "Purchases and payments")}
        </h2>
        <p>
          {copy(
            locale,
            "有料プランの購入には、DiscordのServer Owner確認と対象サーバーの選択が必要です。料金表でプランを選択するだけでは支払いは始まりません。",
            "Purchasing a paid plan requires Discord Server Owner verification and a server selection. Selecting a plan here does not start a payment.",
          )}
        </p>
        {canPurchase && (
          <p>
            {copy(
              locale,
              "表示額は通常の月額料金です。適用される割引・税・最終合計は、支払いを確定する前にStripeの決済画面で確認してください。",
              "The displayed price is the standard monthly amount. Review applicable discounts, tax and the final total in the Stripe payment form before confirming payment.",
            )}
          </p>
        )}
        <a href="/billing/manage">
          {copy(locale, "既存の支払いを管理", "Manage existing billing")}
        </a>
      </section>
      <section className="site-section" id="plan-limits">
        <h2>{copy(locale, "通常プランの利用上限", "Standard plan limits")}</h2>
        <p>
          {copy(
            locale,
            "詳細分析は1回の受付につき1回分を予約し、結果の保存成功時に消費します。基本状況の確認、条件プレビュー、保存結果の再表示は消費しません。失敗や取消時の予約は解放します。月次付与はサーバーごと・UTCの暦月単位で、追加枠には別の期限があります。",
            "A detailed analysis reserves one credit on acceptance and consumes it when its result is saved successfully. Basic status, condition previews and saved-result reads use no credits. Failed or cancelled runs release reservations. Monthly allocations are per server and UTC calendar month; extra allocations may have separate expiry dates.",
          )}
        </p>
        <div
          className="pricing-limits"
          tabIndex={0}
          role="region"
          aria-label={copy(
            locale,
            "利用枠の比較。横にスクロールできます。",
            "Allowance comparison. Scroll horizontally.",
          )}
        >
          <table>
            <caption>
              {copy(
                locale,
                "通常プランの上限。招待Beta・追加利用権の条件は利用者画面で確認。",
                "Standard plan limits. Check your account for invitation Beta and additional access conditions.",
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {copy(locale, "項目・単位", "Allowance / unit")}
                </th>
                {plans.map((p) => (
                  <th key={p} scope="col">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  "analysisRunsMonthly",
                  "analysisConcurrency",
                  "guilds",
                  "historyDays",
                  "monthlyObservedMembers",
                  "teamSeats",
                  "apiRequestsMonthly",
                ] as const
              ).map((key) => (
                <tr key={key} data-limit-id={key}>
                  <th scope="row">
                    {key === "monthlyObservedMembers"
                      ? copy(
                          locale,
                          "月間の集計対象人数（目安）",
                          "Members per month (guideline)",
                        )
                      : limitCopy[key][language]}
                  </th>
                  {plans.map((p) => (
                    <td key={p}>
                      {planRegistry[p].limits[key] ??
                        copy(locale, "個別契約", "Custom contract")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          {copy(
            locale,
            "期間比較には比較機能の利用権と、両期間を含む履歴日数が必要です。指標の定義・対象範囲・取得条件が合わなければ比較できません。集計履歴の表示範囲と、個人データの保持・削除設定は別です。Liveと追加回数パックは現在提供していません。",
            "Period comparisons require comparison access and enough history for both periods. Definitions, scope and coverage must be compatible. Aggregate history visibility is separate from personal-data retention and deletion. Live and extra analysis packs are not currently offered.",
          )}
        </p>
      </section>
      <section className="site-section comparison-section">
        <h2>
          {copy(
            locale,
            "運営で使う機能を確認する。",
            "Compare features for your community workflows.",
          )}
        </h2>
        <ul>
          {[
            [
              "Reply：未返信の新規メンバーを確認し、Growthでリマインダーを自動化。",
              "Replies: see unanswered newcomers; automate reminders with Growth.",
            ],
            [
              "Support Forum：最初の応答を観測し、Starterで応答分布、Growthでスタッフチャンネルやロールへ通知。",
              "Support Forums: observe first responses; inspect distributions with Starter and route alerts with Growth.",
            ],
            [
              "LFG：募集→応答→Voice同席のJourneyをStarterで確認。",
              "LFG: follow post → response → Voice co-presence Journeys with Starter.",
            ],
            [
              "Creator：Reaction・Poll参加を観測し、Starterで期間を比較。",
              "Creators: observe Reaction and Poll participation; compare periods with Starter.",
            ],
            [
              "Voice：条件を満たす同席を観測し、Starterで繰り返しの参加を比較。",
              "Voice: observe qualified co-presence; compare repeat participation with Starter.",
            ],
            [
              "Event：参加登録と観測できる出席を分け、StarterでJourneyを確認。",
              "Events: distinguish signup and observable attendance; inspect Journeys with Starter.",
            ],
          ].map(([ja, en]) => (
            <li key={en}>{copy(locale, ja, en)}</li>
          ))}
        </ul>
      </section>
      <FeatureComparison locale={locale} />
      <PricingFaq
        locale={locale}
        purchaseMode={
          canPurchase ? (launch.livemode ? "live" : "sandbox") : "closed"
        }
      />
    </SiteShell>
  );
}
