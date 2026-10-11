"use client";
import type { Ref } from "react";
import { attentionReason } from "../../../packages/shared/src/attention-copy";
import type { AttentionPage } from "../../../packages/operations/src/attention-queue";
import "./attention.css";
export type AttentionPost = {
  channelId: string;
  messageId: string;
  url: string;
  waitingMinutes: number;
  status: string;
  surface?: string;
  purpose?: string;
  version?: number;
  postedAt?: string;
  snoozeUntil?: string | null;
  response?: string | null;
};
export type AttentionFilter = { state: string; channelId: string };
export function Attention({
  ready,
  items,
  locale,
  channels,
  minutes,
  busy = false,
  snooze = {},
  onChange,
  onSnooze,
  onRefresh,
  onRules,
  page,
  filters = { state: "ACTIVE", channelId: "" },
  onFilter,
  onPage,
  loading = false,
  failed = false,
  loadError,
  canOperate = true,
  summaryRef,
}: {
  ready: boolean;
  items: AttentionPost[];
  locale: "ja" | "en";
  channels: { id: string; label: string }[];
  minutes: number;
  busy?: boolean;
  snooze?: Record<string, "30" | "60" | "today">;
  onChange: (
    item: AttentionPost,
    status: "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED",
  ) => void;
  onSnooze: (id: string, value: "30" | "60" | "today") => void;
  onRefresh: () => void;
  onRules: () => void;
  page?: Pick<
    AttentionPage,
    "total" | "asOf" | "nextCursor" | "previousCursor" | "firstCursor"
  > | null;
  filters?: AttentionFilter;
  onFilter?: (filter: AttentionFilter) => void;
  onPage?: (cursor: string) => void;
  loading?: boolean;
  failed?: boolean;
  loadError?: string | null;
  canOperate?: boolean;
  summaryRef?: Ref<HTMLDivElement>;
}) {
  const ja = locale === "ja",
    copy = (a: string, b: string) => (ja ? a : b);
  const status = (item: AttentionPost) =>
    item.status === "RESOLVED"
      ? item.response === "REPLY"
        ? copy("返信を確認", "Reply detected")
        : item.response === "PARTICIPATION"
          ? copy("参加を確認", "Participation detected")
          : item.response === "UNKNOWN"
            ? copy("反応の記録あり", "Response recorded")
            : copy("対応済み", "Marked as handled")
      : item.status === "SNOOZED"
        ? copy("保留中", "Snoozed")
        : item.status === "IN_PROGRESS"
          ? copy("対応中", "In progress")
          : item.status === "ACKNOWLEDGED"
            ? copy("確認を記録済み", "Acknowledged by staff")
            : copy("未確認", "Needs review");
  const date = (value: string) =>
    new Date(value).toLocaleString(ja ? "ja-JP" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <section className="surface attention-view" aria-busy={busy || loading}>
      <div className="page-head">
        <div>
          <p className="eyebrow">ATTENTION</p>
          <h1>{copy("返信を確認したい投稿", "Posts to review")}</h1>
          <p>
            {copy(
              "投稿をDiscordで確認し、運営側の対応を記録します。",
              "Review the post in Discord, then record your team's response.",
            )}
          </p>
        </div>
        <button
          className="button-secondary"
          disabled={loading || busy}
          onClick={onRefresh}
        >
          {copy("更新", "Refresh")}
        </button>
      </div>
      <details className="attention-scope">
        <summary>
          {copy(
            `対象: サポート・不具合相談・募集 · ${minutes}分`,
            `Support, bug reports & LFG · ${minutes}-minute wait`,
          )}
        </summary>
        <p>
          {copy(
            `サポート・不具合相談・募集の対象チャンネル。新しい候補は過去24時間の投稿から、設定した${minutes}分を過ぎたものを検出します。`,
            `Eligible support, bug report and LFG channels. New candidates come from posts in the past 24 hours that have passed the configured ${minutes}-minute wait.`,
          )}
        </p>
        <button className="attention-text-button" onClick={onRules}>
          {copy("対象条件を見る", "View detection rules")}
        </button>
      </details>
      {!ready && !failed && (
        <div className="collection-warning" role="status">
          <strong>
            {copy(
              "新しい候補を確認できません",
              "New candidates cannot be determined",
            )}
          </strong>
          <p>
            {copy(
              "現在の収集状態では新しい返信を判断できません。閲覧できる保存済みの候補を表示します。",
              "Current collection cannot establish new responses. Saved candidates remain available where you have access.",
            )}
          </p>
        </div>
      )}
      {onFilter && (
        <div className="attention-filters">
          <label>
            {copy("状態", "State")}
            <select
              value={filters.state}
              disabled={busy}
              onChange={(e) => onFilter({ ...filters, state: e.target.value })}
            >
              {[
                ["ACTIVE", "対応前・対応中", "Active"],
                ["OPEN", "未確認", "Needs review"],
                ["ACKNOWLEDGED", "確認を記録済み", "Acknowledged"],
                ["IN_PROGRESS", "対応中", "In progress"],
                ["SNOOZED", "保留中", "Snoozed"],
                [
                  "RESOLVED",
                  "返信・参加の確認／対応済み",
                  "Response detected / handled",
                ],
              ].map(([value, jaText, en]) => (
                <option key={value} value={value}>
                  {ja ? jaText : en}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy("対象チャンネル", "Channel")}
            <select
              value={filters.channelId}
              disabled={busy}
              onChange={(e) =>
                onFilter({ ...filters, channelId: e.target.value })
              }
            >
              <option value="">
                {copy(
                  "閲覧できる対象すべて",
                  "All eligible channels you can view",
                )}
              </option>
              {channels.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {page && !failed && (
        <div
          className="attention-summary"
          role="status"
          ref={summaryRef}
          tabIndex={-1}
        >
          <p>
            <strong>{items.length}</strong>
            {copy(
              "件を表示 / この条件の保存済み候補 ",
              " shown / saved candidates matching these filters: ",
            )}
            <strong>{page.total}</strong>
            {ja ? "件" : ""}
          </p>
          <p>
            {copy("一覧の対象時点：", "List as of: ")}
            {date(page.asOf)}
            <span>
              {copy(
                "新しい候補は「更新」で取り込みます。権限・状態の変更や削除は随時反映されます。",
                "Refresh to include new candidates. Access, state changes and deletions are checked each time.",
              )}
            </span>
          </p>
        </div>
      )}
      {loading ? (
        <p className="attention-loading" role="status">
          {copy(
            "閲覧権限と候補を確認しています…",
            "Checking access and loading candidates…",
          )}
        </p>
      ) : failed ? (
        <div className="empty-state" role="status">
          <h2>
            {copy(
              "候補を取得できませんでした",
              "The candidate list could not be loaded",
            )}
          </h2>
          <p>
            {loadError === "ATTENTION_CURSOR_EXPIRED"
              ? copy(
                  "一覧の有効期間が終了したか、削除により更新が必要になりました。「更新」で現在の候補を確認してください。",
                  "This list has expired or needs refreshing after a deletion. Refresh to check the current candidates.",
                )
              : loadError === "ATTENTION_SCOPE_TOO_LARGE"
                ? copy(
                    "対象が多いため一覧を作成できません。チャンネルや状態で絞り込んでください。",
                    "There are too many candidates for one list. Narrow the channel or state filter.",
                  )
                : copy(
                    "件数は確認できません。「更新」で最新の状態を確認してください。",
                    "The count is unavailable. Refresh to check the current list.",
                  )}
          </p>
        </div>
      ) : items.length ? (
        <div className="attention-list">
          {items.map((item) => (
            <article className="attention-card" key={item.messageId}>
              <div className="attention-post">
                <div className="attention-item-heading">
                  <h2>
                    {channels.find((c) => c.id === item.channelId)?.label ??
                      `#${item.channelId}`}
                  </h2>
                  <span className="badge">{status(item)}</span>
                </div>
                <p>
                  {item.status === "RESOLVED"
                    ? item.response
                      ? copy(
                          "検出できた反応の記録です。問題の解決を意味しません。",
                          "This records a detected response; it does not establish that the issue is solved.",
                        )
                      : copy(
                          "運営者が対応済みとして記録しました。",
                          "A team member marked this post as handled.",
                        )
                    : attentionReason(item.surface, item.purpose, locale)}
                </p>
                <div className="attention-post-meta">
                  <span>
                    {item.purpose === "LFG"
                      ? copy("募集", "LFG")
                      : item.purpose === "BUG_REPORT"
                        ? copy("不具合相談", "Bug report")
                        : copy("サポート", "Support")}
                  </span>
                  <span>
                    {copy("投稿から ", "Posted ")}
                    {item.waitingMinutes}
                    {copy("分", " min ago")}
                  </span>
                  {item.postedAt && (
                    <time dateTime={item.postedAt}>{date(item.postedAt)}</time>
                  )}
                </div>
                {item.status === "SNOOZED" && item.snoozeUntil && (
                  <p className="attention-post-meta">
                    {copy("保留期限：", "Snoozed until: ")}
                    {date(item.snoozeUntil)}
                    {copy(
                      "。収集処理の再開後、対象に戻ります。",
                      ". Returns to the queue when collection processing resumes.",
                    )}
                  </p>
                )}
              </div>
              <div className="attention-actions">
                <a
                  className="button"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {copy("Discordで確認", "Open in Discord")}
                  <span aria-hidden="true"> ↗</span>
                </a>
                {canOperate &&
                  !["RESOLVED", "DISMISSED"].includes(item.status) && (
                    <details className="attention-record">
                      <summary>
                        {copy("対応を記録", "Record a response")}
                      </summary>
                      <div>
                        <p>
                          {copy(
                            "運営者の記録です。返信や問題解決の自動判定にはなりません。",
                            "These are staff records, not automatic confirmation of a reply or resolution.",
                          )}
                        </p>
                        <button
                          className="button-secondary"
                          disabled={busy || item.status === "ACKNOWLEDGED"}
                          onClick={() => onChange(item, "ACKNOWLEDGED")}
                        >
                          {copy("確認したことを記録", "Mark as acknowledged")}
                        </button>
                        <label>
                          {copy("保留する期間", "Snooze for")}
                          <select
                            value={snooze[item.messageId] ?? "30"}
                            disabled={busy || item.status === "SNOOZED"}
                            onChange={(e) =>
                              onSnooze(
                                item.messageId,
                                e.target.value as "30" | "60" | "today",
                              )
                            }
                          >
                            <option value="30">
                              {copy("30分", "30 minutes")}
                            </option>
                            <option value="60">
                              {copy("1時間", "1 hour")}
                            </option>
                            <option value="today">
                              {copy(
                                "今日いっぱい（サーバーの時刻）",
                                "Rest of today (server time)",
                              )}
                            </option>
                          </select>
                        </label>
                        <button
                          className="button-secondary"
                          disabled={busy || item.status === "SNOOZED"}
                          onClick={() => onChange(item, "SNOOZED")}
                        >
                          {copy("保留する", "Snooze")}
                        </button>
                        {item.status === "SNOOZED" && (
                          <p>
                            {copy(
                              "保留中の期限はここでは変更できません。確認や対応済みの記録はできます。",
                              "The existing snooze deadline cannot be changed here. You can still acknowledge or mark the post as handled.",
                            )}
                          </p>
                        )}
                        <button
                          className="button-secondary"
                          disabled={busy}
                          onClick={() => onChange(item, "RESOLVED")}
                        >
                          {copy("対応済みとして記録", "Mark as handled")}
                        </button>
                      </div>
                    </details>
                  )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>
            {page && page.total > 0
              ? copy(
                  "このページに表示できる投稿はありません",
                  "No posts remain on this page",
                )
              : filters.state === "ACTIVE"
                ? copy(
                    "現在の条件で返信待ちの候補はありません",
                    "No posts are awaiting a response under the current conditions",
                  )
                : copy(
                    "この条件に合う保存済みの候補はありません",
                    "No saved candidates match these filters",
                  )}
          </h2>
          <p>
            {page && page.total > 0
              ? copy(
                  "状態や閲覧権限の変更、削除により、このページの投稿がなくなりました。「先頭へ」や「前へ」で残りの候補を確認してください。",
                  "Posts on this page are no longer available after state, access or deletion changes. Use First or Previous to review the remaining candidates.",
                )
              : copy(
                  "取得範囲内の結果です。コミュニティ全体に問題がないことを示すものではありません。",
                  "This describes the available data, not the absence of issues across the community.",
                )}
          </p>
        </div>
      )}
      {!canOperate && !failed && (
        <p className="attention-readonly">
          {copy(
            "現在の権限と利用状態では、対応の記録を変更できません。",
            "Recording a response is unavailable with your current permissions and access state.",
          )}
        </p>
      )}
      {page && onPage && !failed && (
        <nav
          className="attention-pagination"
          aria-label={copy("候補一覧のページ送り", "Candidate list pagination")}
        >
          <button
            className="button-secondary"
            disabled={
              loading ||
              busy ||
              (!page.previousCursor && !(items.length === 0 && page.total > 0))
            }
            onClick={() => onPage(page.firstCursor)}
          >
            {copy("先頭へ", "First")}
          </button>
          <button
            className="button-secondary"
            disabled={loading || busy || !page.previousCursor}
            onClick={() => page.previousCursor && onPage(page.previousCursor)}
          >
            {copy("前へ", "Previous")}
          </button>
          <button
            disabled={loading || busy || !page.nextCursor}
            onClick={() => page.nextCursor && onPage(page.nextCursor)}
          >
            {copy("次へ", "Next")}
          </button>
        </nav>
      )}
    </section>
  );
}
