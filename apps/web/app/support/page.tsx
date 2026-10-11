import { VERSION } from "../../../../packages/shared/src/version";
import { BetaNotice } from "../landing/beta-notice";
import { SiteShell, copy, siteLocale } from "../public-ui";
import { SupportContactForm } from "./contact-form";
import "../../../../packages/presentation/src/publication-document.css";
export const dynamic = "force-dynamic";
export default async function Support() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <div className="legal-page support-page">
        <h1>{copy(locale, "NEXUSのサポート", "NEXUS support")}</h1>
        <p>
          {copy(
            locale,
            "Closed Beta 1の参加条件と、お問い合わせの公開状況、製品の使い方を確認できます。",
            "Find Closed Beta 1 participation conditions, contact availability and guidance on using NEXUS.",
          )}
        </p>
        <nav
          className="support-intro-links"
          aria-label={copy(locale, "サポートの案内", "Support guidance")}
        >
          <a href="#general-support">
            {copy(locale, "一般サポート", "General support")}
          </a>
          <a href="#rights-requests">
            {copy(
              locale,
              "開示・削除等のご案内",
              "Access, deletion and other rights",
            )}
          </a>
          <a href="#product-info">
            {copy(locale, "製品情報と制約", "Product information and limits")}
          </a>
        </nav>
        <BetaNotice locale={locale} />
        <section aria-labelledby="general-support">
          <h2 id="general-support" tabIndex={-1}>
            {copy(locale, "一般サポート", "General support")}
          </h2>
          <p>
            {copy(
              locale,
              "使い方、問題の報告、招待Betaに関するお問い合わせの案内です。個人情報の開示・削除等の請求とは送信先を分けます。現在、公開されたサポート窓口と送信機能は準備中です。",
              "Guidance for usage questions, problem reports and invitation Beta. General support has a separate destination from personal information requests. The public support contact and sending service are not yet available.",
            )}
          </p>
          <details className="nx-support-form-details">
            <summary>
              {copy(
                locale,
                "お問い合わせフォームの項目を見る（準備中）",
                "View support form fields (not yet available)",
              )}
            </summary>
            <SupportContactForm locale={locale} />
          </details>
        </section>
        <section aria-labelledby="rights-requests">
          <h2 id="rights-requests" tabIndex={-1}>
            {copy(
              locale,
              "個人情報の開示・削除等について",
              "Access, deletion and other personal information requests",
            )}
          </h2>
          <p>
            {copy(
              locale,
              "この案内は、NEXUSへのログインやDiscordサーバーの管理者権限がなくても確認できます。開示・訂正・削除等に関するご相談は、一般サポートとは別の専用窓口で扱います。",
              "This guidance is available without signing in to NEXUS or having Discord server administrator access. Questions about access, correction, deletion and other rights use a dedicated contact separate from general support.",
            )}
          </p>
          <p className="support-unavailable">
            {copy(
              locale,
              "権利請求の専用窓口は準備中です。この画面では請求の受付、本人確認、情報の開示・削除を行いません。",
              "The dedicated rights-request contact is not yet available. This page does not accept requests, verify identity, disclose information or delete data.",
            )}
          </p>
          <p>
            {copy(
              locale,
              "請求の受付と本人確認、実際の処理は別の段階です。他の人の情報を誤って開示・削除しないための必要な確認は、受付方法と併せて案内します。住所や生年月日、身分証をすべての方に一律に求めるものではありません。",
              "Intake, identity checks and fulfillment are separate steps. Any checks needed to avoid disclosing or deleting another person's information will be explained with the intake procedure. Address, date of birth and identity documents are not routinely required from everyone.",
            )}
          </p>
          <p>
            {copy(
              locale,
              "お問い合わせには順次対応する方針です。24時間体制や一定期間内の回答を保証するものではありません。法定期限が適用される請求は、その期限に従って扱います。受付が完了しても、開示・削除等の処理が完了したことにはなりません。",
              "Inquiries are handled sequentially. Round-the-clock support and responses within a fixed period are not guaranteed. Requests subject to legal deadlines are handled within those requirements. Receipt of a request does not mean that access, deletion or other processing is complete.",
            )}
          </p>
          <p>
            <a href="/privacy">
              {copy(
                locale,
                "プライバシーポリシーの公開状況",
                "Privacy Policy availability",
              )}
            </a>
          </p>
        </section>
        <p>
          <a href="/servers">{copy(locale, "サーバー一覧", "Server list")}</a> ·{" "}
          <a href="/dashboard?view=4">
            {copy(locale, "接続設定", "Connection settings")}
          </a>
        </p>
        <h2>
          {copy(
            locale,
            "利用中の画面から確認する",
            "Find guidance for the screen you use",
          )}
        </h2>
        <ul>
          <li>
            <a href="/dashboard">
              {copy(
                locale,
                "いま確認することを選ぶ",
                "Choose what to review now",
              )}
            </a>{" "}
            —{" "}
            {copy(
              locale,
              "ホームで返信待ちの候補、最近の対応記録、活動の変化を確認します。",
              "Review response candidates, recent records and activity on Home.",
            )}
          </li>
          <li>
            <a href="/dashboard?view=8">
              {copy(
                locale,
                "返信を確認したい投稿を探す",
                "Find posts to review",
              )}
            </a>{" "}
            —{" "}
            {copy(
              locale,
              "対象と状態で絞り込み、Discordで投稿を確認します。対応済みは運営者の記録であり、問題解決の自動判定ではありません。",
              "Filter by scope and status, then open the post in Discord. Handled is a team record, not an automatic judgment that a problem was solved.",
            )}
          </li>
          <li>
            <a href="/explore">
              {copy(
                locale,
                "活動の推移や差を見る",
                "Explore changes and differences",
              )}
            </a>{" "}
            —{" "}
            {copy(
              locale,
              "日ごとの値と対象別の内訳を確認します。詳細分析の種類選択と実行はDiscordのNEXUSパネルから開きます。",
              "Inspect daily values and channel breakdowns. Open the NEXUS panel in Discord to select and run a detailed analysis.",
            )}
          </li>
          <li>
            <a href="/dashboard?view=3">
              {copy(
                locale,
                "対応の後を確かめる",
                "Review what followed an action",
              )}
            </a>{" "}
            —{" "}
            {copy(
              locale,
              "現在の閲覧条件を満たす記録を確認します。十分なデータや比較条件がそろわない場合は、変化を断定しません。",
              "Review records available under your current access. Incomplete data or incompatible conditions cannot establish a change.",
            )}
          </li>
        </ul>
        <h2>
          {copy(
            locale,
            "指標が見つからないとき",
            "When a measurement is missing",
          )}
        </h2>
        <p>
          {copy(
            locale,
            "設定で運営目的とチャンネル用途を確認し、検出結果を更新してください。取得できる範囲や期間が足りない場合は、その項目の不足を表示します。確認できない値は0件とは別です。",
            "Check community purposes and channel mappings in Settings, then refresh discovery. A limited collection scope or period is explained for the affected item. An unavailable value is different from zero.",
          )}
        </p>
        <p>
          {copy(
            locale,
            "ボイスの同席は会話の証明ではありません。参加登録と出席は別で、外部イベントの出席は確認できません。",
            "Voice co-presence does not prove conversation. Registration is separate from attendance; external attendance cannot be verified.",
          )}
        </p>
        <p>
          {copy(
            locale,
            "診断情報にはBot TokenやOAuth Tokenを含めないでください。",
            "Do not include bot or OAuth tokens in reports.",
          )}
        </p>
        <section id="product-info" aria-labelledby="product-info-title">
          <h2 id="product-info-title" tabIndex={-1}>
            {copy(
              locale,
              "製品情報と試験提供の制約",
              "Product information and preview limits",
            )}
          </h2>
          <p>NEXUS {VERSION} · Alpha</p>
          <p>
            {copy(
              locale,
              "試験提供中です。データ不足や取得の途切れ、現在の閲覧条件によって、値や履歴を表示できない場合があります。返信・参加の確認は、問題解決や満足度を示すものではありません。",
              "NEXUS is in preview. Data gaps and current access conditions can limit the values and history shown. A detected reply or participation does not establish resolution or satisfaction.",
            )}
          </p>
          <p>
            <a href="/privacy">
              {copy(locale, "データの扱い", "Data handling")}
            </a>{" "}
            · <a href="/terms">{copy(locale, "利用条件", "Terms")}</a>
          </p>
        </section>
      </div>
    </SiteShell>
  );
}
