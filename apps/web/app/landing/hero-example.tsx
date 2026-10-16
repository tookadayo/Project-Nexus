import { text, type Locale } from "./content";
import { heroSample } from "./hero-data";
import { Brand, Icon } from "./primitives";
import { t } from "../../../../packages/discord-panels/src/i18n";

/** Initial HTML only: deliberately independent of the authenticated dashboard. */
export function HeroExample({ locale }: { locale: Locale }) {
  return (
    <section
      className="nx-hero-example"
      aria-label={text(
        locale,
        "Read-only dashboard preview",
        "閲覧専用のDashboardプレビュー",
      )}
      data-testid="hero-preview"
    >
      <div className="nx-preview-bar">
        <Brand small />
        <span>{text(locale, "Sample community", "サンプルコミュニティ")}</span>
        <span className="nx-preview-label">
          <Icon name="file" size={16} />
          {text(locale, "Synthetic data · Read only", "合成データ・閲覧専用")}
        </span>
      </div>
      <div className="nx-preview-body">
        <div className="nx-preview-heading">
          <h2>{text(locale, "Home", "ホーム")}</h2>
          <p>
            {text(
              locale,
              "An overview of available data and saved records.",
              "取得できたデータと、保存された記録の概要です。",
            )}
          </p>
        </div>
        <div className="nx-preview-cards">
          <article className="nx-preview-status" data-state={heroSample.state}>
            <h3>
              <Icon name="activity" size={18} />
              {text(locale, "Data collection", "データ取得")}
            </h3>
            <p className="nx-preview-state">
              {text(locale, "Partial", "一部取得")}
            </p>
            <p>
              {text(
                locale,
                "Some data is available. Unavailable observations remain unknown.",
                "一部のデータを利用できます。取得できない値は不明のまま表示します。",
              )}
            </p>
          </article>
          <article>
            <h3>
              <Icon name="message" size={18} />
              {text(locale, "Needs attention", "要確認")}
            </h3>
            <p className="nx-preview-count">
              <strong>{heroSample.attention}</strong>
              <span>{text(locale, "posts", "件")}</span>
            </p>
            <p>
              {text(
                locale,
                "Eligible posts to check for a reply or participation within the configured scope.",
                "設定した対象のうち、返信・参加を確認したい投稿の候補です。",
              )}
            </p>
          </article>
          <article>
            <h3>
              <Icon name="layers" size={18} />
              {text(locale, "Saved response results", "保存された対応結果")}
            </h3>
            <p className="nx-preview-count">
              <strong>{heroSample.recordCount}</strong>
              <span>{text(locale, "record", "件")}</span>
            </p>
            <p>
              {text(
                locale,
                "A saved response record. This count does not mean an issue was resolved.",
                "保存された対応の記録です。問題が解決した件数ではありません。",
              )}
            </p>
          </article>
        </div>
        <section
          className="nx-preview-recent"
          aria-label={text(locale, "Recent response records", "最近の対応記録")}
        >
          <h3>{text(locale, "Recent response records", "最近の対応記録")}</h3>
          <ul>
            {heroSample.records.map((record) => (
              <li key={record.id}>
                <div>
                  <strong>{t(locale, "testAction.reply_rescue")}</strong>
                  <p>
                    {text(
                      locale,
                      "Saved response result · Synthetic example",
                      "保存された対応結果・合成データの表示例",
                    )}
                  </p>
                </div>
                <span className="nx-preview-record-state">
                  {text(locale, "Collecting data", "データを収集中")}
                </span>
                <time dateTime={record.startedAt}>
                  {text(
                    locale,
                    "Started Oct 1, 2026 · 09:00 UTC",
                    "開始 2026年10月1日 09:00 UTC",
                  )}
                </time>
              </li>
            ))}
          </ul>
        </section>
        <p className="nx-example-footnote">
          {text(
            locale,
            "An illustrative view of a fictional server. Reply observations and staff records do not establish resolution.",
            "架空のサーバーの表示例です。返信の観測やスタッフの対応記録は、問題の解決を保証しません。",
          )}
        </p>
      </div>
    </section>
  );
}
