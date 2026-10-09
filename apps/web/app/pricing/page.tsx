import { BetaNotice } from "../landing/beta-notice";
import { limitCopy } from "../../../../packages/settings/src/plan-copy";
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
import { publicBillingCatalog } from "../billing/catalog";
export const dynamic = "force-dynamic";
export default async function Pricing() {
  const locale = await siteLocale(),
    language = locale === "ja" ? 0 : 1;
  const { launch, offerings } = await publicBillingCatalog();
  const availableFeatures = canonicalFeatures.filter(
    (feature) => featureAvailability[feature] === "available",
  );
  const publicPlanCopy = {
    ...planCopy,
    STARTER: {
      ...planCopy.STARTER,
      purpose: [
        "参加の流れで、活動を確認できる段階と不足を調べる。",
        "Review observed stages and gaps in community participation.",
      ],
    },
    GROWTH: {
      ...planCopy.GROWTH,
      purpose: [
        "発見を、繰り返し実行できる運営と改善につなげる。",
        "Turn findings into recurring operations.",
      ],
    },
    SCALE: {
      ...planCopy.SCALE,
      purpose: [
        "複数のコミュニティを、チームと承認ルールで運営する。",
        "Operate multiple communities as a team, with approval rules.",
      ],
    },
    ENTERPRISE: {
      heading: ["利用条件を相談する", "Discuss your usage requirements"],
      purpose: ["個別の利用条件", "Custom usage terms"],
    },
  };
  return (
    <SiteShell locale={locale}>
      <BetaNotice locale={locale} />
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
            "返信、スレッド、フォーラム、リアクション、投票、ボイス、イベント。どの場所を使うサーバーでも、基本観測と測定根拠はFreeから。必要になったら、履歴・分析・運営を深められます。",
            "Replies, Threads, Forums, Reactions, Polls, Voice and Events. Free includes core observation and evidence for every community. Add deeper history, analysis and operations as you need them.",
          )}
        </p>
        <span className="badge badge-violet">
          {copy(
            locale,
            launch.checkoutEnabled
              ? launch.livemode
                ? "USD月額プラン"
                : "Sandbox検証 · 暫定USD価格 · 実際の請求はありません"
              : "有料決済は準備中。価格は承認後に公開。",
            launch.checkoutEnabled
              ? launch.livemode
                ? "Monthly USD plans"
                : "Sandbox testing · Provisional USD prices · No real-money charge"
              : "Paid checkout is being prepared. Prices await approval.",
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
          const offering = offerings.find((o) => o.plan_key === plan);
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
                    }).format(
                      offering ? offering.final_price_minor / 100 : spec.price,
                    )}
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
              <h3>
                {copy(
                  locale,
                  "通常プランに含まれる実装済み機能",
                  "Implemented features in this standard plan",
                )}
              </h3>
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
                        `${spec.limits.guilds}サーバーの組織運営 · ${spec.limits.historyDays}日の集計履歴`,
                        `${spec.limits.guilds} communities per organization · ${spec.limits.historyDays} days of aggregate history`,
                      )
                    : copy(
                        locale,
                        `${spec.limits.guilds}サーバーの登録枠 · ${spec.limits.historyDays}日の集計履歴`,
                        `${spec.limits.guilds} server allowance · ${spec.limits.historyDays} days of aggregate history`,
                      )}
              </p>
              {plan === "FREE" ? (
                <a className="button button-primary" href="/support">
                  {copy(locale, "招待Betaの参加案内", "Invitation Beta access")}
                </a>
              ) : offering && launch.checkoutEnabled ? (
                <a
                  className="button button-primary"
                  href={`/checkout?offering=${offering.id}`}
                >
                  {copy(
                    locale,
                    `${plan}を選ぶ`,
                    `Choose ${plan[0]}${plan.slice(1).toLowerCase()}`,
                  )}
                </a>
              ) : (
                <a className="button button-secondary" href="/support">
                  {copy(
                    locale,
                    plan === "ENTERPRISE"
                      ? "問い合わせる"
                      : "公開準備中 · 問い合わせる",
                    plan === "ENTERPRISE" ? "Contact" : "Coming soon · Contact",
                  )}
                </a>
              )}
            </article>
          );
        })}
      </section>
      <section className="site-section">
        <h2>
          {copy(
            locale,
            "通常プランの利用枠と条件",
            "Standard plan allowances and conditions",
          )}
        </h2>
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
                  "teamSeats",
                  "apiRequestsMonthly",
                ] as const
              ).map((key) => (
                <tr key={key}>
                  <th scope="row">{limitCopy[key][language]}</th>
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
        <div
          className="comparison-scroll"
          tabIndex={0}
          role="region"
          aria-label={copy(
            locale,
            "機能比較表。横にスクロールできます。",
            "Feature comparison. Scroll horizontally.",
          )}
        >
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
              launch.checkoutEnabled
                ? launch.livemode
                  ? "プランは決済側の契約を確認した後に反映されます。"
                  : "Sandboxではテスト購入できます。プランは決済側の契約を確認した後に反映されます。"
                : "決済は現在準備中です。問い合わせやリンクのクリックだけでは購入やプラン変更は完了しません。",
              launch.checkoutEnabled
                ? launch.livemode
                  ? "A plan activates after authoritative subscription confirmation."
                  : "Test purchases are available in Sandbox. A plan activates after authoritative subscription confirmation."
                : "Checkout is currently unconfigured. Contacting support or clicking a link does not purchase or activate a plan.",
            )}
          </p>
        </details>
      </section>
    </SiteShell>
  );
}
