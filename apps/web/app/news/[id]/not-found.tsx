import { SiteShell, copy, siteLocale } from "../../public-ui";
import { FreshNewsNavigation } from "../fresh-navigation";
import "../news.css";

export default async function AnnouncementNotFound() {
  const locale = await siteLocale();
  return (
    <SiteShell locale={locale}>
      <FreshNewsNavigation />
      <div className="news-page news-empty">
        <h1>
          {copy(
            locale,
            "このお知らせは表示できません",
            "This announcement is not available",
          )}
        </h1>
        <p>
          {copy(
            locale,
            "現在公開されていないか、指定したページが見つかりません。",
            "It is not currently published, or the requested page could not be found.",
          )}
        </p>
        <a className="button button-secondary" href="/news">
          {copy(locale, "お知らせ一覧に戻る", "Back to announcements")}
        </a>
      </div>
    </SiteShell>
  );
}
