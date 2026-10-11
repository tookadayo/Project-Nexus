import { BetaNotice } from "../landing/beta-notice";
import { HeroExample } from "../landing/hero-example";
import { CommunityWorkflow } from "../landing/workflow";
import { Preview, SiteCta, SiteShell, copy, siteLocale } from "../public-ui";

export default async function Product() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <section
        className="nx-container nx-hero nx-product-hero"
        aria-labelledby="product-heading"
      >
        <div className="nx-hero-copy">
          <h1 id="product-heading">
            {copy(
              locale,
              "Discordの活動と、投稿への返信状況を確認する。",
              "Review Discord activity and replies to posts.",
            )}
          </h1>
          <p className="nx-lead">
            {copy(
              locale,
              "コミュニティの活動を知り、投稿を確認し、対応後を振り返る。DiscordとWebで、それぞれの仕事に必要な情報を確認できます。",
              "Understand activity, review a post, and look back on your response. Discord and Web bring the right context to each part of your work.",
            )}
          </p>
          <SiteCta locale={locale} secondary={false} />
          <a className="nx-text-link nx-product-demo-link" href="#demo">
            {copy(locale, "操作デモを見る", "Try the interactive demo")}
          </a>
          <p className="nx-availability">
            {copy(
              locale,
              "Closed Beta 1は準備中 · 無料・招待制 · 期限・利用上限あり",
              "Closed Beta 1 is in preparation · Free and invitation-only · Limited duration and usage",
            )}
            {" · "}
            <a href="#invitation-beta">
              {copy(locale, "提供条件を見る", "Participation conditions")}
            </a>
          </p>
        </div>
        <HeroExample locale={locale} />
      </section>
      <section
        id="demo"
        className="nx-demo-section"
        aria-labelledby="product-demo-heading"
      >
        <div className="nx-container">
          <div className="nx-demo-intro">
            <div className="nx-section-heading">
              <h2 id="product-demo-heading">
                {copy(
                  locale,
                  "操作デモで、使い方を確かめる。",
                  "Try the demo and explore how NEXUS works.",
                )}
              </h2>
            </div>
            <p>
              {copy(
                locale,
                "合成データで7日・30日を切り替え、投稿の表示例や測定の根拠を確認できます。実際の分析や保存は行いません。",
                "Explore 7 or 30 days of synthetic data, a sample post and the measurement context. No real analysis runs or saves.",
              )}
            </p>
          </div>
          <Preview locale={locale} />
        </div>
      </section>
      <section
        className="nx-section nx-container"
        aria-labelledby="product-workflow-heading"
      >
        <div className="nx-section-heading">
          <h2 id="product-workflow-heading">
            {copy(
              locale,
              "活動を確認し、対応を記録する",
              "Review activity and record your response",
            )}
          </h2>
          <p>
            {copy(
              locale,
              "新規参加者の支援も、既存メンバーとの日々の交流も。個人の評価や満足度を推定せず、確認できる事実から進めます。",
              "From welcoming new members to everyday activity with established members. Work from available facts without inferring individual performance or satisfaction.",
            )}
          </p>
        </div>
        <CommunityWorkflow locale={locale} />
      </section>
      <section
        className="nx-tinted-section nx-section"
        aria-labelledby="surfaces-heading"
      >
        <div className="nx-container">
          <div className="nx-section-heading">
            <h2 id="surfaces-heading">
              {copy(
                locale,
                "WebとDiscordで確認できること",
                "What you can review in Web and Discord",
              )}
            </h2>
          </div>
          <div className="nx-product-surfaces">
            <article>
              <h3>Web</h3>
              <p>
                {copy(
                  locale,
                  "ホームから要確認・分析・履歴へ。対象期間や条件を確かめて結果を読み、収集状況と設定を管理します。",
                  "Start from Home, then open Attention, Analysis or History. Read results alongside periods and conditions, and manage collection status and settings.",
                )}
              </p>
            </article>
            <article>
              <h3>Discord</h3>
              <p>
                {copy(
                  locale,
                  "/nexus panel から日々の確認と対応へ。本文は元の投稿で読み、権限を持つ運営者が確認・保留・対応済みを記録します。",
                  "Open /nexus panel for daily checks and follow-up. Read the original post, then record a staff check, snooze or handled state with the required permissions.",
                )}
              </p>
            </article>
          </div>
          <p className="nx-product-access-note">
            {copy(
              locale,
              "画面や操作ごとに現在の権限を確認します。収集中・データ不足・取得不能をゼロと区別し、条件が合わない結果は比較できない理由を示します。",
              "Current permissions apply to each view and action. Collection in progress, insufficient data and unavailable results stay distinct from zero. Incompatible results explain why they cannot be compared.",
            )}
          </p>
        </div>
      </section>
      <div className="nx-container nx-beta-section">
        <BetaNotice locale={locale} />
      </div>
      <section
        className="nx-section nx-container nx-product-boundaries"
        aria-labelledby="boundaries-heading"
      >
        <h2 id="boundaries-heading">
          {copy(
            locale,
            "使うデータと、分かること",
            "The data NEXUS uses and what it can tell you",
          )}
        </h2>
        <ul>
          <li>
            {copy(
              locale,
              "本文・添付・DM内容・Voice音声は保存しません。活動の種類、時刻、測定と対応に必要なメタデータを扱います。",
              "Message text, attachments, DM contents and Voice audio are not stored. NEXUS uses activity types, timestamps and metadata needed for measurement and follow-up.",
            )}
          </li>
          <li>
            {copy(
              locale,
              "返信や他者の参加の確認は、問題の解決を示しません。「対応済み」は運営者による記録です。ボイスチャンネルへの同席は、会話したことの証明ではありません。",
              "A detected reply or another person's participation does not prove resolution. Handled is a record made by an operator. Voice co-presence does not prove that a conversation took place.",
            )}
          </li>
          <li>
            {copy(
              locale,
              "無料・招待制のClosed Beta 1を準備しています。有料決済と追加分析回数の購入は開始していません。",
              "We are preparing free, invitation-only Closed Beta 1. Paid checkout and extra analysis packs are not open.",
            )}
          </li>
        </ul>
        <div className="nx-product-links">
          <a className="nx-text-link" href="/privacy">
            {copy(
              locale,
              "プライバシーポリシーの公開状況",
              "Privacy Policy availability",
            )}
          </a>
          <a className="nx-text-link" href="/pricing">
            {copy(locale, "通常プランの構成", "Standard plan structure")}
          </a>
          <a className="nx-text-link" href="/support">
            {copy(
              locale,
              "提供条件と既知の制約",
              "Availability and known limitations",
            )}
          </a>
        </div>
      </section>
    </SiteShell>
  );
}
