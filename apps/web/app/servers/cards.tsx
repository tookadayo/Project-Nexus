import type {AuthorizedGuild} from "../auth/session";
import type {SiteLocale} from "../public-ui";

export function ServerCards({locale, guilds}: {locale: SiteLocale; guilds: AuthorizedGuild[]}) {
  const t = (ja: string, en: string) => locale === "ja" ? ja : en;
  return <div className="server-list">{guilds.map(guild => <article className="server-card" key={guild.id} data-state={guild.availability ?? guild.state}>
    <div className="server-icon" aria-hidden="true">{guild.name.trim().slice(0, 1).toUpperCase()}</div>
    <div><h2>{guild.name}</h2><p>{guild.availability === "UNAVAILABLE"
      ? t("現在の資格または接続を確認できません", "Current access or connection could not be verified")
      : guild.installed ? guild.state === "VERIFIED" ? t("Webに接続済み・現在の資格を再確認します", "Web connected · current access will be checked") : t("Botの参加済み・Web設定を続けます", "Bot installed · continue Web setup")
      : t("サーバー用Botを追加してからWebで設定します", "Add the server bot, then complete setup on the web")}</p>
      {guild.failure?.reference && <small>{t("参照ID", "Reference ID")}: {guild.failure.reference}</small>}
    </div>
    <a className="button button-primary" href={`${guild.state === "VERIFIED" ? "/auth/select" : "/setup"}?guild=${encodeURIComponent(guild.id)}`}>{guild.availability === "UNAVAILABLE" ? t("もう一度確認", "Check again") : guild.state === "VERIFIED" ? t("ダッシュボードへ", "Open Dashboard") : t("このサーバーを設定", "Set up this server")}</a>
  </article>)}{!guilds.length && <div className="server-empty"><h2>{t("管理できるサーバーがありません", "No manageable servers found")}</h2><p>{t("サーバーの管理権限、または接続済みサーバーで設定されたNEXUS管理ロールが必要です。", "You need server management permission or a configured NEXUS manager role on a connected server.")}</p></div>}</div>;
}
