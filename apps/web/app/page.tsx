import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { webOrigin } from "../../../packages/config/src/web-origin";
import { installUrl } from "./auth/session";
import { siteLocale } from "./public-ui";
import { faqs, text, type Locale } from "./landing/content";
import { Navigation } from "./landing/navigation";
import { Brand, Icon } from "./landing/primitives";
import { ProductPreview } from "./landing/product-preview";
import "./landing/landing.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--nx-font-sans",
  display: "swap",
});
const repository = "https://github.com/tookadayo/Project-Nexus";

function HeadingCopy({
  locale,
  en,
  ja,
}: {
  locale: Locale;
  en: string;
  ja: string[];
}) {
  return locale === "en"
    ? en
    : ja.map((phrase) => (
        <span className="nx-heading-phrase" key={phrase}>
          {phrase}
        </span>
      ));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await siteLocale();
  const request = await headers();
  const origin = webOrigin({ headers: request });
  const title = text(
    locale,
    "NEXUS — Discord community operations",
    "NEXUS — Discordの新規メンバー対応と活動を確認",
  );
  const description = text(
    locale,
    "Track newcomer activity, find unanswered posts, and review measurement evidence in Discord and Web.",
    "新規メンバーの活動、返信待ちの投稿、測定の根拠をDiscordとWebで確認するコミュニティ運営ツール。",
  );
  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description,
      url: "/",
      siteName: "Project Nexus",
      type: "website",
      locale: locale === "ja" ? "ja_JP" : "en_US",
      images: [
        {
          url: "/nexus/social-preview.png",
          width: 1200,
          height: 630,
          alt: "NEXUS — Discord community operations",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/nexus/social-preview.png"],
    },
    icons: { icon: "/nexus/mark.svg" },
  };
}

function Cta({
  locale,
  add,
  secondary = true,
}: {
  locale: Locale;
  add: string | null;
  secondary?: boolean;
}) {
  return (
    <div className="nx-cta-row">
      <a className="nx-button nx-button-primary" href={add ?? "/support"}>
        {add
          ? text(locale, "Add to Discord", "Discordに追加")
          : text(locale, "Ask about installation", "導入について問い合わせる")}
        <Icon name={add ? "external" : "arrow"} size={18} />
      </a>
      {secondary && (
        <a className="nx-button nx-button-outline" href="/product">
          {text(locale, "Explore the product", "製品を詳しく見る")}
          <Icon name="arrow" size={18} />
        </a>
      )}
    </div>
  );
}

