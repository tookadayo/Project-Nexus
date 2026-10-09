export type AccessState = "ACTIVE" | "PAUSED" | "EXPIRED";
export function AccessNotice({
  state,
  locale,
  onSettings,
}: {
  state: AccessState;
  locale: "ja" | "en";
  onSettings: () => void;
}) {
  const ja = locale === "ja";
  const copy = {
    ACTIVE: ja
      ? "招待期間内です。機能ごとの権限・利用回数・取得データは別途確認します。"
      : "Your invitation period is active. Feature permissions, remaining uses and data availability are checked separately.",
    PAUSED: ja
      ? "新しいデータの取得と分析は停止中です。"
      : "New data collection and analyses are paused.",
    EXPIRED: ja
      ? "Betaの利用期間が終了しました。"
      : "Your Beta access has ended.",
  };
  return (
    <section className="surface access-notice" role="status">
      <p>{copy[state]}</p>
      {state !== "ACTIVE" && (
        <>
          <p>
            {ja
              ? "現在の権限・保存期間・削除状態に応じて履歴を確認できます。連携解除・削除の範囲は設定で確認してください。"
              : "History remains subject to current permissions, retention and deletion status. Review the scope of unlinking and deletion in Settings."}
          </p>
          <button onClick={onSettings}>
            {ja ? "接続と削除の案内を見る" : "Review connection and deletion"}
          </button>
        </>
      )}
    </section>
  );
}
