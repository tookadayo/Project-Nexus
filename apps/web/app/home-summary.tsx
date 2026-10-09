import type { ProductData } from "./console";
export function HomeSummary({
  data,
  locale,
  removed,
  onNavigate,
  onDetails,
  detailsOpen = false,
}: {
  data: ProductData;
  locale: "ja" | "en";
  removed: number;
  onNavigate: (view: number) => void;
  onDetails: () => void;
  detailsOpen?: boolean;
}) {
  const ja = locale === "ja",
    daily = data.community?.daily;
  const attention =
    daily?.ready && daily.attentionCount != null
      ? Math.max(0, daily.attentionCount - removed)
      : null;
  return (
    <section className="home-summary" aria-labelledby="home-title">
      <header>
        <p className="eyebrow">NEXUS</p>
        <h1 id="home-title">{ja ? "ホーム" : "Home"}</h1>
        <p>
          {ja
            ? "確認できた状況から、次の操作を選びます。"
            : "Review the available evidence and choose your next step."}
        </p>
        {data.home?.generatedAt && (
          <p className="summary-time">
            {ja ? "表示データの更新" : "Data updated"}:{" "}
            {new Date(data.home.generatedAt).toLocaleString(locale, {
              timeZone: "UTC",
            })}{" "}
            UTC
          </p>
        )}
      </header>
      <div className="summary-grid">
        <article>
          <h2>{ja ? "データの取得状況" : "Data availability"}</h2>
          <p>
            {!data.home
              ? ja
                ? "現在の状態を確認できません。"
                : "We could not confirm the current status."
              : data.home.setup.required
                ? ja
                  ? "初期設定を確認してください。"
                  : "Review the initial setup."
                : ja
                  ? "取得できる範囲と不足は詳細で確認できます。"
                  : "Review the available scope and gaps in the overview."}
          </p>
          <button
            className="primary"
            aria-expanded={detailsOpen}
            aria-controls="home-overview-detail"
            onClick={onDetails}
          >
            {ja ? "状況を詳しく見る" : "View full overview"}
          </button>
        </article>
        <article>
          <h2>{ja ? "要確認" : "Needs attention"}</h2>
          <p>
            {attention === null
              ? ja
                ? "この項目は確認できません。"
                : "This value is unavailable."
              : attention === 0
                ? ja
                  ? "確認できた範囲では0件です。"
                  : "There are 0 items in the available data."
                : ja
                  ? `${attention}件の確認待ちがあります。`
                  : `${attention} items need review.`}
          </p>
          <p className="summary-time">
            {ja
              ? "既存の返信待ち条件・取得範囲に基づく件数です。"
              : "Based on the existing reply queue rules and available data."}
          </p>
          {data.community?.generatedAt && (
            <p className="summary-time">
              {ja ? "取得時点" : "As of"}:{" "}
              {new Date(data.community.generatedAt).toLocaleString(locale, {
                timeZone: "UTC",
              })}{" "}
              UTC
            </p>
          )}
          <button onClick={() => onNavigate(8)}>
            {ja ? "要確認を見る" : "Review items"}
          </button>
        </article>
        <article>
          <h2>{ja ? "保存された対応結果" : "Saved response results"}</h2>
          <p>
            {data.results === null
              ? ja
                ? "現在の状態を確認できません。"
                : "We could not confirm the current status."
              : ja
                ? `${data.results.items.length + data.results.simple.length}件の結果を表示できます。`
                : `${data.results.items.length + data.results.simple.length} results are available.`}
          </p>
          <button onClick={() => onNavigate(3)}>
            {ja ? "履歴を見る" : "View history"}
          </button>
        </article>
      </div>
      <section className="surface">
        <h2>{ja ? "次にできること" : "Next steps"}</h2>
        <p>
          {ja
            ? "基本状況の確認に詳細分析の回数は使いません。詳しい分析の種類・条件確認・保存した分析履歴は、DiscordのNEXUSパネルから開けます。"
            : "Reviewing the basic overview does not use detailed analysis credits. Open the NEXUS panel in Discord for detailed analysis types, condition previews and saved analysis history."}
        </p>
        <button onClick={() => onNavigate(5)}>
          {ja ? "基本分析を見る" : "View basic analysis"}
        </button>
      </section>
    </section>
  );
}
