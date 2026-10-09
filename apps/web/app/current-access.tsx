import "./observation-chart.css";
import type { CurrentAccess } from "../../../packages/operations/src/access-presentation";
import { featureCopy } from "../../../packages/settings/src/plan-copy";
export function CurrentAccessPanel({
  access,
  locale,
}: {
  access: CurrentAccess;
  locale: "ja" | "en";
}) {
  const ja = locale === "ja",
    date = (value: string) =>
      new Date(value).toLocaleString(locale, { timeZone: "UTC" }) + " UTC";
  const names: Record<string, [string, string]> = {
    BETA: ["無料招待Beta", "Free invitation Beta"],
    PARTNER: ["特別提供", "Partner access"],
    PROMOTION: ["特典", "Promotional access"],
    TRIAL: ["試用", "Trial access"],
    CONTRACT: ["個別契約", "Contract access"],
    LEGACY: ["引き継いだ利用権", "Existing access"],
    DEBUG: ["検証用の利用権", "Test access"],
  };
  return (
    <details className="surface current-access">
      <summary>
        {ja ? "現在の利用条件" : "Current access conditions"} ·{" "}
        {access.benefits.some((b) => b.kind === "BETA")
          ? ja
            ? "無料招待Beta"
            : "Free invitation Beta"
          : access.plan}
      </summary>
      <p>
        {ja ? "基本プラン" : "Base plan"}: {access.basePlan} ·{" "}
        {ja ? "表示可能な集計履歴" : "Available aggregate history"}:{" "}
        {access.historyDays === null
          ? ja
            ? "個別契約"
            : "Custom contract"
          : `${access.historyDays} ${ja ? "日" : "days"}`}
      </p>
      {access.benefits.map((b, i) => (
        <p key={i}>
          {(names[b.kind] ?? ["追加の利用権", "Additional access"])[ja ? 0 : 1]}{" "}
          ·{" "}
          {b.endsAt
            ? (ja ? "適用期限: " : "Expires: ") + date(b.endsAt)
            : ja
              ? "期限なし"
              : "No expiry"}
        </p>
      ))}
      <p>
        {ja
          ? "表示は通常プランと現在有効な追加の利用権を合わせたものです。1つの期限が終了しても、他の権利で使える機能は残ります。"
          : "Available features combine your plan and active access benefits. Other valid benefits can remain after one expires."}
      </p>
      {!access.workAllowed && (
        <p role="status">
          {ja
            ? "このサーバーでは新規取得と新しい操作が停止中です。履歴は現在の権限・保持・削除状態に応じて確認できます。連携解除と削除の案内は設定から確認してください。"
            : "New collection and actions are paused for this server. History remains subject to current permissions, retention and deletion status. See Settings for disconnect and deletion options."}
        </p>
      )}
      {access.beta?.endsAt && (
        <p>
          {ja ? "招待Betaの期限" : "Invitation Beta expiry"}:{" "}
          {date(access.beta.endsAt)}
        </p>
      )}
      <p>
        {ja
          ? "詳細分析の利用枠の残り（予約済みを除く）"
          : "Remaining detailed analysis credits (excluding reservations)"}
        :{" "}
        {access.usage === null
          ? ja
            ? "現在の状態を確認できません"
            : "Current amount unavailable"
          : access.usage.remaining}
      </p>
      {access.usage && (
        <p>
          {ja ? "予約中" : "Reserved"}: {access.usage.reserved} ·{" "}
          {ja ? "有効な利用枠で消費済み" : "Consumed from active allocations"}:{" "}
          {access.usage.consumed}
        </p>
      )}
      <p>
        {ja ? "現在の月次付与上限" : "Current monthly allocation limit"}:{" "}
        {access.monthlyRuns ?? (ja ? "個別契約" : "Custom contract")}{" "}
        {ja
          ? "回 / サーバー。利用が継続する場合の次回付与: "
          : "runs / server. Next allocation if access continues: "}
        {date(access.nextMonthlyGrantAt)}
      </p>
      <p>
        {ja
          ? "通常の月次付与はUTCの暦月単位です。追加の利用枠には別の期限があるため、表示残数すべてが同じ日に更新されるとは限りません。受付時に1回分を予約し、結果の保存成功時に消費します。失敗・取消時は既存の処理で予約を解放します。履歴の再表示や条件確認では消費しません。"
          : "Monthly allocations follow UTC calendar months. Extra allocations may expire separately, so the entire remaining balance may not reset together. One credit is reserved on acceptance and consumed when the result is saved successfully. Failed or cancelled runs release their reservation. Reading history or previewing conditions does not consume credits."}
      </p>
      <p>
        {ja ? "同時に処理できる詳細分析" : "Concurrent detailed analyses"}:{" "}
        {access.concurrency ?? (ja ? "個別契約" : "Custom contract")}.{" "}
        {ja
          ? "招待Betaでは別途、1日・1か月・待機中の安全上限も適用されます。残回数があっても利用できない場合があります。"
          : "Invitation Beta also applies daily, monthly and pending-work safety limits. Remaining credits do not guarantee that a run can start."}
      </p>
      <p>
        {access.beta &&
          (ja
            ? `招待Betaの安全上限: 1日 ${access.beta.limits.daily} 回、1か月 ${access.beta.limits.monthly} 回、サーバー内の待機・実行中 ${access.beta.limits.guildPending} 件。全体の待機・実行中の上限により受付を待つ場合もあります。`
            : `Invitation Beta safety limits: ${access.beta.limits.daily} runs per day, ${access.beta.limits.monthly} per month, and ${access.beta.limits.guildPending} pending/running per server. A global pending-work limit can also delay acceptance.`)}
      </p>
      <h3>
        {ja
          ? "このサーバーの利用権に含まれる機能"
          : "Features included for this server"}
      </h3>
      <p>
        {ja
          ? "実際の操作には、その操作を行う権限も必要です。"
          : "Your role must also permit each action."}
      </p>
      <ul>
        {access.features.map((f) => (
          <li key={f}>{featureCopy[f][ja ? 0 : 1]}</li>
        ))}
      </ul>
      <p>
        {ja ? "確認時点" : "Checked at"}: {date(access.asOf)}
      </p>
    </details>
  );
}
