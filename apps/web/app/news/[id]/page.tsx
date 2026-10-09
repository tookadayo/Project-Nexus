import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicNewsDetail } from "../../publication-data";
import { SiteShell, copy, siteLocale } from "../../public-ui";
import { FreshNewsNavigation } from "../fresh-navigation";
import { NewsArticle, NewsUnavailable } from "../news-components";
import { newsHref, newsQuery, type NewsSearchParams } from "../news-model";
import "../news.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Keep metadata independent of article bodies and publication revisions.
export const metadata: Metadata = {
  title: "NEXUS · Official announcement / 公式お知らせ",
};

export default async function NewsDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<NewsSearchParams>;
}) {
  const locale = await siteLocale();
  const query = newsQuery(await searchParams);
  const { id } = await params;
  const result = await publicNewsDetail(id, locale);
  if (result.state === "ready" && !result.data) notFound();
  return (
    <SiteShell locale={locale}>
      <FreshNewsNavigation />
      <div className="news-page news-detail">
        <a className="news-back" href={`${newsHref(query)}#news-results`}>
          {copy(locale, "お知らせ一覧に戻る", "Back to announcements")}
        </a>
        {result.state === "ready" && result.data ? (
          <NewsArticle item={result.data} locale={locale} />
        ) : (
          <NewsUnavailable locale={locale} href={newsHref(query, id)} />
        )}
        <p className="news-bottom-back">
          <a href={`${newsHref(query)}#news-results`}>
            {copy(locale, "お知らせ一覧に戻る", "Back to announcements")}
          </a>
        </p>
      </div>
    </SiteShell>
  );
}
