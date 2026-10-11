import type { SiteLocale } from "../public-ui";

const entries = [
  {
    id: "members",
    question: [
      "月間の集計対象人数は、どう数えますか？",
      "How are members counted each month?",
    ],
    paragraphs: [
      [
        "各サーバーで、その月に取得・処理した参加・退出や活動の記録に含まれるメンバーを数えます。同じメンバーは、そのサーバーでは月に1人として数えます。集計期間はUTCの暦月単位です。",
        "Members included in processed join, leave or activity records are counted separately for each server. A member is counted once per server per UTC calendar month.",
      ],
      [
        "この人数は運用上の目安です。目安を超えただけで追加料金が発生したり、データ収集が止まったりすることはありません。招待期限、権限、利用停止などの条件は別に適用されます。",
        "This count is an operating guideline. Exceeding it alone does not trigger extra charges or stop data collection. Invitation expiry, permissions, suspension and other access conditions still apply.",
      ],
    ],
  },
  {
    id: "results",
    question: [
      "プランによって、集計結果の扱いは変わりますか？",
      "How do plans affect the results I see?",
    ],
    paragraphs: [
      [
        "使える機能や確認できる期間はプランによって異なります。どのプランでも、確認できない情報を「0」として表示しません。一部のデータしか取得できていない場合や、比較に必要な件数が不足している場合も区別して案内します。",
        "Available features and the time periods you can view vary by plan. In every plan, information that cannot be confirmed is not shown as zero. Partial data and too few records for a comparison are identified separately.",
      ],
    ],
  },
  {
    id: "limits",
    question: [
      "データから分からないことはありますか？",
      "What can't the data tell me?",
    ],
    paragraphs: [
      [
        "同じボイスチャンネルにいた記録だけでは、会話していたかどうかは分かりません。絵文字から気持ちを判断したり、Discord外のイベントへの参加を確認したりするものでもありません。画面の結果は、取得できたデータの範囲でご確認ください。",
        "Being in the same voice channel does not prove that members were talking to each other. Emoji are not used to determine how someone feels, and participation in events outside Discord cannot be confirmed. Interpret each result within the data available for it.",
      ],
    ],
  },
  {
    id: "history",
    question: [
      "プランや利用期間が変わると、以前のデータはどうなりますか？",
      "What happens to earlier data when my plan or access period changes?",
    ],
    paragraphs: [
      [
        "過去のデータを確認できる範囲は、その時点の利用条件で変わります。表示できないことと、データが削除されたことは同じではありません。",
        "The historical data you can access depends on your current access conditions. Data no longer being visible does not necessarily mean it has been deleted.",
      ],
      [
        "下位プランへの変更時は、一部の集計履歴に標準30日の保存猶予があります。個別条件で期間は異なり、保存期間の上限や削除要求が優先されます。必ず残る・復元できるという保証ではなく、招待期間の30日とも別の条件です。保存と削除の詳しい説明は、確定したプライバシーポリシーの公開時に案内します。",
        "After a downgrade, some aggregate history has a standard 30-day retention grace period, which can vary by account conditions. Retention limits and deletion requests take priority. This does not guarantee preservation or recovery and is separate from the 30-day invitation period. Detailed retention and deletion information will be provided when the finalized Privacy Policy is published.",
      ],
    ],
  },
] as const;

export function PricingFaq({
  locale,
  purchaseMode,
}: {
  locale: SiteLocale;
  purchaseMode: "closed" | "sandbox" | "live";
}) {
  const language = locale === "ja" ? 0 : 1;
  const purchase =
    purchaseMode === "closed"
      ? [
          "現在、無料・招待制のClosed Beta 1の開始を準備しています。有料プランや追加購入は受け付けていません。参加方法と利用条件は、Closed Beta 1の案内をご確認ください。",
          "NEXUS is preparing to launch Closed Beta 1, which will be free and invitation-only. Paid plans and add-on purchases are not available. Please see the Closed Beta 1 information for participation details and access conditions.",
        ]
      : purchaseMode === "sandbox"
        ? [
            "決済テスト用の環境です。テスト購入に実際の請求は発生しません。プランの反映には決済側の契約確認が必要です。",
            "This is a payment testing environment. Test purchases do not create real charges. Plans activate after the payment provider confirms the subscription.",
          ]
        : [
            "購入できるプランは料金表に表示されます。対象サーバーと金額を確認し、支払い手続きを完了してください。プランの反映には決済側の契約確認が必要です。",
            "Available plans are shown in the pricing table. Confirm the server and amount before completing payment. Plans activate after the payment provider confirms the subscription.",
          ];
  return (
    <section className="site-section faq" aria-labelledby="pricing-faq-title">
      <h2 id="pricing-faq-title">
        {locale === "ja"
          ? "プランとデータについてのよくある質問"
          : "Questions about plans and data"}
      </h2>
      {entries.map((entry) => (
        <details key={entry.id} data-faq={entry.id}>
          <summary>{entry.question[language]}</summary>
          {entry.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph[language]}</p>
          ))}
        </details>
      ))}
      <details data-faq="purchase">
        <summary>
          {locale === "ja"
            ? "有料プランは購入できますか？"
            : "Can I purchase a paid plan?"}
        </summary>
        <p>{purchase[language]}</p>
        {purchaseMode === "closed" && (
          <p>
            <a href="#invitation-beta">
              {locale === "ja"
                ? "Closed Beta 1の案内"
                : "Closed Beta 1 information"}
            </a>
          </p>
        )}
      </details>
    </section>
  );
}
