"use client";
import { t } from "../../../packages/discord-panels/src/i18n";
import { attentionReason } from "../../../packages/shared/src/attention-copy";
export type AttentionPost = {
  channelId: string;
  messageId: string;
  url: string;
  waitingMinutes: number;
  status: string;
  surface?: string;
  purpose?: string;
};
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
}) {
  return (
    <section className="surface attention-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">ATTENTION</p>
          <h1>{t(locale, "control.attention")}</h1>
        </div>
        <button onClick={onRefresh}>{t(locale, "control.refresh")}</button>
      </div>
      {!ready && (
        <div className="collection-warning" role="status">
          <h2>
            {locale === "ja"
              ? "新しい対応対象を確認できません"
              : "New attention items cannot be observed"}
          </h2>
          <p>
            {locale === "ja"
              ? "登録済みの対応は引き続き操作できます。"
              : "Saved attention items remain available."}
          </p>
        </div>
      )}
      {items.length ? (
        <>
          <p>{t(locale, "experience.queueRule", { count: minutes })}</p>
          <div className="attention-list">
            {items.map((item) => (
              <article className="attention-card" key={item.messageId}>
                <div>
                  <span className="badge badge-amber">
                    {item.status === "ACKNOWLEDGED"
                      ? t(locale, "experience.staffAcknowledged")
                      : t(locale, "experience.needsAttention")}
                  </span>
                  <h2>
                    {channels.find((channel) => channel.id === item.channelId)
                      ?.label ?? `#${item.channelId}`}
                  </h2>
                  <p>{attentionReason(item.surface, item.purpose, locale)}</p>
                  <small>
                    {t(locale, "experience.waiting")}:{" "}
                    {t(locale, "control.minutes", {
                      count: item.waitingMinutes,
                    })}
                  </small>
                </div>
                <div className="attention-actions">
                  <a
                    className="button button-secondary"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t(locale, "experience.openPost")} ↗
                  </a>
                  <button
                    disabled={busy || item.status === "ACKNOWLEDGED"}
                    onClick={() => onChange(item, "ACKNOWLEDGED")}
                  >
                    {t(locale, "experience.ack")}
                  </button>
                  <label>
                    {t(locale, "experience.snooze")}
                    <select
                      value={snooze[item.messageId] ?? "30"}
                      onChange={(event) =>
                        onSnooze(
                          item.messageId,
                          event.target.value as "30" | "60" | "today",
                        )
                      }
                    >
                      <option value="30">30 min</option>
                      <option value="60">1 hour</option>
                      <option value="today">
                        {locale === "ja" ? "今日いっぱい" : "Today"}
                      </option>
                    </select>
                  </label>
                  <button
                    disabled={busy}
                    onClick={() => onChange(item, "SNOOZED")}
                  >
                    {t(locale, "experience.snooze")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => onChange(item, "RESOLVED")}
                  >
                    {t(locale, "experience.resolve")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : ready ? (
        <div className="empty-state">
          <h2>✅ {t(locale, "experience.allClear")}</h2>
          <p>{t(locale, "experience.queueRule", { count: minutes })}</p>
          <button onClick={onRules}>
            {t(locale, "experience.howMeasured")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
