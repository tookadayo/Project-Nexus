import { text, type Locale } from "./content";

export function CommunityWorkflow({ locale }: { locale: Locale }) {
  const jobs = [
    {
      screen: "analysis",
      title: text(locale, "Review activity trends", "活動の推移を確認する"),
      body: text(
        locale,
        "Review activity by period and scope, and compare earlier periods when conditions are compatible. Read each value alongside its collection coverage.",
        "期間や対象ごとに活動を確認し、条件が合う場合は以前の期間と比較できます。取得範囲と不足しているデータを、値と一緒に確認できます。",
      ),
      detail: text(
        locale,
        "The chart keeps missing observations distinct from zero. New-member activity is also available in the product.",
        "グラフでは欠測と0を区別。新規メンバーの最初の活動も製品画面で確認できます。",
      ),
      destination: text(locale, "Analysis", "分析"),
      tag: "01",
    },
    {
      screen: "attention",
      title: text(
        locale,
        "Find posts to check for replies",
        "返信を確認したい投稿を探す",
      ),
      body: text(
        locale,
        "Review posts with no response detected in eligible help, bug-report and looking-for-group channels. Read the original in Discord before acting.",
        "ヘルプ・不具合報告・参加募集の対象条件に合う投稿を整理。返信や参加を確認できない投稿の本文を、Discordで確認します。",
      ),
      detail: text(
        locale,
        "Record a staff check, snooze, or mark as handled. A detected reply does not prove resolution.",
        "確認・保留・対応済みを記録。返信の確認は、問題の解決を意味しません。",
      ),
      destination: text(locale, "Attention → Discord", "要確認 → Discord"),
      tag: "02",
    },
    {
      screen: "history",
      title: text(
        locale,
        "Revisit follow-up records",
        "スタッフの対応記録を振り返る",
      ),
      body: text(
        locale,
        "Review saved response records and their start dates. Check the state of later observations separately from what staff recorded.",
        "保存された対応記録と開始日時を確認できます。スタッフが記録した対応と、その後の活動の観測状態を分けて振り返ります。",
      ),
      detail: text(
        locale,
        "A saved record is not proof of resolution. This excerpt shows the product’s recent-records view.",
        "記録の保存は、問題の解決の証明ではありません。画面は製品の「最近の対応記録」の抜粋です。",
      ),
      destination: text(locale, "History & reports", "履歴・レポート"),
      tag: "03",
    },
  ];
  return (
    <>
      <ol className="nx-workflow">
        {jobs.map((job) => (
          <li key={job.tag}>
            <div className="nx-workflow-main">
              <h3>{job.title}</h3>
              <p>{job.body}</p>
              <p className="nx-workflow-detail">{job.detail}</p>
            </div>
            <figure className="nx-feature-screen">
              <div
                className="nx-feature-screen-scroll"
                tabIndex={0}
                role="region"
                aria-label={text(
                  locale,
                  `${job.destination} screenshot; scroll horizontally on small screens`,
                  `${job.destination}の画像。小さな画面では横にスクロールできます`,
                )}
              >
                <img
                  src={`/nexus/screens/feature-${job.screen}-${locale}.png`}
                  width={768}
                  height={
                    job.screen === "analysis"
                      ? locale === "ja"
                        ? 870
                        : 900
                      : job.screen === "attention"
                        ? locale === "ja"
                          ? 472
                          : 467
                        : 279
                  }
                  loading="lazy"
                  decoding="async"
                  alt={text(
                    locale,
                    `${job.destination}: actual product display with synthetic data. ${job.detail}`,
                    `${job.destination}：合成データによる実製品の表示。${job.detail}`,
                  )}
                />
              </div>
              <figcaption>
                <span>
                  {text(
                    locale,
                    "Actual product UI · Synthetic data · Excerpt",
                    "実製品UI・合成データ・抜粋",
                  )}
                </span>
                <a href={`/nexus/screens/feature-${job.screen}-${locale}.png`}>
                  {text(locale, "View full-size image", "画像を大きく見る")}
                </a>
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
      <p className="nx-workflow-onboarding">
        {text(
          locale,
          "New-member onboarding can use a flow of questions and options. Operators can edit questions and configure option-to-role mappings in the Discord control panel.",
          "新しく参加した人への案内には、質問と選択肢のフローを使えます。運営者はDiscordの管理パネルで質問を編集し、選択肢とロールの関連付けを設定できます。",
        )}
      </p>
    </>
  );
}
