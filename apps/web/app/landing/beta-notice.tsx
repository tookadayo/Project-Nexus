import {
  BETA_INVITATION_DAYS,
  BETA_ACTIVE_MAX,
} from "../../../../packages/config/src/hosted-beta";
import { text, type Locale } from "./content";
export function BetaNotice({ locale }: { locale: Locale }) {
  return (
    <section className="nx-beta-notice" id="invitation-beta">
      <h2>{text(locale, "Free invitation Beta", "無料の招待制Beta")}</h2>
      <p>
        {text(
          locale,
          `NEXUS is currently offered to invited servers, for a limited period with usage limits. The default invitation lasts ${BETA_INVITATION_DAYS} days; this Beta is limited to ${BETA_ACTIVE_MAX} active servers. General registration and paid checkout are not open.`,
          `現在は招待されたサーバーを対象に、期限・上限つきで無料提供しています。招待の初期期間は${BETA_INVITATION_DAYS}日、このBetaは稼働中の最大${BETA_ACTIVE_MAX}サーバーが対象です。一般登録と有料決済は開始していません。`,
        )}
      </p>
      <p>
        {text(
          locale,
          "Beta is a time-limited access benefit, not a sixth subscription plan. Its available features, expiry and remaining credits appear in your current access conditions. The normal plans below describe the standard feature and allowance structure; they are not a purchase offer.",
          "Betaは期限付きの利用権による提供で、第6の料金プランではありません。有効な機能・期限・残回数は利用者画面の「現在の利用条件」で確認できます。通常プランの説明は標準的な機能・利用枠の構成を示すもので、購入の受付ではありません。",
        )}
      </p>
      <a href="/support">
        {text(
          locale,
          "Check Beta participation information",
          "Betaの参加案内を確認",
        )}
      </a>
    </section>
  );
}
