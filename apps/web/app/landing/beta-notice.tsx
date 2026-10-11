import {
  BETA_INVITATION_DAYS,
  BETA_ACTIVE_MAX,
} from "../../../../packages/config/src/hosted-beta";
import { text, type Locale } from "./content";
export function BetaNotice({
  locale,
  purchaseMode = "closed",
}: {
  locale: Locale;
  purchaseMode?: "closed" | "sandbox" | "live";
}) {
  return (
    <section className="nx-beta-notice" id="invitation-beta">
      <h2>
        {text(
          locale,
          "Closed Beta 1 · Free invitation Beta",
          "Closed Beta 1 · 無料の招待制Beta",
        )}
      </h2>
      <p>
        {text(
          locale,
          `NEXUS is preparing to launch Closed Beta 1, with free, invitation-only access for a limited period and within usage limits. The default invitation lasts ${BETA_INVITATION_DAYS} days; across the whole Beta program, the limit is ${BETA_ACTIVE_MAX} active servers, not an allowance per participant.`,
          `無料・招待制のClosed Beta 1の開始を準備しています。期限・上限つきで招待されたサーバーへ提供する予定です。招待の初期期間は${BETA_INVITATION_DAYS}日、Beta全体の提供規模は稼働中の最大${BETA_ACTIVE_MAX}サーバーです。各利用者が追加できる台数を示すものではありません。`,
        )}{" "}
        {purchaseMode === "closed"
          ? text(
              locale,
              "General registration and paid checkout are not open.",
              "一般登録と有料決済は開始していません。",
            )
          : purchaseMode === "sandbox"
            ? text(
                locale,
                "General registration and real-money checkout are not open. The Sandbox checkout flow is for testing only.",
                "一般登録と実際の有料決済は開始していません。Sandboxでの決済手順は検証用です。",
              )
            : text(
                locale,
                "Beta access requires an invitation and has separate conditions from standard paid subscriptions.",
                "Betaへの参加には招待が必要です。通常の有料プランとは利用条件が異なります。",
              )}
      </p>
      <p>
        {text(
          locale,
          "Beta is a time-limited access benefit, not a sixth subscription plan. After invitation, available features, expiry and remaining credits appear in your current access conditions.",
          "Betaは期限付きの利用権による提供で、第6の料金プランではありません。招待後は、有効な機能・期限・残回数を利用者画面の「現在の利用条件」で確認できます。",
        )}{" "}
        {purchaseMode === "closed"
          ? text(
              locale,
              "The normal plans describe the standard feature and allowance structure; they are not a purchase offer.",
              "通常プランの説明は標準的な機能・利用枠の構成を示すもので、購入の受付ではありません。",
            )
          : text(
              locale,
              "The normal plans below describe standard features and allowances separately from Beta access.",
              "以下の通常プランは、Betaの利用権とは別に、標準的な機能と利用枠を示しています。",
            )}
      </p>
      <a href="/support">
        {text(
          locale,
          "Check Closed Beta 1 participation information",
          "Closed Beta 1の参加案内を確認",
        )}
      </a>
    </section>
  );
}
