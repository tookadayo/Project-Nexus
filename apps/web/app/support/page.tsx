import { BetaNotice } from "../landing/beta-notice";
import { SiteShell, copy, siteLocale } from "../public-ui";
export default async function Support() {
  const link = process.env.NEXUS_FEEDBACK_URL,
    locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <BetaNotice locale={locale} />
      <div className="legal-page">
        <p className="site-eyebrow">SUPPORT</p>
        <h1>{copy(locale, "困ったときは", "How can we help?")}</h1>
        <p>
          {copy(
            locale,
            "招待Betaへの参加案内、問題の報告、ご意見の窓口を確認できます。",
            "Find participation information for invitation Beta and support options below.",
          )}
        </p>
        {link ? (
          <p>
            <a className="button button-primary" href={link}>
              {copy(
                locale,
                "問題を報告・意見を送る",
                "Report a problem or send feedback",
              )}
            </a>
          </p>
        ) : (
          <p>
            {copy(
              locale,
              "サポート窓口はまだ設定されていません。サーバー一覧から対象を確認し、設定で接続状態を確認できます。",
              "A support destination has not been configured. Check the selected server in the server list and review its connection in Settings.",
            )}
          </p>
        )}
        <p>
          <a href="/servers">{copy(locale, "サーバー一覧", "Server list")}</a> ·{" "}
          <a href="/dashboard?view=4">
            {copy(locale, "接続設定", "Connection settings")}
          </a>
        </p>
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
            "設定で運営目的とチャンネル用途を確認し、検出結果を更新してください。権限や観測期間が不足する場合は、一部のみ観測・未確認と表示します。",
            "Check community purposes and channel mappings in Settings, then refresh discovery. Missing permissions or observation time are shown as partial or unknown.",
          )}
        </p>
        <p>
          {copy(
            locale,
            "ボイスの同席は会話の証明ではありません。参加登録と出席は別で、外部イベントの出席は確認できません。本文・画像・音声・投票内容は収集しません。",
            "Voice co-presence does not prove conversation. Registration is separate from attendance; external attendance cannot be verified. Message bodies, images, audio and poll meaning are not collected.",
          )}
        </p>
        <p>
          {copy(
            locale,
            "診断情報にはBot TokenやOAuth Tokenを含めないでください。",
            "Do not include bot or OAuth tokens in reports.",
          )}
        </p>
      </div>
    </SiteShell>
  );
}
