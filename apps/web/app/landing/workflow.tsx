import { Icon } from "./primitives";
import { text, type Locale } from "./content";

export function CommunityWorkflow({ locale }: { locale: Locale }) {
  const jobs = [
    {
      icon: "activity",
      title: text(locale, "Understand the change", "活動の変化を知る"),
      body: text(
        locale,
        "Explore activity by period and channel. See the available data and its limits before deciding where to look closer.",
        "期間やチャンネルごとに活動を確認。取得できた値と不足しているデータを見ながら、詳しく見る場所を選べます。",
      ),
      detail: text(
        locale,
        "One use: follow how new members begin to participate and connect.",
        "たとえば、新規メンバーの最初の活動や交流を確認。",
      ),
      destination: text(locale, "Analysis", "分析"),
      tag: "01",
    },
    {
      icon: "message",
      title: text(
        locale,
        "Check eligible posts for replies",
        "対象投稿の返信を確認する",
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
      icon: "layers",
      title: text(
        locale,
        "Revisit follow-up records",
        "スタッフの対応記録を振り返る",
      ),
      body: text(
        locale,
        "Revisit permitted records and reports. Compare compatible results with their periods and data coverage in view.",
        "閲覧できる対応記録やレポートを振り返ります。条件が合う結果は、対象期間とデータの取得範囲を確かめながら比較できます。",
      ),
      detail: text(
        locale,
        "Missing data stays unavailable. A change alone does not show that an action caused it.",
        "不足するデータは不明のまま表示。変化だけで対応の効果を断定しません。",
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
              <p className="nx-workflow-destination">
                <Icon name={job.icon} size={19} />
                {job.destination}
              </p>
              <h3>{job.title}</h3>
              <p>{job.body}</p>
            </div>
            <p className="nx-workflow-detail">{job.detail}</p>
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
