"use client";
import type { MetricEvidence } from "../../../packages/shared/src/metric-evidence";
import type { AdaptivePresentation } from "../../../packages/presentation/src/adaptive";
import type { TeamOperations } from "../../../packages/operations/src/attention";
import type { integrationOperations } from "../../../packages/operations/src/integration";
import type {
  CollectionEpoch,
  IntegrationHealth,
} from "../../../packages/shared/src/integration-health";
import {
  evidenceValue,
  evidenceNote,
  coverageNames,
} from "../../../packages/shared/src/measurement-view";
import { recipeNames } from "../../../packages/shared/src/operations-copy";
export type IntegrationData = Awaited<
  ReturnType<typeof integrationOperations>
> & { health: IntegrationHealth; epochs: CollectionEpoch[] };
type Locale = "ja" | "en";
export function EvidenceDetails({
  evidence,
  locale,
}: {
  evidence: MetricEvidence | undefined;
  locale: Locale;
}) {
  const ja = locale === "ja";
  return (
    <details className="evidence-method">
      <summary>{ja ? "計測方法を見る" : "Measurement method"}</summary>
      {evidence ? (
        <>
          <p>{evidence.definition}</p>
          <p>{evidenceNote(evidence, locale)}</p>
          <p>
            {ja ? "集計期間" : "Observation window"}:{" "}
            {evidence.windowStart.slice(0, 10)} —{" "}
            {evidence.windowEnd.slice(0, 10)}
          </p>
          <p>
            {ja ? "定義" : "Definition"}: {evidence.definitionVersion}
          </p>
          <p>
            {ja ? "必要な観測" : "Required observations"}:{" "}
            {evidence.requiredSurfaces.join(" · ")}
          </p>
          <p>
            {evidence.comparable
              ? ja
                ? "期間比較に使用できます"
                : "Eligible for period comparison"
              : ja
                ? "このデータは期間比較に使用しません"
                : "This data is excluded from period comparison"}
          </p>
          {evidence.coverageReasons.length > 0 && (
            <p>
              {ja ? "詳細な計測状態" : "Detailed collection state"}:{" "}
              {evidence.coverageReasons.join(" · ")}
            </p>
          )}
        </>
      ) : (
        <p>
          {ja
            ? "計測の根拠がまだありません。"
            : "Measurement evidence is not available yet."}
        </p>
      )}
    </details>
  );
}
export function IntegrationWarning({
  health,
  locale,
}: {
  health: IntegrationHealth | undefined;
  locale: Locale;
}) {
  if (!health?.severe) return null;
  const ja = locale === "ja";
  return (
    <aside className="collection-warning" role="status">
      <strong>
        {ja ? "計測を一部停止しています" : "Some measurements are paused"}
      </strong>
      <p>
        {health.intents.members !== "AVAILABLE"
          ? ja
            ? "Discordから必要なメンバー情報を正常に受信できていません。新規メンバー分析を確認できない期間は比較に使用しません。"
            : "Required member information is unavailable. Affected new member analysis is excluded from comparisons."
          : ja
            ? "Discordとの接続を確認できません。この期間のデータは比較に使用しません。"
            : "The Discord connection is unavailable. This period is excluded from comparisons."}
      </p>
    </aside>
  );
}
export function JourneysView({
  model,
  locale,
  compact = false,
}: {
  model: AdaptivePresentation;
  locale: Locale;
  compact?: boolean;
}) {
  const ja = locale === "ja",
    rows = model.journeys?.transitions ?? [];
  return (
    <section className="surface journeys-view" data-testid="journeys">
      <h2>{ja ? "参加後の変化" : "Participation transitions"}</h2>
      <p>
        {ja
          ? "サーバーの目的ごとに、確認できた変化を集計します。"
          : "Aggregate observed transitions for the community’s purpose."}
      </p>
      {rows.length ? (
        <div className="transition-list">
          {rows.slice(0, compact ? 3 : 20).map((row) => (
            <article key={row.from + row.to}>
              <h3>
                {row.fromLabel[ja ? 0 : 1]} <span aria-hidden="true">→</span>{" "}
                {row.toLabel[ja ? 0 : 1]}
              </h3>
              <strong>{evidenceValue(row.evidence, locale, true)}</strong>
              {row.evidence.numerator !== null &&
                row.evidence.denominator !== null &&
                row.evidence.denominator > 0 && (
                  <p>
                    {row.evidence.numerator} / {row.evidence.denominator}
                  </p>
                )}
              <p>{evidenceNote(row.evidence, locale)}</p>
              <EvidenceDetails evidence={row.evidence} locale={locale} />
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>
            {ja
              ? "まだ比較できるデータがありません。Community Modelで目的と計測方法を確認してください。"
              : "No comparable data yet. Confirm the purpose and measurement recipe in Community Model."}
          </p>
        </div>
      )}
    </section>
  );
}
export function TeamQueue({
  operations,
  locale,
}: {
  operations: TeamOperations | undefined;
  locale: Locale;
}) {
  const ja = locale === "ja";
  if (!operations) return null;
  const duration = (seconds: number | null, sample: number) =>
    seconds === null || sample < 5
      ? ja
        ? "まだ比較できません"
        : "Not ready to compare"
      : `${Math.round(seconds / 60)} ${ja ? "分" : "min"}`;
  return (
    <section className="surface team-queue" data-testid="team-queue">
      <h2>{ja ? "運営チームの対応状況" : "Team queue"}</h2>
      <div className="cards">
        <article>
          <h3>{ja ? "対応待ち" : "Open backlog"}</h3>
          <strong>{operations.openBacklog}</strong>
          <p>{ja ? "登録済みの対応項目" : "Saved attention items"}</p>
        </article>
        <article>
          <h3>{ja ? "確認までの中央値" : "Median acknowledgement time"}</h3>
          <strong>
            {duration(
              operations.medianAcknowledgementSeconds,
              operations.acknowledgementSample,
            )}
          </strong>
        </article>
        <article>
          <h3>{ja ? "完了までの中央値" : "Median resolution time"}</h3>
          <strong>
            {duration(
              operations.medianResolutionSeconds,
              operations.resolutionSample,
            )}
          </strong>
          <p>
            p75:{" "}
            {duration(
              operations.p75ResolutionSeconds,
              operations.resolutionSample,
            )}
          </p>
        </article>
      </div>
      <p>
        {ja ? "新しく登録" : "Items opened"} {operations.itemsOpened} ·{" "}
        {ja ? "完了" : "Resolved"} {operations.itemsResolved} ·{" "}
        {ja ? "保留" : "Snoozed"} {operations.snoozed}
      </p>
      {operations.oldestOpenAt && (
        <p>
          {ja ? "最も古い未完了項目" : "Oldest open item"}:{" "}
          {new Date(operations.oldestOpenAt).toLocaleString(locale)}
        </p>
      )}
      {(operations.surfaceBreakdown ?? []).length > 0 && (
        <ul>
          {operations.surfaceBreakdown.map((row) => (
            <li key={row.type + row.surface}>
              {
                (
                  {
                    TEXT_NEWCOMER: ja
                      ? "新規メンバーの投稿"
                      : "New member posts",
                    FORUM_SUPPORT: ja ? "質問・サポート" : "Support posts",
                    LFG_RESPONSE: ja ? "仲間募集" : "LFG posts",
                    EVENT_OPERATION: ja ? "イベント運営" : "Event operations",
                    INTEGRATION_HEALTH: ja
                      ? "Discordとの接続状態"
                      : "Discord integration",
                  } as Record<string, string>
                )[row.type]
              }{" "}
              · {row.open}
            </li>
          ))}
        </ul>
      )}
      <p>
        {ja
          ? "個人別のスタッフ評価は行いません。"
          : "No individual staff productivity ranking."}
      </p>
    </section>
  );
}
export function RecommendationsView({
  model,
  locale,
  onSettings,
}: {
  model: AdaptivePresentation;
  locale: Locale;
  onSettings?: () => void;
}) {
  const ja = locale === "ja",
    rows = model.recommendations ?? [];
  return (
    <section className="surface recommendations">
      <h2>{ja ? "改善の確認" : "Review improvements"}</h2>
      {rows.length ? (
        rows.map((row) => (
          <article key={row.id}>
            <h3>
              {ja
                ? "初回応答にかかる時間が長くなっています"
                : "First human response took longer"}
            </h3>
            <p>
              {ja ? "前の比較期間" : "Previous comparable period"}{" "}
              {row.evidence[1]?.value} min → {ja ? "今回" : "Current"}{" "}
              {row.evidence[0]?.value} min
            </p>
            <p>
              {ja
                ? "応答を待つ投稿の確認が必要です。原因は特定していません。"
                : "Waiting posts need review. The cause has not been established."}
            </p>
            <p>
              {ja
                ? `返信待ち通知の基準を${row.proposedAction.minutes}分に設定する案を確認できます。`
                : `Review a ${row.proposedAction.minutes}-minute notification threshold.`}
            </p>
            <p>
              {ja
                ? `変更後${row.expectedMeasurement.reviewAfterDays}日を目安に、同じ定義の初回応答時間を比較します。`
                : `Compare first response time using the same definition after ${row.expectedMeasurement.reviewAfterDays} days.`}
            </p>
            <EvidenceDetails evidence={row.evidence[0]} locale={locale} />
            <button onClick={onSettings}>
              {ja ? "設定を見る" : "Review settings"}
            </button>
          </article>
        ))
      ) : (
        <p>
          {ja
            ? "現在、比較の条件を満たす改善提案はありません。人数・計測範囲・接続状態がそろった期間だけ提案を表示します。"
            : "No improvement recommendation meets the comparison requirements yet. Sufficient sample, coverage, and collection continuity are required."}
        </p>
      )}
    </section>
  );
}
export function OperationsView({
  data,
  model,
  locale,
  view,
  channels = [],
}: {
  data: IntegrationData | null | undefined;
  model: AdaptivePresentation | undefined;
  locale: Locale;
  view: number;
  channels?: { id: string; label: string }[];
}) {
  const ja = locale === "ja",
    health = data?.health ?? model?.integration,
    snapshot = model?.capabilities,
    coverage = data?.coverage ?? snapshot?.coverage;
  const state = (value: string | undefined) =>
    value === "AVAILABLE" || value === "CONNECTED"
      ? ja
        ? "正常"
        : "Available"
      : value === "UNAVAILABLE" || value === "DISCONNECTED"
        ? ja
          ? "利用できません"
          : "Unavailable"
        : ja
          ? "未確認"
          : "Unknown";
  const title =
    view === 13
      ? ja
        ? "計測範囲"
        : "Data coverage"
      : view === 14
        ? ja
          ? "観測の連続性"
          : "Collection health"
        : ja
          ? "Discordとの接続状態"
          : "Discord integration";
  return (
    <section className="surface operations-view">
      <h1>{title}</h1>
      <IntegrationWarning health={health} locale={locale} />
      {view === 12 ? (
        <>
          <dl className="integration-list">
            <dt>Gateway</dt>
            <dd>{state(health?.gateway)}</dd>
            {(
              [
                "members",
                "messages",
                "reactions",
                "polls",
                "voice",
                "scheduledEvents",
                "autoMod",
              ] as const
            ).map((key, i) => (
              <div key={key}>
                <dt>
                  {
                    (ja
                      ? [
                          "メンバー情報",
                          "Guildのメッセージ",
                          "Reaction",
                          "Poll",
                          "Voice参加状態",
                          "Scheduled Events",
                          "AutoMod context",
                        ]
                      : [
                          "Guild Members",
                          "Guild Messages",
                          "Reactions",
                          "Polls",
                          "Voice States",
                          "Scheduled Events",
                          "AutoMod context",
                        ])[i]
                  }
                </dt>
                <dd>{state(health?.intents[key])}</dd>
              </div>
            ))}
            <dt>REST</dt>
            <dd>{state(health?.rest)}</dd>
          </dl>
          <p>
            {ja ? "機能確認の最終成功" : "Last successful discovery"}:{" "}
            {health?.lastSuccessfulRefresh
              ? new Date(health.lastSuccessfulRefresh).toLocaleString(locale)
              : ja
                ? "未確認"
                : "Unknown"}
          </p>
          <p>
            {health?.capabilityFresh
              ? ja
                ? "機能確認は最新です"
                : "Capability discovery is current"
              : ja
                ? "機能確認の更新が必要です"
                : "Capability discovery needs refresh"}
          </p>
          {data && (
            <p>
              {ja ? "処理待ちイベント" : "Pending events"}{" "}
              {data.queues.gateway_pending} ·{" "}
              {ja ? "Discordへの反映待ち" : "Pending Discord writes"}{" "}
              {data.queues.outbox_pending} ·{" "}
              {ja ? "結果確認が必要" : "Unknown write outcomes"}{" "}
              {data.queues.outbox_unknown}
            </p>
          )}
        </>
      ) : view === 13 ? (
        <>
          <div className="cards">
            <article>
              <h2>
                {ja
                  ? "NEXUSが確認できるチャンネル"
                  : "Channels NEXUS can observe"}
              </h2>
              <strong>
                {coverage?.observableChannels ?? state(undefined)}
              </strong>
            </article>
            <article>
              <h2>
                {ja
                  ? "サーバー全体のチャンネル数"
                  : "Server-wide channel total"}
              </h2>
              <strong>
                {coverage?.totalState === "KNOWN"
                  ? coverage.knownTotalChannels
                  : ja
                    ? "Discordから確認できません"
                    : "Unavailable from Discord"}
              </strong>
            </article>
          </div>
          <p>
            {coverage
              ? coverageNames[coverage.coverageState ?? "UNKNOWN"][ja ? 0 : 1]
              : state(undefined)}
          </p>
          <h2>
            {ja ? "観測できない場所の影響" : "Unobservable channel impact"}
          </h2>
          {data?.inspector
            .filter((c) => !c.observable)
            .map((c) => (
              <article key={c.channelId}>
                <h3>
                  {channels.find((ch) => ch.id === c.channelId)?.label ??
                    (ja ? "確認できないチャンネル" : "Unobservable channel")}
                </h3>
                <p>
                  {ja
                    ? "不足している権限: チャンネルを見る"
                    : "Missing permission: View Channel"}
                </p>
                <p>
                  {ja
                    ? "この場所の活動・応答は対象の分析に含まれません。"
                    : "Activity and responses on this surface are excluded from affected measurements."}
                </p>
              </article>
            ))}
          <p>
            {ja
              ? "不可視チャンネルがDiscordから省略される場合、一覧や全体数を復元できません。"
              : "Discord may omit invisible channels. NEXUS cannot reconstruct the list or total."}
          </p>
          <div className="cards">
            {model?.metrics.map((m) => (
              <article key={m.key}>
                <h3>{m.evidence?.definition ?? m.definition}</h3>
                <p>{evidenceNote(m.evidence, locale)}</p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <p>
            {ja
              ? "接続の空白や再起動を含む期間は、観測の連続性を確認してから比較します。"
              : "Periods containing connection gaps or restarts require continuity checks before comparison."}
          </p>
          {(data?.epochs ?? model?.epochs ?? []).map((epoch) => (
            <article key={epoch.id}>
              <h3>
                {[
                  "GATEWAY_GAP",
                  "PROCESS_RESTART",
                  "INTENT_UNAVAILABLE",
                ].includes(epoch.startReason)
                  ? ja
                    ? "観測を再開"
                    : "Collection resumed"
                  : ja
                    ? "観測期間"
                    : "Collection period"}
              </h3>
              <p>
                {new Date(epoch.startedAt).toLocaleString(locale)} →{" "}
                {epoch.endedAt
                  ? new Date(epoch.endedAt).toLocaleString(locale)
                  : ja
                    ? "継続中"
                    : "Ongoing"}
              </p>
              <p>
                {epoch.endReason === "GATEWAY_GAP"
                  ? ja
                    ? "接続の空白を確認"
                    : "Connection gap observed"
                  : epoch.endReason === "CAPABILITY_CHANGED"
                    ? ja
                      ? "確認できる機能・場所が変更されました"
                      : "Capabilities or observable surfaces changed"
                    : epoch.endReason === "INTENT_UNAVAILABLE"
                      ? ja
                        ? "必要なIntentを利用できません"
                        : "Required intent unavailable"
                      : ""}
              </p>
            </article>
          ))}
        </>
      )}
      <p>
        {ja
          ? "メンバー情報の利用停止時は、新規メンバー数や参加後の活動を0として表示しません。"
          : "Unavailable member observation does not become zero new members or zero later activity."}
      </p>
      {view === 12 && model?.recipe?.definition && (
        <p>
          {ja ? "現在の計測方法" : "Current recipe"}:{" "}
          {recipeNames[model.recipe.definition.preset][ja ? 0 : 1]}
        </p>
      )}
    </section>
  );
}
