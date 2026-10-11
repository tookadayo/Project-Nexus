"use client";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ObservationChart } from "../observation-chart";
import { demoChart } from "./demo-data";
import { text, type Locale } from "./content";
import { Brand } from "./primitives";
import "./interactive-preview.css";
const views = ["overview", "attention", "evidence"] as const;
export function ProductPreview({ locale }: { locale: Locale }) {
  const [view, setView] = useState<(typeof views)[number]>("overview"),
    [days, setDays] = useState<7 | 30>(7),
    [revision, setRevision] = useState(0),
    id = useId(),
    buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const spec = demoChart(days),
    labels = [
      text(locale, "Overview", "概要"),
      text(locale, "Attention example", "対応の表示例"),
      text(locale, "Evidence", "測定の根拠"),
    ];
  function keyboard(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let n: number;
    if (e.key === "ArrowRight") n = (i + 1) % 3;
    else if (e.key === "ArrowLeft") n = (i + 2) % 3;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = 2;
    else return;
    e.preventDefault();
    setView(views[n]!);
    buttons.current[n]?.focus();
  }
  return (
    <figure
      className="nx-interactive-preview"
      data-testid="interactive-demo"
      aria-label={text(
        locale,
        "Interactive demo with sample data",
        "サンプルデータによる操作デモ",
      )}
    >
      <figcaption>
        <Brand small />
        <span>
          {text(
            locale,
            "Interactive demo with sample data",
            "サンプルデータによる操作デモ",
          )}
        </span>
      </figcaption>
      <p>
        {text(
          locale,
          "Try changing the sample period, selecting values and opening details. These are synthetic observations, not a connected server. No analyses are run or saved.",
          "サンプル期間の切替、値の選択、詳細表示を試せます。接続済みサーバーではなく合成データです。分析の実行・保存は行いません。",
        )}
      </p>
      <div className="nx-demo-controls">
        <label>
          {text(locale, "Sample period", "サンプル期間")}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as 7 | 30)}
          >
            <option value={7}>{text(locale, "7 days", "7日")}</option>
            <option value={30}>{text(locale, "30 days", "30日")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setDays(7);
            setView("overview");
            setRevision((v) => v + 1);
          }}
        >
          {text(locale, "Reset demo", "デモをリセット")}
        </button>
      </div>
      <div
        role="tablist"
        className="nx-demo-tabs"
        aria-label={text(locale, "Demo views", "デモの表示切替")}
      >
        {views.map((v, i) => (
          <button
            key={v}
            type="button"
            ref={(el) => {
              buttons.current[i] = el;
            }}
            id={id + v}
            role="tab"
            aria-selected={view === v}
            aria-controls={id + "panel"}
            tabIndex={view === v ? 0 : -1}
            onClick={() => setView(v)}
            onKeyDown={(e) => keyboard(e, i)}
          >
            {labels[i]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={id + "panel"} aria-labelledby={id + view}>
        {view === "overview" && (
          <ObservationChart
            key={`${days}-${revision}`}
            spec={spec}
            locale={locale}
            compact
          />
        )}
        {view === "attention" && (
          <section className="nx-demo-card">
            <h3>
              {text(
                locale,
                "A post with no response detected",
                "返信を確認できない投稿",
              )}
            </h3>
            <p>
              #sample-help ·{" "}
              {text(locale, "45 minutes since the post", "投稿から45分")}
            </p>
            <details>
              <summary>
                {text(locale, "View sample evidence", "サンプルの根拠を見る")}
              </summary>
              <p>
                {text(
                  locale,
                  "No direct reply was observed within the configured waiting period. This example does not establish whether the member is satisfied or their question is resolved.",
                  "設定した待ち時間内に直接返信は確認できていません。満足や質問の解決を示すものではありません。",
                )}
              </p>
            </details>
            <p>
              {text(
                locale,
                "This is a read-only example; changing the state of a real item is available only in the authorized product.",
                "読み取り専用の表示例です。実際の項目への対応は、権限を確認した製品画面から行います。",
              )}
            </p>
          </section>
        )}
        {view === "evidence" && (
          <section className="nx-demo-card">
            <h3>
              {text(locale, "How to read this sample", "このサンプルの読み方")}
            </h3>
            <p>
              {text(
                locale,
                "The chart counts observed direct replies per completed UTC day. Missing days remain unavailable. A measured zero is shown as 0; the partial total includes only known observations. No retention or satisfaction score is inferred.",
                "グラフは完了したUTC日ごとの直接返信の件数です。欠測日は不明のまま残し、確認できたゼロは0と表示します。一部取得の合計は確認できた件数だけを含みます。継続参加率や満足度は推測しません。",
              )}
            </p>
            <p>
              {text(
                locale,
                "Use Overview → Show all dates and values for every sample value, including the previous period's actual dates.",
                "「概要」→「すべての日付と値を表示」から、比較期間の実際の日付を含む全値を確認できます。",
              )}
            </p>
          </section>
        )}
      </div>
    </figure>
  );
}
