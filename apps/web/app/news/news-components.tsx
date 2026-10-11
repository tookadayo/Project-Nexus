import type { OfficialPublications } from "../../../../packages/operations/src/publication";
import { renderPublicationMarkdown } from "../../../../packages/shared/src/publication-markdown";
import { copy, type SiteLocale } from "../public-ui";
import {
  newsCategories,
  newsCategoryLabels,
  newsContents,
  newsHref,
  newsTimestamp,
  type NewsContentsItem,
  type NewsQuery,
} from "./news-model";

type NewsList = Awaited<ReturnType<OfficialPublications["publicList"]>>;
type NewsSummary = NewsList["items"][number];
type NewsDetail = NonNullable<
  Awaited<ReturnType<OfficialPublications["publicDetail"]>>
>;

export function NewsFilters({
  locale,
  query,
}: {
  locale: SiteLocale;
  query: NewsQuery;
}) {
  return (
    <form className="news-filters" action="/news#news-results" method="get">
      <div>
        <label htmlFor="news-category">
          {copy(locale, "種類", "Category")}
        </label>
        <select
          id="news-category"
          name="category"
          defaultValue={query.category ?? ""}
        >
          <option value="">{copy(locale, "すべて", "All categories")}</option>
          {newsCategories.map((category) => (
            <option key={category} value={category}>
              {newsCategoryLabels[category][locale]}
            </option>
          ))}
        </select>
      </div>
      <button className="button button-primary" type="submit">
        {copy(locale, "絞り込む", "Apply filter")}
      </button>
      {query.category && (
        <a href="/news#news-results">
          {copy(locale, "絞り込みを解除", "Clear filter")}
        </a>
      )}
    </form>
  );
}

export function NewsUnavailable({
  locale,
  href,
}: {
  locale: SiteLocale;
  href: string;
}) {
  return (
    <section className="news-empty" aria-labelledby="news-unavailable-title">
      <h2 id="news-unavailable-title">
        {copy(
          locale,
          "お知らせを確認できません",
          "Announcements are unavailable",
        )}
      </h2>
      <p>
        {copy(
          locale,
          "現在、お知らせを取得できません。時間をおいてもう一度お試しください。お知らせが0件であることを示すものではありません。",
          "We cannot load announcements right now. Please try again later. This does not mean that no announcements have been published.",
        )}
      </p>
      <a className="button button-secondary" href={href}>
        {copy(locale, "もう一度確認", "Try again")}
      </a>
    </section>
  );
}

export function NewsFallback({ locale }: { locale: SiteLocale }) {
  return (
    <p className="news-fallback">
      {copy(
        locale,
        "英語版は準備中です。日本語版を表示しています。",
        "The English version is not yet available. The Japanese version is shown.",
      )}
    </p>
  );
}

function NewsDates({
  item,
  locale,
}: {
  item: NewsSummary;
  locale: SiteLocale;
}) {
  return (
    <dl className="news-dates">
      <div>
        <dt>{copy(locale, "公開", "Published")}</dt>
        <dd>
          <time dateTime={item.publishedAt}>
            {newsTimestamp(item.publishedAt) ??
              copy(locale, "未確認", "Unknown")}
          </time>
        </dd>
      </div>
      <div>
        <dt>{copy(locale, "更新", "Updated")}</dt>
        <dd>
          <time dateTime={item.updatedAt}>
            {newsTimestamp(item.updatedAt) ?? copy(locale, "未確認", "Unknown")}
          </time>
        </dd>
      </div>
    </dl>
  );
}

function NewsBadges({
  item,
  locale,
}: {
  item: NewsSummary;
  locale: SiteLocale;
}) {
  const status = item.incidentStatus;
  const statusLabel =
    status === "RESOLVED"
      ? copy(locale, "復旧済み", "Resolved")
      : status === "MONITORING"
        ? copy(locale, "経過確認中", "Monitoring")
        : copy(locale, "対応中", "Investigating");
  return (
    <div className="news-badges">
      <span className="news-category">
        {newsCategoryLabels[item.category][locale]}
      </span>
      {status !== "NONE" && (
        <span className="news-incident">
          {copy(locale, "障害の状態", "Incident status")}: {statusLabel}
        </span>
      )}
    </div>
  );
}

