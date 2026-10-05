import {
  canonicalFeatures,
  featureAvailability,
  planCurrency,
  planRegistry,
  plans,
} from "../../../../packages/settings/src/plan-registry";
import {
  featureCopy,
  planCopy,
} from "../../../../packages/settings/src/plan-copy";
import { SiteShell, copy, siteLocale } from "../public-ui";
import { installUrl } from "../auth/session";
import { publicBillingCatalog } from "../billing/catalog";
export const dynamic="force-dynamic";
export default async function Pricing() {
  const locale = await siteLocale(),
    language = locale === "ja" ? 0 : 1,
    add = installUrl();
  const {launch,offerings}=await publicBillingCatalog();
  const availableFeatures = canonicalFeatures.filter(
    (feature) => featureAvailability[feature] === "available",
  );
  const publicPlanCopy = {
    ...planCopy,
    STARTER: {
      ...planCopy.STARTER,
      purpose: ["参加の流れが、なぜ・どこで止まるかを理解する。", "See why and where community flow breaks."],
    },
    GROWTH: {
      ...planCopy.GROWTH,
      purpose: ["発見を、繰り返し実行できる運営と改善につなげる。", "Turn findings into recurring operations."],
    },
    SCALE: {
      heading: ["履歴と運用の範囲を広げる", "Extend history and operations"],
      purpose: ["チーム運営・自動化は準備中。現在は履歴・運用上限をSandboxで検証。", "Team & Automate is planned. Test history and operational limits in Sandbox; multi-community and team features are planned."],
    },
    ENTERPRISE: {
      heading: ["利用条件を相談する", "Discuss your usage requirements"],
      purpose: ["個別の利用条件", "Custom usage terms"],
    },
  };
  return (
    <SiteShell locale={locale}>
      <section className="site-section pricing-intro">
        <p className="site-eyebrow">PLANS</p>
        <h1>
          {copy(
            locale,
            "Discordの運営に合うプランを選ぶ。",
            "Choose a plan for Discord community operations.",
          )}
        </h1>
        <p>
          {copy(
            locale,
            "Reply、Thread、Forum、Reaction、Poll、Voice、Event。どの場所を使うサーバーでも、基本観測と測定根拠はFreeから。必要になったら、履歴・分析・運営を深められます。",
            "Replies, Threads, Forums, Reactions, Polls, Voice and Events. Free includes core observation and evidence for every community. Add deeper history, analysis and operations as you need them.",
          )}
        </p>
        <span className="badge badge-violet">
          {copy(
            locale,
            launch.checkoutEnabled?(launch.livemode?"USD月額プラン":"Sandbox検証 · 暫定USD価格 · 実際の請求はありません"):"有料決済は準備中。価格は承認後に公開。",
            launch.checkoutEnabled?(launch.livemode?"Monthly USD plans":"Sandbox testing · Provisional USD prices · No real-money charge"):"Paid checkout is being prepared. Prices await approval.",
          )}
        </span>
      </section>
      <section
        className="pricing-grid"
        aria-label={copy(locale, "プラン一覧", "Plans")}
      >
        {plans.map((plan, index) => {
          const spec = planRegistry[plan],
            previous = index ? planRegistry[plans[index - 1]!] : null;
          const offering=offerings.find(o=>o.plan_key===plan);
          const additional = availableFeatures.filter(
            (feature) =>
              spec.features.includes(feature) &&
              (!previous || !previous.features.includes(feature)),
          );
          const available = additional.length
            ? additional
            : availableFeatures.filter(
                (feature) =>
                  spec.features.includes(feature) &&
                  [
                    "custom_recipe",
                    "attention_automation",
                    "improvement_tracking",
                    "csv_export",
                  ].includes(feature),
              );
          return (
            <article className="price-card" key={plan}>
              <p className="site-eyebrow">{plan}</p>
              <h2>{publicPlanCopy[plan].heading[language]}</h2>
              <p className="price-description">
                {publicPlanCopy[plan].purpose[language]}
              </p>
              <div className="price">
                {!launch.publishPrices ? (
                  copy(
                    locale,
                    plan === "FREE" ? "無料" : "お問い合わせ",
                    plan === "FREE" ? "Free" : "Contact us",
                  )
                ) : spec.price === null ? (
                  copy(locale, "個別契約", "Custom contract")
                ) : (
                  <>
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: offering?.currency ?? planCurrency,
                      maximumFractionDigits: 0,
                    }).format(offering?offering.final_price_minor/100:spec.price)}
                    <small>/{copy(locale, "月", "month")}</small>
                  </>
                )}
              </div>
              {previous && (
                <p className="price-inherits">
                  {copy(
                    locale,
                    `${previous.id}の利用可能な機能を含みます。`,
                    `Includes available ${previous.id} features.`,
                  )}
                </p>
              )}
              <h3>{copy(locale, "現在利用可能", "Available features")}</h3>
              <ul>
                {available.map((feature) => (
                  <li key={feature}>✓ {featureCopy[feature][language]}</li>
                ))}
              </ul>
              {plan === "FREE" && (
                <p>
                  {copy(
                    locale,
                    "コミュニティに合うプリセットを1つ確認して利用。基本Journeyも含みます。",
                    "Confirm one matching preset recipe, with a basic Journey summary.",
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
                        `${spec.limits.historyDays}日の集計履歴`,
                        `${spec.limits.historyDays} days of aggregate history`,
                      )
                    : copy(
                        locale,
                        `${spec.limits.guilds}サーバーの登録枠 · ${spec.limits.historyDays}日の集計履歴`,
                        `${spec.limits.guilds} server allowance · ${spec.limits.historyDays} days of aggregate history`,
                      )}
              </p>
              {plan === "FREE" && add ? (
                <a className="button button-discord" href={add}>
                  {copy(locale, "Discordに追加", "Add to Discord")}
                </a>
              ) : offering && launch.checkoutEnabled ? (
                <a className="button button-primary" href={`/billing/manage?offering=${offering.id}`}>{copy(locale,`${plan}を選ぶ`,`Choose ${plan[0]}${plan.slice(1).toLowerCase()}`)}</a>
              ) : (
                <a className="button button-secondary" href="/support">
                  {copy(
                    locale,
                    plan==="ENTERPRISE"?"問い合わせる":"公開準備中 · 問い合わせる",
                    plan==="ENTERPRISE"?"Contact":"Coming soon · Contact",
                  )}
                </a>
              )}
            </article>
          );
        })}
      </section>
      <section className="site-section comparison-section">
        <p className="site-eyebrow">COMMUNITY WORKFLOWS</p>
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
      <section className="site-section comparison-section">
        <h2>{copy(locale, "機能を比較する", "Compare features")}</h2>
        <p className="comparison-hint">
          {copy(
            locale,
            "横にスクロールして比較できます。",
            "Swipe horizontally to compare.",
          )}
        </p>
        <div className="comparison-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{copy(locale, "機能", "Feature")}</th>
                {plans.map((plan) => (
                  <th scope="col" key={plan}>
                    {plan}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availableFeatures.map((feature) => (
                <tr key={feature}>
                  <th scope="row">{featureCopy[feature][language]}</th>
                  {plans.map((plan) => (
                    <td key={plan}>
                      {planRegistry[plan].features.includes(feature)
                        ? "✓"
                        : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="site-section faq">
        <h2>{copy(locale, "利用枠と測定について", "Usage and measurement")}</h2>
        <details>
          <summary>
            {copy(
              locale,
              "月間観測人数とは？",
              "What is a monthly observed member?",
            )}
          </summary>
          <p>
            {copy(
              locale,
              "活動を観測したメンバーを各サーバーで月1回数えます。現在は運用上の目安で、自動課金や観測の停止は行いません。",
              "Members with observed activity count once per server per month. This is a soft operational allowance, without automatic charges or dropped measurement.",
            )}
          </p>
          <p>
            {plans
              .map(
                (plan) =>
                  `${plan}: ${planRegistry[plan].included?.toLocaleString() ?? copy(locale, "個別", "Custom")}`,
              )
              .join(" · ")}
          </p>
        </details>
        <details>
          <summary>
            {copy(
              locale,
              "有料プランで測定の正確さは変わりますか？",
              "Does payment change measurement correctness?",
            )}
          </summary>
          <p>
            {copy(
              locale,
              "測定根拠、UNKNOWN・PARTIAL、観測範囲、接続障害、プライバシーと削除は全プラン共通です。Voice同席は会話の証明ではなく、絵文字から感情を推測せず、外部イベントの出席は観測できません。",
              "Evidence, UNKNOWN/PARTIAL states, coverage, integration warnings, privacy and deletion are included in every plan. Voice co-presence does not prove conversation. Emoji do not imply sentiment. External Event attendance is unobservable.",
            )}
          </p>
        </details>
        <details>
          <summary>
            {copy(locale, "履歴とダウングレード", "History and downgrades")}
          </summary>
          <p>
            {copy(
              locale,
              "有料期間の終了後は下位プランの表示範囲になります。上位の集計履歴は原則30日の復旧期間を設けます。メンバーに紐づく詳細データのプライバシー保持設定は別に適用されます。",
              "Lower-plan visibility applies after the paid period ends. Higher-plan aggregate history has a default 30-day recovery period. Member-linked detail follows separate privacy retention settings.",
            )}
          </p>
        </details>
        <details>
          <summary>
            {copy(locale, "今すぐ購入できますか？", "Can I buy now?")}
          </summary>
          <p>
            {copy(
              locale,
              launch.checkoutEnabled?(launch.livemode?"プランは決済側の契約を確認した後に反映されます。":"Sandboxではテスト購入できます。プランは決済側の契約を確認した後に反映されます。"):"決済は現在準備中です。問い合わせやリンクのクリックだけでは購入やプラン変更は完了しません。",
              launch.checkoutEnabled?(launch.livemode?"A plan activates after authoritative subscription confirmation.":"Test purchases are available in Sandbox. A plan activates after authoritative subscription confirmation."):"Checkout is currently unconfigured. Contacting support or clicking a link does not purchase or activate a plan.",
            )}
          </p>
        </details>
      </section>
    </SiteShell>
  );
}