export default async function Home() {
  const locale = await siteLocale(),
    add = installUrl();
  return (
    <div className={`nexus-site ${geist.variable}`} lang={locale} id="top">
      <a className="nx-skip-link" href="#main-content">
        {text(locale, "Skip to content", "本文へスキップ")}
      </a>
      <Navigation locale={locale} />
      <main id="main-content">
        <section
          className="nx-hero nx-container"
          aria-labelledby="hero-heading"
        >
          <div className="nx-hero-copy">
            <p className="nx-eyebrow">
              <span className="nx-dot" />
              DISCORD COMMUNITY OPERATIONS
            </p>
            <h1 id="hero-heading">
              <HeadingCopy
                locale={locale}
                en="Know where newcomers need a reply."
                ja={["新しいメンバーの", "返信待ちを", "見つける。"]}
              />
            </h1>
            <p className="nx-lead">
              {text(
                locale,
                "NEXUS helps Discord community teams track newcomer activity, find unanswered posts, and follow up with confidence in the data.",
                "NEXUSはDiscordコミュニティの運営ツールです。新規メンバーの活動と返信状況を確認し、対応が必要な投稿を整理できます。",
              )}
            </p>
            <Cta locale={locale} add={add} />
            <p className="nx-availability">
              {text(
                locale,
                "Alpha release · Ask about availability for your server",
                "アルファ版 · サーバーでの利用はお問い合わせください",
              )}
            </p>
          </div>
          <ProductPreview locale={locale} />
        </section>

        <div className="nx-surface-strip nx-container">
          <p>
            {text(
              locale,
              "Observe activity across Discord",
              "Discordのさまざまな活動を観測",
            )}
          </p>
          <ul
            aria-label={text(
              locale,
              "Observed Discord activity",
              "観測できるDiscordの活動",
            )}
          >
            {[
              "Reply",
              "Thread",
              "Forum",
              "Reaction",
              "Poll",
              "Voice",
              "Event",
            ].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <section
          id="features"
          className="nx-section nx-container"
          aria-labelledby="features-heading"
        >
          <div className="nx-section-heading">
            <p className="nx-eyebrow">{text(locale, "PRODUCT", "製品")}</p>
            <h2 id="features-heading">
              <HeadingCopy
                locale={locale}
                en="A clearer view of your community’s daily work."
                ja={["日々の運営に、", "確認できる事実を。"]}
              />
            </h2>
            <p>
              {text(
                locale,
                "See who is getting started, which posts need attention, and how much the data can tell you.",
                "新規メンバーの活動、対応が必要な投稿、データから判断できる範囲を確認します。",
              )}
            </p>
          </div>
          <article className="nx-feature-row">
            <div className="nx-feature-copy">
              <span className="nx-feature-icon">
                <Icon name="activity" />
              </span>
              <h3>
                <HeadingCopy
                  locale={locale}
                  en="See how newcomers get started"
                  ja={["参加後の活動と", "最初の交流を確認"]}
                />
              </h3>
              <p>
                {text(
                  locale,
                  "Separate joining, first activity, human connection and later activity. Review the observed stages in Discord or dig into the details on Web.",
                  "参加、最初の活動、他の人との交流、参加後の活動を分けて表示します。Discordで状況を確認し、Webで詳しく見ることができます。",
                )}
              </p>
              <a className="nx-text-link" href="/product">
                {text(
                  locale,
                  "Explore newcomer observation",
                  "新規メンバーの観測を見る",
                )}
                <Icon name="arrow" size={17} />
              </a>
            </div>
            <div className="nx-feature-visual nx-journey-preview">
              <div className="nx-visual-header">
                <Icon name="flow" size={18} />
                <strong>
                  {text(locale, "Newcomer Journey", "新規メンバーのJourney")}
                </strong>
                <span>{text(locale, "Example data", "サンプルデータ")}</span>
              </div>
              <ol>
                {[
                  ["Joined", "参加", "38"],
                  ["First activity", "最初の活動", "32"],
                  ["First connection", "最初の交流", "28"],
                  ["Later activity", "参加後の活動", "21"],
                ].map(([en, ja, count]) => (
                  <li key={en}>
                    <span className="nx-journey-line" aria-hidden="true" />
                    <span>{text(locale, en, ja)}</span>
                    <div className="nx-journey-bar" aria-hidden="true">
                      <i style={{ width: `${(Number(count) / 38) * 100}%` }} />
                    </div>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ol>
              <p>
                {text(
                  locale,
                  "Illustrative cohort · stages use their own observation windows",
                  "説明用の対象者データ · 段階ごとに観測期間が異なります",
                )}
              </p>
            </div>
          </article>
          <article className="nx-feature-row nx-feature-reverse">
            <div className="nx-feature-copy">
              <span className="nx-feature-icon">
                <Icon name="message" />
              </span>
              <h3>
                <HeadingCopy
                  locale={locale}
                  en="Keep unanswered posts in view"
                  ja={["返信待ちの投稿を、", "対応一覧へ"]}
                />
              </h3>
              <p>
                {text(
                  locale,
                  "Find newcomer posts without a direct reply after your configured delay. Open the original post, mark it checked, snooze it or resolve it so follow-up stays organized.",
                  "設定した時間を過ぎても直接返信が確認できない投稿をまとめます。元の投稿を開き、確認済み・後で再確認・対応済みを区別して整理できます。",
                )}
              </p>
              <a className="nx-text-link" href="/product">
                {text(locale, "See attention workflows", "対応の流れを見る")}
                <Icon name="arrow" size={17} />
              </a>
            </div>
            <div className="nx-feature-visual nx-attention-preview">
              <div className="nx-visual-header">
                <Icon name="message" size={18} />
                <strong>{text(locale, "Attention queue", "対応一覧")}</strong>
                <span>{text(locale, "Example data", "サンプルデータ")}</span>
              </div>
              <div className="nx-attention-post">
                <span className="nx-status-amber">
                  {text(locale, "Needs attention", "対応が必要")}
                </span>
                <h4>#introductions</h4>
                <p>
                  {text(
                    locale,
                    "No direct reply observed · Waiting 45 min",
                    "直接返信は未確認 · 待ち時間45分",
                  )}
                </p>
              </div>
              <ul
                className="nx-action-labels"
                aria-label={text(
                  locale,
                  "Available in-app actions",
                  "アプリで利用できる操作",
                )}
              >
                <li>
                  <Icon name="check" size={15} />
                  {text(locale, "Acknowledge", "確認済み")}
                </li>
                <li>
                  <Icon name="clock" size={15} />
                  {text(locale, "Snooze", "後で再確認")}
                </li>
                <li>{text(locale, "Resolve", "対応済み")}</li>
              </ul>
              <p className="nx-visual-note">
                {text(
                  locale,
                  "Actions are performed in the app, after reviewing the post.",
                  "投稿を確認したうえで、アプリ内で操作します。",
                )}
              </p>
            </div>
          </article>
          <article className="nx-feature-row">
            <div className="nx-feature-copy">
              <span className="nx-feature-icon">
                <Icon name="chart" />
              </span>
              <h3>
                <HeadingCopy
                  locale={locale}
                  en="Read results with their evidence"
                  ja={["数字と一緒に、", "測定の根拠を確認"]}
                />
              </h3>
              <p>
                {text(
                  locale,
                  "Check the observation period, sample and measurement rules. Incomplete observations and small samples stay visible, so a missing result is never presented as zero.",
                  "対象期間、観測人数、測定ルールを確認できます。観測途中、人数不足、取得できない状態を区別し、結果がない場合をゼロとして扱いません。",
                )}
              </p>
              <a className="nx-text-link" href="/product">
                {text(locale, "Understand measurement", "測定方法を見る")}
                <Icon name="arrow" size={17} />
              </a>
            </div>
            <div className="nx-feature-visual nx-evidence-preview">
              <div className="nx-visual-header">
                <Icon name="layers" size={18} />
                <strong>
                  {text(locale, "Measurement evidence", "測定根拠")}
                </strong>
                <span>{text(locale, "Example", "表示例")}</span>
              </div>
              <dl>
                <div>
                  <dt>{text(locale, "Observation period", "観測期間")}</dt>
                  <dd>{text(locale, "Last 7 days", "直近7日")}</dd>
                </div>
                <div>
                  <dt>{text(locale, "Sample", "対象人数")}</dt>
                  <dd>
                    {text(
                      locale,
                      "38 eligible newcomers",
                      "対象の新規メンバー38人",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{text(locale, "Still collecting", "観測途中")}</dt>
                  <dd>
                    {text(
                      locale,
                      "Result not yet available",
                      "結果はまだ表示できません",
                    )}
                  </dd>
                </div>
              </dl>
              <p className="nx-visual-note">
                {text(
                  locale,
                  "Adjust measurement rules to your community’s purpose.",
                  "サーバーの目的に合わせて測定ルールを設定できます。",
                )}
              </p>
            </div>
          </article>
        </section>

        <section
          id="how-it-works"
          className="nx-tinted-section nx-section"
          aria-labelledby="setup-heading"
        >
          <div className="nx-container">
            <div className="nx-section-heading">
              <p className="nx-eyebrow">
                {text(locale, "HOW IT WORKS", "使い方")}
              </p>
              <h2 id="setup-heading">
                {text(
                  locale,
                  "Set up for the way your server works.",
                  "サーバーの運営に合わせて設定。",
                )}
              </h2>
            </div>
            <ol className="nx-setup-steps">
              {[
                [
                  "Connect your server",
                  "サーバーを接続",
                  "Add the bot and open /nexus panel in a staff channel. Use Web for detailed setup and analysis.",
                  "Botを追加し、スタッフ用チャンネルで /nexus panel を開きます。詳しい設定と分析にはWebを使います。",
                ],
                [
                  "Confirm what to measure",
                  "測定内容を確認",
                  "Choose your community’s purpose and confirm the channel uses, measurement preset and observation scope.",
                  "運営目的を選び、チャンネルの用途、測定プリセット、観測範囲を確認します。",
                ],
                [
                  "Review and follow up",
                  "確認して対応",
                  "Check the activity and attention queue. Review measurement evidence as you consider changes.",
                  "活動と対応一覧を確認します。運営を見直す際には、測定の根拠も確認できます。",
                ],
              ].map(([en, ja, bodyEn, bodyJa], i) => (
                <li key={en}>
                  <span className="nx-step-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{text(locale, en, ja)}</h3>
                  <p>{text(locale, bodyEn, bodyJa)}</p>
                </li>
              ))}
            </ol>
            <a
              className="nx-text-link"
              href={`${repository}#development-self-host`}
            >
              {text(
                locale,
                "Read self-host setup instructions",
                "セルフホストの導入手順を見る",
              )}
              <Icon name="external" size={16} />
            </a>
          </div>
        </section>

        <section
          id="privacy"
          className="nx-section nx-container nx-privacy-section"
          aria-labelledby="privacy-heading"
        >
          <div className="nx-section-heading">
            <p className="nx-eyebrow">
              {text(locale, "PRIVACY & CONTROL", "プライバシーと管理")}
            </p>
            <h2 id="privacy-heading">
              {text(
                locale,
                "Observe activity. Keep message contents private.",
                "活動を観測。本文や音声は保存しません。",
              )}
            </h2>
            <p>
              {text(
                locale,
                "NEXUS measures community activity using the metadata it needs, with explicit retention and access controls.",
                "測定に必要なメタデータを使い、保持期間とアクセスを管理します。",
              )}
            </p>
            <a className="nx-text-link" href="/privacy">
              {text(
                locale,
                "Read the privacy policy",
                "プライバシー方針を見る",
              )}
              <Icon name="arrow" size={17} />
            </a>
          </div>
          <ul className="nx-privacy-list">
            {(
              [
                [
                  "message",
                  "No message or Voice content stored",
                  "本文・添付・DM内容・Voice音声を保存しない",
                  "Activity types, times and required metadata support measurement.",
                  "活動の種類、時刻、必要なメタデータで測定します。",
                ],
                [
                  "clock",
                  "Manage retention and deletion",
                  "保持期間と削除を管理",
                  "Configure detail and aggregate retention, and request deletion through /nexus privacy.",
                  "詳細・集計データの保持期間を設定し、/nexus privacy から削除を申請できます。",
                ],
                [
                  "shield",
                  "Check current server permissions",
                  "現在のサーバー権限を確認",
                  "Web access is checked against your current Discord and NEXUS management permissions.",
                  "現在のDiscord・NEXUS管理権限に基づいてWebアクセスを確認します。",
                ],
              ] as const
            ).map(([icon, en, ja, bodyEn, bodyJa]) => (
              <li key={en}>
                <Icon name={icon} size={23} />
                <div>
                  <h3>{text(locale, en, ja)}</h3>
                  <p>{text(locale, bodyEn, bodyJa)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="nx-plan-note nx-container"
          aria-labelledby="plans-heading"
        >
          <div>
            <p className="nx-eyebrow">{text(locale, "PLANS", "プラン")}</p>
            <h2 id="plans-heading">
              {text(
                locale,
                "Core observation starts with Free.",
                "基本の観測はFreeから。",
              )}
            </h2>
            <p>
              {text(
                locale,
                "Compare the implemented observation, analysis and operational features. Paid checkout is not configured; paid prices are not published.",
                "実装済みの観測・分析・運営機能を比較できます。有料決済は未設定で、有料価格は公開していません。",
              )}
            </p>
          </div>
          <a className="nx-button nx-button-outline" href="/pricing">
            {text(locale, "Compare plans", "プランを比較")}
            <Icon name="arrow" size={18} />
          </a>
        </section>

        <section
          className="nx-section nx-container nx-faq"
          aria-labelledby="faq-heading"
        >
          <div className="nx-section-heading">
            <p className="nx-eyebrow">FAQ</p>
            <h2 id="faq-heading">
              <HeadingCopy
                locale={locale}
                en="Questions before you connect?"
                ja={["導入前に", "よくある質問。"]}
              />
            </h2>
          </div>
          <div>
            {faqs.map((faq) => (
              <details key={faq.question[0]}>
                <summary>
                  {text(locale, faq.question[0], faq.question[1])}
                  <Icon name="plus" size={20} />
                </summary>
                <p>{text(locale, faq.answer[0], faq.answer[1])}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="nx-final-cta">
          <div className="nx-container">
            <p className="nx-eyebrow">DISCORD COMMUNITY OPERATIONS</p>
            <h2>
              <HeadingCopy
                locale={locale}
                en="Give newcomer follow-up a clear place to start."
                ja={["新規メンバーへの", "対応を、", "見える場所に。"]}
              />
            </h2>
            <p>
              {text(
                locale,
                "See what NEXUS can observe and discuss availability for your server.",
                "観測できることを確認し、サーバーでの利用についてご相談ください。",
              )}
            </p>
            <Cta locale={locale} add={add} />
          </div>
        </section>
      </main>
      <footer className="nx-footer nx-container">
        <div>
          <a href="/" aria-label={text(locale, "Nexus home", "Nexus ホーム")}>
            <Brand />
          </a>
          <p>
            {text(
              locale,
              "Newcomer activity and follow-up for Discord communities.",
              "Discordコミュニティの新規メンバーの活動と対応を確認。",
            )}
          </p>
          <small>
            {text(
              locale,
              "Project Nexus · Alpha release",
              "Project Nexus · アルファ版",
            )}
          </small>
        </div>
        <nav aria-label={text(locale, "Footer", "フッター")}>
          <div>
            <strong>{text(locale, "Product", "製品")}</strong>
            <a href="/product">{text(locale, "Overview", "製品概要")}</a>
            <a href="/pricing">{text(locale, "Plans", "プラン")}</a>
            <a href="/auth/login">{text(locale, "Log in", "ログイン")}</a>
          </div>
          <div>
            <strong>{text(locale, "Resources", "資料")}</strong>
            <a href="/support">{text(locale, "Support", "サポート")}</a>
            <a href={`${repository}/tree/master/docs`}>
              {text(locale, "Documentation", "ドキュメント")}
            </a>
            <a href={repository}>
              GitHub
              <Icon name="external" size={12} />
            </a>
          </div>
          <div>
            <strong>{text(locale, "Legal", "法務")}</strong>
            <a href="/privacy">{text(locale, "Privacy", "プライバシー")}</a>
            <a href="/terms">{text(locale, "Terms", "利用条件")}</a>
          </div>
        </nav>
      </footer>
    </div>
  );
}
