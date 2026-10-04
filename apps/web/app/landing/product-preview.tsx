"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Icon, NexusMark } from "./primitives";
import { text, type Locale } from "./content";

const views = ["overview", "attention", "evidence"] as const;
type View = (typeof views)[number];

// A responsive reproduction of shipped dashboard fields, using illustrative data.
// View selection is the only interaction; this preview never mutates a real server.
export function ProductPreview({ locale }: { locale: Locale }) {
  const [view, setView] = useState<View>("overview");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const labels = [
    text(locale, "Overview", "概要"),
    text(locale, "Attention", "対応"),
    text(locale, "Evidence", "測定根拠"),
  ];
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft")
      next = (index + views.length - 1) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault();
    setView(views[next]!);
    buttons.current[next]?.focus();
  }
  return (
    <figure
      className="nx-product-preview"
      aria-label={text(
        locale,
        "NEXUS product preview with example data",
        "NEXUS製品画面のサンプルデータ付きプレビュー",
      )}
    >
      <figcaption className="nx-preview-caption">
        <span>
          <NexusMark size={18} /> NEXUS
        </span>
        <span>
          {text(
            locale,
            "Product preview · Example data",
            "製品プレビュー · サンプルデータ",
          )}
        </span>
      </figcaption>
      <div className="nx-preview-shell">
        <div className="nx-preview-sidebar" aria-hidden="true">
          <div className="nx-example-server">
            C
            <span>
              Community
              <br />
              <small>
                {text(locale, "Example server", "サンプルサーバー")}
              </small>
            </span>
          </div>
          {(
            [
              ["chart", "Overview", "概要"],
              ["activity", "New members", "新しいメンバー"],
              ["message", "Attention", "対応"],
              ["flow", "Journey", "Journey"],
              ["layers", "Insights", "分析"],
              ["settings", "Settings", "設定"],
            ] as const
          ).map(([icon, en, ja], i) => (
            <span
              key={en}
              className={
                i === (view === "attention" ? 2 : 0) ? "nx-sidebar-active" : ""
              }
            >
              <Icon name={icon} size={15} />
              {text(locale, en, ja)}
            </span>
          ))}
          <p>Discord + Web</p>
        </div>
        <div className="nx-preview-main">
          <div
            className="nx-preview-tabs"
            role="tablist"
            aria-label={text(
              locale,
              "Product preview views",
              "製品プレビューの表示切替",
            )}
          >
            {views.map((id, index) => (
              <button
                key={id}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                role="tab"
                id={`preview-tab-${id}`}
                aria-controls={`preview-panel-${id}`}
                aria-selected={view === id}
                tabIndex={view === id ? 0 : -1}
                onClick={() => setView(id)}
                onKeyDown={(event) => keyboard(event, index)}
              >
                {labels[index]}
              </button>
            ))}
          </div>
          {views.map((id) => (
            <div
              key={id}
              id={`preview-panel-${id}`}
              role="tabpanel"
              aria-labelledby={`preview-tab-${id}`}
              hidden={view !== id}
              tabIndex={0}
            >
              {id === "overview" ? (
                <>
                  <div className="nx-preview-heading">
                    <div>
                      <small>
                        {text(locale, "SERVER OVERVIEW", "サーバー概要")}
                      </small>
                      <h2>
                        {text(
                          locale,
                          "Newcomer activity",
                          "新規メンバーの活動",
                        )}
                      </h2>
                    </div>
                    <span className="nx-preview-period">
                      {text(locale, "Completed cohort", "観測完了の対象者")}
                    </span>
                  </div>
                  <div className="nx-preview-metrics">
                    <div>
                      <span>
                        {text(
                          locale,
                          "Eligible newcomers",
                          "対象の新規メンバー",
                        )}
                      </span>
                      <strong>38</strong>
                      <small>
                        {text(
                          locale,
                          "72-hour observation complete",
                          "72時間の観測完了",
                        )}
                      </small>
                    </div>
                    <div>
                      <span>
                        {text(locale, "First connections", "最初の交流")}
                      </span>
                      <strong>
                        28<span> / 38</span>
                      </strong>
                      <small>
                        {text(
                          locale,
                          "Within 72 hours",
                          "参加資格から72時間以内",
                        )}
                      </small>
                    </div>
                  </div>
                  <div className="nx-preview-card nx-preview-attention">
                    <span className="nx-status-amber">
                      <Icon name="clock" size={14} />
                      {text(locale, "Needs attention", "対応が必要")}
                    </span>
                    <h3>
                      {text(
                        locale,
                        "2 posts are waiting for a reply",
                        "2件の投稿が返信待ちです",
                      )}
                    </h3>
                    <p>
                      {text(
                        locale,
                        "No direct reply observed after the configured delay.",
                        "設定した待ち時間を過ぎても直接返信が確認できていません。",
                      )}
                    </p>
                    <button
                      onClick={() => {
                        setView("attention");
                        buttons.current[1]?.focus();
                      }}
                    >
                      {text(locale, "Review attention items", "対応一覧を確認")}
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                  <div className="nx-preview-footnote">
                    <Icon name="layers" size={14} />
                    {text(
                      locale,
                      "Observation period and sample shown with each metric.",
                      "指標ごとに観測期間と対象人数を表示。",
                    )}
                  </div>
                </>
              ) : id === "attention" ? (
                <>
                  <div className="nx-preview-heading">
                    <div>
                      <small>ATTENTION</small>
                      <h2>
                        {text(
                          locale,
                          "Posts needing a reply",
                          "返信が必要な投稿",
                        )}
                      </h2>
                    </div>
                  </div>
                  <p className="nx-preview-rule">
                    {text(
                      locale,
                      "Newcomer posts without a direct reply after 30 minutes.",
                      "30分を過ぎても直接返信が確認できない新規メンバーの投稿。",
                    )}
                  </p>
                  {[
                    ["#introductions", "45", "Needs attention", "対応が必要"],
                    ["#help", "62", "Staff acknowledged", "スタッフ確認済み"],
                  ].map(([channel, minutes, en, ja]) => (
                    <div
                      className="nx-preview-card nx-queue-item"
                      key={channel}
                    >
                      <div>
                        <span className="nx-status-amber">
                          {text(locale, en, ja)}
                        </span>
                        <h3>{channel}</h3>
                        <p>
                          {text(
                            locale,
                            `Waiting: ${minutes} min`,
                            `待ち時間：${minutes}分`,
                          )}
                        </p>
                      </div>
                      <Icon name="message" size={20} />
                    </div>
                  ))}
                  <p className="nx-preview-footnote">
                    {text(
                      locale,
                      "In the app: open the post, acknowledge, snooze or resolve.",
                      "アプリでは投稿を開き、確認・再確認・対応済みを操作できます。",
                    )}
                  </p>
                </>
              ) : (
                <>
                  <div className="nx-preview-heading">
                    <div>
                      <small>
                        {text(locale, "MEASUREMENT EVIDENCE", "測定根拠")}
                      </small>
                      <h2>
                        {text(
                          locale,
                          "Understand the observation",
                          "観測の条件を確認",
                        )}
                      </h2>
                    </div>
                  </div>
                  <dl className="nx-preview-evidence">
                    <div>
                      <dt>{text(locale, "Metric", "指標")}</dt>
                      <dd>{text(locale, "First connections", "最初の交流")}</dd>
                    </div>
                    <div>
                      <dt>{text(locale, "Observation window", "観測期間")}</dt>
                      <dd>
                        {text(
                          locale,
                          "72 hours after eligibility",
                          "参加資格から72時間",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {text(
                          locale,
                          "Completed example cohort",
                          "観測完了のサンプル対象人数",
                        )}
                      </dt>
                      <dd>38</dd>
                    </div>
                    <div>
                      <dt>{text(locale, "Reply exclusions", "返信の除外")}</dt>
                      <dd>
                        {text(
                          locale,
                          "Bots and self-replies",
                          "Bot・自分への返信",
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="nx-preview-card">
                    <h3>
                      {text(locale, "Limits stay visible", "観測の限界も表示")}
                    </h3>
                    <p>
                      {text(
                        locale,
                        "Small samples and incomplete observations are labeled. Voice co-presence does not prove conversation.",
                        "人数不足や観測途中を区別します。Voice同席は会話の証明ではありません。",
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
