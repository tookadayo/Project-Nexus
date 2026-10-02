import {
  canonicalFeatures,
  featureAvailability,
  planCurrency,
  pricingMetadata,
  planRegistry,
  plans,
} from "../../../../packages/settings/src/plan-registry";
import {
  featureCopy,
  planCopy,
} from "../../../../packages/settings/src/plan-copy";
import { SiteShell, copy, siteLocale } from "../public-ui";
import { installUrl } from "../auth/session";
export default async function Pricing() {
  const locale = await siteLocale(),
    language = locale === "ja" ? 0 : 1,
    add = installUrl();
  return (
    <SiteShell locale={locale}>
      <section className="site-section pricing-intro">
        <p className="site-eyebrow">PLANS</p>
        <h1>
          {copy(
            locale,
            "コミュニティの形は、無料で観測。",
            "Observe your community’s shape for free.",
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
            "有料決済は準備中。価格は承認後に公開。",
            "Paid checkout is being prepared. Prices await approval.",
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
          const available = canonicalFeatures.filter(
            (feature) =>
              featureAvailability[feature] === "available" &&
              spec.features.includes(feature) &&
              (!previous || !previous.features.includes(feature)),
          );
          const planned = canonicalFeatures.filter(
            (feature) =>
              featureAvailability[feature] === "planned" &&
              spec.features.includes(feature),
          );
          return (
            <article className="price-card" key={plan}>
              <p className="site-eyebrow">{plan}</p>
              <h2>{planCopy[plan].heading[language]}</h2>
              <p className="price-description">
                {planCopy[plan].purpose[language]}
              </p>
              <div className="price">
                {!pricingMetadata.publishPrices ? (
                  copy(
                    locale,
                    plan === "FREE" ? "無料で始める" : "お問い合わせ",
                    plan === "FREE" ? "Start free" : "Contact us",
                  )
                ) : spec.price === null ? (
                  copy(locale, "個別契約", "Custom contract")
                ) : (
                  <>
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: planCurrency,
                      maximumFractionDigits: 0,
                    }).format(spec.price)}
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
                      "サーバー数・保持期間・運用上限は個別契約。",
                      "Guild allowance, retention and operational limits by contract.",
                    )
                  : copy(
                      locale,
                      `${spec.limits.guilds}サーバーの登録枠 · ${spec.limits.historyDays}日の集計履歴`,
                      `${spec.limits.guilds} server allowance · ${spec.limits.historyDays} days of aggregate history`,
                    )}
              </p>
              {planned.length > 0 && (
                <details>
                  <summary>
                    {copy(locale, "準備中の機能", "Planned features")}
                  </summary>
                  <ul className="planned-features">
                    {planned.map((feature) => (
                      <li key={feature}>○ {featureCopy[feature][language]}</li>
                    ))}
                  </ul>
                </details>
              )}
              {plan === "SCALE" && (
                <p className="pricing-note">
                  {copy(
                    locale,
                    "5サーバーの枠を定義しています。一括管理・枠の割当・RBAC・API・監査出力は準備中です。",
                    "The catalog defines five slots. Multi-server management, slot assignment, RBAC, API and audit export are planned.",
                  )}
                </p>
              )}
              {plan === "FREE" && add ? (
                <a className="button button-discord" href={add}>
                  {copy(locale, "Discordに追加", "Add to Discord")}
                </a>
              ) : (
                <a className="button button-secondary" href="/support">
                  {copy(
                    locale,
                    "利用について問い合わせる",
                    "Ask about availability",
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
            "いつもの運営を、もう一歩。",
            "Go further with your everyday workflows.",
          )}
        </h2>
        <ul>
          {[
            [
              "Reply：未返信の新規メンバーを確認し、Growthでリマインダーを自動化。",
              "Replies: see unanswered newcomers; automate reminders with Growth.",
            ],
            [
              "Support Forum：最初の応答を観測し、Starterで応答分布、Growthで担当者に通知。",
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
              {canonicalFeatures.map((feature) => (
                <tr key={feature}>
                  <th scope="row">{featureCopy[feature][language]}</th>
                  {plans.map((plan) => (
                    <td key={plan}>
                      {planRegistry[plan].features.includes(feature)
                        ? featureAvailability[feature] === "planned"
                          ? copy(locale, "準備中", "Planned")
                          : "✓"
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
              "決済は現在準備中です。問い合わせやリンクのクリックだけでは購入やプラン変更は完了しません。",
              "Checkout is currently unconfigured. Contacting support or clicking a link does not purchase or activate a plan.",
            )}
          </p>
        </details>
      </section>
    </SiteShell>
  );
}
