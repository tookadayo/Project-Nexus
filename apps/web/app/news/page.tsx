import type { Metadata } from "next";
import { SiteShell, copy, siteLocale } from "../public-ui";
import { publicNewsList } from "../publication-data";
import { FreshNewsNavigation } from "./fresh-navigation";
import {
  NewsFilters,
  NewsListContent,
  NewsUnavailable,
} from "./news-components";
import { newsHref, newsQuery, type NewsSearchParams } from "./news-model";
import "./news.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "NEXUS · Official announcements / 公式お知らせ",
};

export default async function News({
  searchParams,
}: {
  searchParams: Promise<NewsSearchParams>;
}) {
  const locale = await siteLocale();
  const query = newsQuery(await searchParams);
  const result = await publicNewsList({ ...query, locale });
  return (
    <SiteShell locale={locale}>
      <FreshNewsNavigation />
      <div className="news-page">
        <header className="news-intro">
          <h1>{copy(locale, "NEXUSのお知らせ", "NEXUS updates")}</h1>
          <p>
            {copy(
              locale,
              "アップデート、メンテナンス、サービスに関するNEXUSからのご案内。",
              "Updates, maintenance and service information from NEXUS.",
            )}
          </p>
        </header>
        <NewsFilters locale={locale} query={query} />
        <section
          id="news-results"
          tabIndex={-1}
          aria-label={copy(
            locale,
            "公開済みのお知らせ",
            "Published announcements",
          )}
        >
          {result.state === "ready" ? (
            <NewsListContent data={result.data} query={query} locale={locale} />
          ) : (
            <NewsUnavailable locale={locale} href={newsHref(query)} />
          )}
        </section>
      </div>
    </SiteShell>
  );
}
