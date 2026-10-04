import { Preview, SiteCta, SiteShell, copy, siteLocale } from "../public-ui";
export default async function Product() {
  const locale = await siteLocale();
  const steps = [
    {
      tag: "ACTIVITY",
      title: copy(
        locale,
        "新規メンバーの活動を確認する",
        "See how far newcomers get.",
      ),
      body: copy(
        locale,
        "参加、最初の活動、他の人との交流、再訪、参加後の活動を、観測できた範囲で分けて表示します。",
        "Separate joining, first activity, human connection, repeat activity, and activity after joining using observed data.",
      ),
      detail: copy(
        locale,
        "対象者なし、測定中、人数不足、取得失敗を区別。",
        "Distinguish no eligible members, incomplete observations, small samples and unavailable data.",
      ),
    },
    {
      tag: "ATTENTION",
      title: copy(
        locale,
        "返信待ちの投稿を見つける",
        "Bring unanswered posts into view.",
      ),
      body: copy(
        locale,
        "設定された時間を過ぎても直接返信が確認できない新規メンバーの投稿を、Discordの対応画面にまとめます。",
        "Bring newcomer posts without a confirmed direct reply after your configured delay into a Discord attention queue.",
      ),
      detail: copy(
        locale,
        "スタッフ確認・後で確認・解決を明確に区別。",
        "Acknowledge, snooze, and resolve remain distinct actions.",
      ),
    },
    {
      tag: "EVIDENCE",
      title: copy(
        locale,
        "比較人数と対象期間を見る",
        "Show the reason and the rule.",
      ),
      body: copy(
        locale,
        "提案には観測した人数、期間、比較の可否を添えます。測定に使う活動と除外条件も確認できます。",
        "Recommendations include their sample, observation period, and whether comparison is supported. Inspect measured activity and exclusions.",
      ),
      detail: copy(
        locale,
        "イベント登録を参加実績とは扱いません。",
        "Event signup is labeled signup, never attendance.",
      ),
    },
    {
      tag: "SETTINGS",
      title: copy(
        locale,
        "変更内容を確認して適用する",
        "Preview the change before applying it.",
      ),
      body: copy(
        locale,
        "返信通知などの改善案は、対象、待ち時間、通知先、上限を確認してから適用します。",
        "Check audience, delay, destination, and limits before enabling an improvement such as a reply alert.",
      ),
      detail: copy(
        locale,
        "権限と安全上限は既存の運用ルールを使用。",
        "Existing permissions and safety limits apply.",
      ),
    },
    {
      tag: "RESULTS",
      title: copy(
        locale,
        "改善前後の結果を見る",
        "Read outcomes with their limits.",
      ),
      body: copy(
        locale,
        "通常の場合と改善した場合を見比べ、観測途中や人数不足なら結論を急ぎません。",
        "Compare usual and improved experiences. When observations are incomplete, results stay inconclusive.",
      ),
      detail: copy(
        locale,
        "サンプルや観測状況を結果と一緒に表示。",
        "Sample sizes and observation state appear with results.",
      ),
    },
  ];
  return (
    <SiteShell locale={locale}>
      <section className="site-hero product-hero">
        <div className="hero-copy">
          <p className="site-eyebrow">PRODUCT / NEXUS</p>
          <h1>
            {copy(
              locale,
              <>
                <span className="nx-heading-phrase">新規メンバーの</span>
                <span className="nx-heading-phrase">返信を確認。</span>
              </>,
              <>Track newcomer replies in Discord and Web.</>,
            )}
          </h1>
          <p className="site-lead">
            {copy(
              locale,
              "NEXUSはDiscord Community Operations製品です。サーバーの目的、観測できる事実、対応が必要な場所、変更後の結果をつなぎます。",
              "NEXUS supports Discord community operations: choose a community purpose, inspect observed evidence, handle attention items, and review what changed.",
            )}
          </p>
          <SiteCta locale={locale} secondary={false} />
        </div>
        <Preview locale={locale} />
      </section>
      <section className="site-section product-steps">
        {steps.map((step) => (
          <article className="product-step" key={step.tag}>
            <div>
              <p className="site-eyebrow">{step.tag}</p>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </div>
            <div className="step-detail">
              <p>{step.detail}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="site-section final-cta">
        <h2>
          {copy(
            locale,
            "対応が必要な投稿を確認する。",
            "Review posts needing attention.",
          )}
        </h2>
        <SiteCta locale={locale} />
      </section>
    </SiteShell>
  );
}
