import type { ProductData } from "./console";
import { t, type MessageKey } from "../../../packages/discord-panels/src/i18n";
import { homeSummaryModel, type HomeDataState } from "./home-summary-model";
import "./home-summary.css";

type Locale = "ja" | "en";
const stateCopy: Record<HomeDataState, [string, string]> = {
  ready: ["収集状況を確認", "Review data collection"],
  partial: ["一部のデータを利用できます", "Some data is available"],
  collecting: [
    "集計できるデータを準備しています",
    "Preparing data for this view",
  ],
  setup: [
    "収集に必要な設定を確認してください",
    "Review the setup for data collection",
  ],
  unavailable: [
    "現在のデータ状態を確認できません",
    "We can’t determine the current data status",
  ],
  paused: [
    "新しいデータの収集と分析は停止中です",
    "New data collection and analyses are paused",
  ],
  expired: ["利用期間が終了しています", "Your access period has ended"],
};
const recordStates = {
  running: ["比較中", "Comparison in progress"],
  paused: ["一時停止", "Paused"],
  stopped: ["終了", "Ended"],
  collecting: ["データを収集中", "Collecting data"],
  available: ["結果を確認できます", "Results available"],
} as const;
const knownNames: Record<string, MessageKey> = {
  "Reply Rescue": "testAction.reply_rescue",
  "Welcome Helper": "testAction.welcome_helper",
  "Inactive Newcomer Follow-up": "testAction.inactive_follow_up",
  "Channel Recommendation": "testAction.channel_recommendation",
  "Event Recommendation": "testAction.event_recommendation",
};
function recordName(name: string, locale: Locale) {
  const base = name.endsWith(" Test") ? name.slice(0, -5) : name;
  const key = knownNames[base];
  return key ? t(locale, key) : name;
}
function formattedTime(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale, {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " UTC"
    : null;
}

export function HomeSummary({
  data,
  locale,
  activeCount,
  onNavigate,
  onDetails,
  detailsOpen = false,
}: {
  data: ProductData;
  locale: Locale;
  activeCount?: number | null;
  onNavigate: (view: number) => void;
  onDetails: () => void;
  detailsOpen?: boolean;
}) {
  const ja = locale === "ja";
  const model = homeSummaryModel(data, activeCount);
  const { attention, activity, primary, state } = model;
  const stopped = state === "paused" || state === "expired";
  const dataTime = data.community?.generatedAt ?? data.home?.generatedAt;
  const time = dataTime ? formattedTime(dataTime, locale) : null;
  const showActivity =
    activity && (activity.today !== null || activity.yesterday !== null);
  const detailButton = (label: string, isPrimary = false) => (
    <button
      type="button"
      className={isPrimary ? "primary" : "home-text-button"}
      aria-expanded={detailsOpen}
      aria-controls="home-overview-detail"
      onClick={onDetails}
    >
      {label}
      <span aria-hidden="true"> →</span>
    </button>
  );
  return (
    <section
      className="home-summary home-overview"
      aria-labelledby="home-title"
    >
      <header className="home-heading">
        <div>
          <h1 id="home-title">{ja ? "ホーム" : "Home"}</h1>
          <p>
            {ja
              ? "変化を知り、次の対応へ。"
              : "See what changed. Decide what to do next."}
          </p>
        </div>
        <div className="home-update">
          {time && (
            <p>
              {ja ? "データ更新" : "Data updated"}{" "}
              <time dateTime={dataTime}>{time}</time>
            </p>
          )}
          {detailButton(ja ? "収集状況を見る" : "View collection status")}
        </div>
      </header>

      {state !== "ready" && (
        <aside className={`home-state home-state--${state}`} role="status">
          <span className="home-state-mark" aria-hidden="true">
            i
          </span>
          <div>
            <strong>{stateCopy[state][ja ? 0 : 1]}</strong>
            <p>
              {stopped
                ? ja
                  ? "現在の権限・保存期間・削除状態に応じて、利用できる履歴を表示します。連携解除や削除の案内は設定で確認できます。"
                  : "Available history follows your current permissions, storage period and deletion status. Find connection and deletion guidance in Settings."
                : state === "collecting"
                  ? ja
                    ? "収集状況で、準備の進み具合と利用できるデータを確認できます。"
                    : "Check collection status for progress and available data."
                  : state === "unavailable"
                    ? ja
                      ? "取得できない項目があります。収集状況で詳細を確認してください。"
                      : "Some information could not be retrieved. Check collection status for details."
                    : state === "setup"
                      ? ja
                        ? "必要な設定と収集状況を確認すると、利用できるデータの範囲が分かります。"
                        : "Review the setup and collection status to understand which data is available."
                      : ja
                        ? "確認できる情報から表示しています。不足する項目は収集状況で確認できます。"
                        : "This view shows the information available. Check collection status for missing data."}
            </p>
          </div>
        </aside>
      )}

      <div className="home-priority-layout">
        <section
          className={`home-focus ${attention && !stopped ? "home-focus--attention" : ""}`}
          aria-labelledby="home-attention-title"
        >
          <p className="home-section-label">
            {ja ? "次の対応" : "Your next step"}
          </p>
          <h2 id="home-attention-title">
            {ja ? "確認したい投稿" : "Posts to review"}
          </h2>
          {attention !== null ? (
            <div className="home-count-line">
              <strong className="home-attention-count">
                {attention.toLocaleString(locale)}
              </strong>
              <span>{ja ? "件" : attention === 1 ? "post" : "posts"}</span>
              <span className="home-count-description">
                {attention > 0
                  ? ja
                    ? "返信を確認できない候補"
                    : "with no response detected"
                  : ja
                    ? "現在の条件では候補なし"
                    : "match the current conditions"}
              </span>
            </div>
          ) : (
            <p className="home-unavailable-value">
              {ja
                ? "返信待ちの件数は未確認です"
                : "The reply queue count is unavailable"}
            </p>
          )}
          <p className="home-focus-description">
            {attention === 0
              ? ja
                ? "現在の条件で返信待ちの候補はありません。活動の変化や保存された記録を確認できます。"
                : "There are no reply candidates under the current conditions. Explore activity or review saved records."
              : attention !== null
                ? ja
                  ? "質問・不具合報告・仲間募集の対象条件に合う投稿です。内容はDiscordで確認してください。"
                  : "Posts matching the support, bug report or group-finding conditions. Open Discord to read each post."
                : ja
                  ? "収集状況を確認してから、必要な対応へ進みましょう。"
                  : "Review data collection before deciding on the next action."}
          </p>
          <div className="home-focus-actions">
            {primary === "attention" ? (
              <button
                type="button"
                className="primary"
                onClick={() => onNavigate(8)}
              >
                {ja ? "要確認を見る" : "Review posts"}
                <span aria-hidden="true"> →</span>
              </button>
            ) : primary === "analysis" ? (
              <button
                type="button"
                className="primary"
                onClick={() => onNavigate(5)}
              >
                {ja ? "分析を見る" : "View analysis"}
                <span aria-hidden="true"> →</span>
              </button>
            ) : primary === "settings" ? (
              <button
                type="button"
                className="primary"
                onClick={() => onNavigate(4)}
              >
                {ja
                  ? "利用状態と接続の案内を見る"
                  : "Review access and connection"}
                <span aria-hidden="true"> →</span>
              </button>
            ) : (
              detailButton(
                ja ? "収集状況を確認する" : "Check collection status",
                true,
              )
            )}
            {(primary === "analysis" || stopped) && attention !== null && (
              <button
                type="button"
                className="home-text-button"
                onClick={() => onNavigate(8)}
              >
                {ja ? "要確認の条件を見る" : "View queue conditions"}
              </button>
            )}
          </div>
          {attention !== null && (
            <p className="home-scope-note">
              {ja
                ? "現在の対象条件・取得範囲に基づく件数です。一覧を開いた時点で件数が変わる場合があります。"
                : "Counts reflect the current conditions and available data. They may change when you open the queue."}
            </p>
          )}
        </section>

        <section className="home-recent" aria-labelledby="home-history-title">
          <div className="home-section-heading">
            <h2 id="home-history-title">
              {ja ? "最近の対応記録" : "Recent response records"}
            </h2>
            <button
              type="button"
              className="home-text-button"
              onClick={() => onNavigate(3)}
            >
              {ja ? "履歴へ" : "History"}
              <span aria-hidden="true"> →</span>
            </button>
          </div>
          {data.results === null ? (
            <p className="home-records-empty">
              {ja
                ? "保存された記録は現在確認できません。"
                : "Saved records are currently unavailable."}
            </p>
          ) : model.records.length === 0 ? (
            <div className="home-records-empty">
              <p>
                {ja
                  ? "表示できる記録はまだありません。"
                  : "No records are available yet."}
              </p>
              <p>
                {ja
                  ? "保存された対応結果や比較を、ここから振り返れます。"
                  : "Return here to review saved response results and comparisons."}
              </p>
            </div>
          ) : (
            <ol className="home-records">
              {model.records.map((record) => {
                const started = record.startedAt
                  ? formattedTime(record.startedAt, locale)
                  : null;
                return (
                  <li key={record.id}>
                    <strong>{recordName(record.name, locale)}</strong>
                    <span className="home-record-state">
                      {recordStates[record.state][ja ? 0 : 1]}
                    </span>
                    {started && (
                      <span className="home-record-time">
                        {ja ? "開始" : "Started"}{" "}
                        <time dateTime={record.startedAt!}>{started}</time>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {data.results !== null && (
            <p className="home-history-note">
              {ja
                ? "現在閲覧できる対応結果・比較の記録です。"
                : "Response results and comparisons you can currently access."}
            </p>
          )}
        </section>
      </div>

      {showActivity && (
        <section
          className="home-activity"
          aria-labelledby="home-activity-title"
        >
          <div>
            <p className="home-section-label">
              {ja ? "活動を知る" : "Understand activity"}
            </p>
            <h2 id="home-activity-title">
              {ja ? "参加の動き" : "Member arrivals"}
            </h2>
            <p>
              {ja
                ? "新規参加者の支援を考える、ひとつの手がかり。"
                : "One starting point for supporting new members."}
            </p>
          </div>
          <dl className="home-activity-values">
            <div>
              <dt>{ja ? "今日の参加" : "Joined today"}</dt>
              <dd>
                {activity.today === null ? (
                  <span className="home-small-value">
                    {ja ? "未確認" : "Unavailable"}
                  </span>
                ) : (
                  <>
                    {activity.today.toLocaleString(locale)}
                    <span>{ja ? "人" : "members"}</span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>{ja ? "昨日の参加" : "Joined yesterday"}</dt>
              <dd>
                {activity.yesterday === null ? (
                  <span className="home-small-value">
                    {ja ? "未確認" : "Unavailable"}
                  </span>
                ) : (
                  <>
                    {activity.yesterday.toLocaleString(locale)}
                    <span>{ja ? "人" : "members"}</span>
                  </>
                )}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="home-text-button"
            onClick={() => onNavigate(5)}
          >
            {ja ? "分析を見る" : "View analysis"}
            <span aria-hidden="true"> →</span>
          </button>
          <p className="home-activity-note">
            {ja
              ? "今日は集計途中です。スタッフを除く対象メンバーの参加を集計しています。"
              : "Today is still in progress. Counts include eligible member arrivals, excluding staff."}
            {activity.timezone && (
              <>
                {" "}
                {ja ? "日付の基準" : "Dates use"}: {activity.timezone}.
              </>
            )}
          </p>
        </section>
      )}

      <footer className="home-footnote">
        <p>
          {ja
            ? "詳しい分析の種類・条件確認・保存した分析履歴は、DiscordのNEXUSパネルから開けます。"
            : "Open the NEXUS panel in Discord for detailed analysis types, condition previews and saved analysis history."}
        </p>
        <a className="home-text-button" href="/support#product-info">
          {ja ? "使い方と制約" : "Help and limitations"}
          <span aria-hidden="true"> →</span>
        </a>
      </footer>
    </section>
  );
}
