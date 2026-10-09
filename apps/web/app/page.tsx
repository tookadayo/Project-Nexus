import { HeroExample } from "./landing/hero-example";
import { CommunityWorkflow } from "./landing/workflow";
import { BetaNotice } from "./landing/beta-notice";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { webOrigin } from "../../../packages/config/src/web-origin";
import { SiteFooter, siteLocale } from "./public-ui";
import { faqs, text, type Locale } from "./landing/content";
import { Navigation } from "./landing/navigation";
import { Icon } from "./landing/primitives";
import { ProductPreview } from "./landing/product-preview";
import "./landing/landing.css";
import "./landing/official-refresh.css";

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
    "NEXUS — Discordの活動と返信状況を確認",
  );
  const description = text(
    locale,
    "Review Discord community activity, check reply status in eligible channels, and revisit your team’s records.",
    "Discordコミュニティの活動、対象チャンネルの返信状況、スタッフの対応記録を確認する運営ツール。",
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
    icons: {
      icon: "/nexus/brand/navy-tile.png",
      apple: "/nexus/brand/navy-tile.png",
    },
  };
}

function Cta({
  locale,
  secondary = true,
}: {
  locale: Locale;
  secondary?: boolean;
}) {
  return (
    <div className="nx-cta-row">
      <a className="nx-button nx-button-primary" href="/support">
        {text(locale, "Joining Closed Beta 1", "Closed Beta 1の参加案内")}
        <Icon name="arrow" size={18} />
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
  const locale = await siteLocale();
  return (
    <div
      className={`nexus-site nx-home-r3 ${geist.variable}`}
      lang={locale}
      id="top"
    >
      <a className="nx-skip-link" href="#main-content">
        {text(locale, "Skip to content", "本文へスキップ")}
      </a>
      <Navigation locale={locale} />
      <main id="main-content" tabIndex={-1}>
        <section
          className="nx-hero nx-container"
          aria-labelledby="hero-heading"
        >
          <div className="nx-hero-copy">
            <h1 id="hero-heading">
              <HeadingCopy
                locale={locale}
                en="Review activity and reply status in your Discord community."
                ja={["Discordの活動と、", "投稿への返信状況を確認する。"]}
              />
            </h1>
            <p className="nx-lead">
              {text(
                locale,
                "See activity by period and channel, check eligible posts with no response detected, and revisit your team’s follow-up records.",
                "期間やチャンネルごとの活動を見て、返信を確認できない対象投稿を整理。スタッフの対応と、その後の記録を振り返れます。",
              )}
            </p>
            <Cta locale={locale} />
            <p className="nx-availability">
              {text(
                locale,
                "Closed Beta 1 in preparation · Free, invitation only",
                "Closed Beta 1 準備中 · 無料・招待制",
              )}
              {" · "}
              <a href="#invitation-beta">
                {text(locale, "Participation conditions", "提供条件を見る")}
              </a>
            </p>
            <a className="nx-text-link nx-demo-jump" href="#demo">
              <Icon name="play" size={16} />
              {text(locale, "Try the sample demo", "操作デモを試す")}
            </a>
          </div>
          <HeroExample locale={locale} />
        </section>

        <section
          id="demo"
          className="nx-demo-section"
          aria-labelledby="demo-heading"
        >
          <div className="nx-container">
            <div className="nx-demo-intro">
              <div className="nx-section-heading">
                <h2 id="demo-heading">
                  {text(
                    locale,
                    "Try the activity view.",
                    "活動の値と、測定の根拠を見る。",
                  )}
                </h2>
              </div>
              <p>
                {text(
                  locale,
                  "Switch between 7 and 30 days, select a value, and inspect its context. This demo uses synthetic data. No connection or sign-in is needed.",
                  "7日・30日の切替や、値の選択、根拠の表示を試せます。合成データを使ったデモなので、サーバー接続やログインは不要です。",
                )}
              </p>
            </div>
            <ProductPreview locale={locale} />
          </div>
        </section>

        <section
          id="features"
          className="nx-section nx-container"
          aria-labelledby="features-heading"
        >
          <div className="nx-section-heading">
            <h2 id="features-heading">
              {text(
                locale,
                "Three views for everyday community work.",
                "活動の確認から、対応の振り返りまで。",
              )}
            </h2>
            <p>
              {text(
                locale,
                "Explore activity across your community, including newcomers, then inspect eligible posts and your team’s records.",
                "新規メンバーを含むコミュニティの活動、対象投稿への返信、スタッフの対応記録を、それぞれの画面で確認できます。",
              )}
            </p>
          </div>
          <CommunityWorkflow locale={locale} />
          <a className="nx-text-link" href="/product">
            {text(
              locale,
              "Explore the product in detail",
              "製品の機能と使い分けを見る",
            )}
            <Icon name="arrow" size={17} />
          </a>
        </section>

        <section
          id="how-it-works"
          className="nx-tinted-section nx-section"
          aria-labelledby="setup-heading"
        >
          <div className="nx-container">
            <div className="nx-section-heading">
              <h2 id="setup-heading">
                {text(
                  locale,
                  "Connect Discord and choose your collection scope.",
                  "Discordへの接続と、収集範囲の設定。",
                )}
              </h2>
            </div>
            <ol className="nx-setup-steps">
              {[
                [
                  "Confirm access and connect",
                  "利用条件を確認して接続",
                  "Once access is available, confirm the invitation conditions and access period, then add the bot with the required permissions. Open /nexus panel in a staff channel.",
                  "利用開始時は招待条件と利用期間を確認し、必要な権限でBotを追加。スタッフ用チャンネルで /nexus panel を開きます。",
                ],
                [
                  "Choose what to collect",
                  "収集対象を確認",
                  "Confirm your community’s purpose, channel uses and collection scope. Check collection status before reading results.",
                  "運営目的、チャンネルの用途、収集対象を確認します。結果を見る前に、収集状況も確かめます。",
                ],
                [
                  "Review and follow up",
                  "確認して対応",
                  "Review activity and attention items on Web, follow up in Discord, and revisit the records you are allowed to view.",
                  "Webで活動の変化と要確認の投稿を整理し、Discordで対応。閲覧できる記録から、その後を振り返ります。",
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
            <h2 id="privacy-heading">
              {text(
                locale,
                "Understand what is measured and retained.",
                "測定するデータと、保持・削除の管理。",
              )}
            </h2>
            <p>
              {text(
                locale,
                "NEXUS uses activity metadata for measurement. Missing observations remain unknown; a reply alone does not prove that an issue is resolved.",
                "測定には活動のメタデータを使います。取得できない値は不明のまま扱い、返信の確認だけで問題の解決を判断しません。",
              )}
            </p>
            <a className="nx-text-link" href="/privacy">
              {text(
                locale,
                "Check privacy document availability",
                "プライバシー文書の公開状況",
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

        <div className="nx-container nx-beta-section">
          <BetaNotice locale={locale} />
        </div>

        <section
          className="nx-plan-note nx-container"
          aria-labelledby="plans-heading"
        >
          <div>
            <h2 id="plans-heading">
              {text(
                locale,
                "Compare the five standard plans.",
                "5つの通常プランを比較する。",
              )}
            </h2>
            <p>
              {text(
                locale,
                "Free, Starter, Growth, Scale and Enterprise describe the standard feature and allowance structure. Closed Beta 1 is in preparation; paid checkout, Live and extra analysis packs are not open.",
                "Free・Starter・Growth・Scale・Enterpriseの機能と利用枠を比較できます。Closed Beta 1は準備中です。有料決済・Live・追加回数パックは開始していません。",
              )}
            </p>
          </div>
          <a className="nx-button nx-button-outline" href="/pricing">
            {text(locale, "Compare plans", "プランを比較")}
            <Icon name="arrow" size={18} />
          </a>
        </section>

        <section
          className="nx-news-entry nx-container"
          aria-labelledby="home-news-heading"
        >
          <div>
            <h2 id="home-news-heading">
              {text(locale, "Updates from NEXUS", "NEXUSからのお知らせ")}
            </h2>
            <p>
              {text(
                locale,
                "Check the announcements page for published product updates and service information.",
                "製品の更新やサービスに関する公開済みの情報は、お知らせで確認できます。",
              )}
            </p>
          </div>
          <a className="nx-text-link" href="/news">
            {text(locale, "View announcements", "お知らせを見る")}
            <Icon name="arrow" size={18} />
          </a>
        </section>

        <section
          className="nx-section nx-container nx-faq"
          aria-labelledby="faq-heading"
        >
          <div className="nx-section-heading">
            <h2 id="faq-heading">
              <HeadingCopy
                locale={locale}
                en="Before you get started"
                ja={["導入前のよくある質問"]}
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
            <h2>
              <HeadingCopy
                locale={locale}
                en="Interested in Closed Beta 1?"
                ja={["Closed Beta 1への参加を検討する"]}
              />
            </h2>
            <p>
              {text(
                locale,
                "Read the participation information, including availability, duration and usage limits.",
                "参加案内で、受付状況・利用期間・利用上限をご確認ください。",
              )}
            </p>
            <Cta locale={locale} secondary={false} />
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