export function NewsListContent({
  data,
  query,
  locale,
}: {
  data: NewsList;
  query: NewsQuery;
  locale: SiteLocale;
}) {
  return (
    <>
      <p className="news-results-summary">
        {copy(
          locale,
          `${data.total}件のお知らせ · 新着順`,
          `${data.total} announcements · Newest first`,
        )}
      </p>
      {data.items.length === 0 ? (
        <section className="news-empty">
          <h2>
            {data.total > 0
              ? copy(
                  locale,
                  "このページにお知らせはありません",
                  "There are no announcements on this page",
                )
              : query.category
                ? copy(
                    locale,
                    "この種類のお知らせはありません",
                    "No announcements in this category",
                  )
                : copy(
                    locale,
                    "公開済みのお知らせはまだありません",
                    "No announcements have been published yet",
                  )}
          </h2>
          <p>
            {data.total > 0
              ? copy(
                  locale,
                  "お知らせの更新や取り下げで、ページの内容が変わった可能性があります。最初のページから確認してください。",
                  "Updates or withdrawals may have changed the available pages. Return to the first page to review current announcements.",
                )
              : copy(
                  locale,
                  "公開されたお知らせがあると、ここに表示されます。",
                  "Published announcements will appear here.",
                )}
          </p>
          {data.total > 0 && (
            <a href={`${newsHref({ ...query, page: 1 })}#news-results`}>
              {copy(locale, "最初のページへ", "Go to the first page")}
            </a>
          )}
        </section>
      ) : (
        <ol className="news-list">
          {data.items.map((item) => (
            <li key={item.id}>
              <article className="news-card">
                <NewsBadges item={item} locale={locale} />
                <h2 lang={item.locale}>
                  <a href={newsHref(query, item.id)}>{item.title}</a>
                </h2>
                <p className="news-summary" lang={item.locale}>
                  {item.summary}
                </p>
                {item.fallback && <NewsFallback locale={locale} />}
                <NewsDates item={item} locale={locale} />
              </article>
            </li>
          ))}
        </ol>
      )}
      {(data.page > 1 || data.hasNext) && (
        <nav
          className="news-pagination"
          aria-label={copy(
            locale,
            "お知らせのページ送り",
            "Announcement pages",
          )}
        >
          {data.page > 1 && (
            <a
              className="button button-secondary"
              rel="prev"
              href={`${newsHref({ ...query, page: data.page - 1 })}#news-results`}
            >
              {copy(locale, "前のページ", "Previous page")}
            </a>
          )}
          <span>
            {copy(locale, `ページ ${data.page}`, `Page ${data.page}`)}
          </span>
          {data.hasNext && (
            <a
              className="button button-secondary"
              rel="next"
              href={`${newsHref({ ...query, page: data.page + 1 })}#news-results`}
            >
              {copy(locale, "次のページ", "Next page")}
            </a>
          )}
        </nav>
      )}
    </>
  );
}

function NewsContentsList({
  items,
  locale,
}: {
  items: NewsContentsItem[];
  locale: SiteLocale;
}) {
  return (
    <ul>
      {items.map((heading) => (
        <li key={heading.id}>
          <a href={`#${heading.id}`} lang={locale}>
            {heading.text}
          </a>
          {heading.children.length > 0 && (
            <NewsContentsList items={heading.children} locale={locale} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function NewsArticle({
  item,
  locale,
}: {
  item: NewsDetail;
  locale: SiteLocale;
}) {
  const rendered = renderPublicationMarkdown(item.body);
  return (
    <article className="news-article">
      <header>
        <NewsBadges item={item} locale={locale} />
        <h1 lang={item.locale}>{item.title}</h1>
        <p className="news-summary" lang={item.locale}>
          {item.summary}
        </p>
        <NewsDates item={item} locale={locale} />
        {item.fallback && <NewsFallback locale={locale} />}
      </header>
      {rendered.headings.length > 1 && (
        <nav
          className="news-contents"
          aria-label={copy(locale, "この記事の目次", "On this page")}
        >
          <h2>{copy(locale, "この記事の内容", "On this page")}</h2>
          <NewsContentsList
            items={newsContents(rendered.headings)}
            locale={item.locale}
          />
        </nav>
      )}
      <div
        className="news-body"
        lang={item.locale}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </article>
  );
}
