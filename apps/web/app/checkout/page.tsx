import { pendingCheckout, PendingCheckout } from "./pending";
import { cookies } from "next/headers";
import { SiteShell, copy, siteLocale } from "../public-ui";
import {
  openSession,
  validateOAuthSession,
  checkoutGuilds,
} from "../auth/session";
import { publicBillingCatalog } from "../billing/catalog";
export const dynamic = "force-dynamic";
export default async function Checkout({
  searchParams,
}: {
  searchParams: Promise<{ offering?: string }>;
}) {
  const locale = await siteLocale(),
    { offering: offeringId } = await searchParams,
    catalog = await publicBillingCatalog(),
    offering = catalog.offerings.find((row) => row.id === offeringId);
  if (!offering)
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(locale, "Checkoutは準備中です", "Checkout is unavailable")}
          </h1>
          <p>
            {copy(
              locale,
              "購入可能なプランを確認してください。",
              "Check the currently available plans.",
            )}
          </p>
          <a href="/pricing" className="button button-primary">
            {copy(locale, "プランを見る", "View plans")}
          </a>
        </section>
      </SiteShell>
    );
  const session = await openSession((await cookies()).get("nexus_session")?.value);
  if (!session)
    return (
      <SiteShell locale={locale}>
        <section className="site-section checkout-intro">
          <p className="site-eyebrow">SECURE CHECKOUT · {offering.plan_key}</p>
          <h1>{copy(locale, "Discordでログイン", "Sign in with Discord")}</h1>
          <p>
            {copy(
              locale,
              "有料プランの購入には、サーバーのOwnerであることを確認します。",
              "Paid subscriptions must be started by the Server Owner.",
            )}
          </p>
          <a
            className="button button-discord"
            href={`/auth/login?offering=${offering.id}`}
          >
            {copy(locale, "Discordでログイン", "Sign in with Discord")}
          </a>
        </section>
      </SiteShell>
    );
  const pending = await pendingCheckout();
  if (pending)
    return (
      <SiteShell locale={locale}>
        <PendingCheckout token={pending.token} locale={locale} />
      </SiteShell>
    );
  let guilds: Awaited<ReturnType<typeof checkoutGuilds>>;
  try {
    await validateOAuthSession(session);
    guilds = await checkoutGuilds(session.accessToken);
  } catch {
    return (
      <SiteShell locale={locale}>
        <section className="site-section">
          <h1>
            {copy(
              locale,
              "Discordへの接続を確認してください",
              "Discord is unavailable",
            )}
          </h1>
          <p role="status">
            {copy(
              locale,
              "現在の権限を確認できません。時間をおいて再試行してください。",
              "Current ownership could not be confirmed. Please try again shortly.",
            )}
          </p>
          <a
            className="button button-secondary"
            href={`/checkout?offering=${offering.id}`}
          >
            {copy(locale, "再確認", "Try again")}
          </a>
        </section>
      </SiteShell>
    );
  }
  const owned = guilds.filter((g) => g.owner),
    managed = guilds.filter((g) => !g.owner);
  return (
    <SiteShell locale={locale}>
      <section className="site-section checkout-intro">
        <p className="site-eyebrow">SECURE CHECKOUT · {offering.plan_key}</p>
        <h1>
          {copy(locale, "Ownerのサーバーを選択", "Choose a server you own")}
        </h1>
        <p>
          {copy(
            locale,
            "現在のOwner権限は、購入を開始する直前にDiscordで再確認します。",
            "We verify your current ownership with Discord immediately before creating Checkout.",
          )}
        </p>
        {owned.length === 0 && (
          <p role="status">
            {copy(
              locale,
              "購入対象になるOwnerのサーバーがありません。",
              "No servers you own are available for purchase.",
            )}
          </p>
        )}
        <div className="checkout-server-grid">
          {owned.map((g) => (
            <article className="checkout-server-card" key={g.id}>
              {g.iconUrl && (
                <img src={g.iconUrl} alt="" width={48} height={48} />
              )}
              <h2>{g.name}</h2>
              <span className="badge">Server Owner</span>
              {g.installed ? (
                <a
                  className="button button-primary"
                  href={`/checkout/review?offering=${offering.id}&guild=${g.id}`}
                >
                  {copy(locale, "このサーバーを選択", "Select this server")}
                </a>
              ) : (
                <>
                  <p>
                    {copy(
                      locale,
                      "まずNEXUSをサーバーに追加してください。追加後、このページで再確認できます。",
                      "Add NEXUS first, then refresh this page to continue.",
                    )}
                  </p>
                  {g.installUrl && (
                    <a
                      className="button button-discord"
                      href={g.installUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {copy(
                        locale,
                        "このサーバーにNEXUSを追加",
                        "Add NEXUS to this server",
                      )}
                    </a>
                  )}
                  <a
                    className="button button-secondary"
                    href={`/checkout?offering=${offering.id}`}
                  >
                    {copy(
                      locale,
                      "インストールを再確認",
                      "Check installation again",
                    )}
                  </a>
                </>
              )}
            </article>
          ))}
        </div>
        {managed.length > 0 && (
          <section className="checkout-managed">
            <h2>
              {copy(locale, "管理しているサーバー", "Servers you manage")}
            </h2>
            <p>
              {copy(
                locale,
                "有料プランはサーバーのOwnerが購入する必要があります。",
                "Paid plans must be purchased by the Server Owner.",
              )}
            </p>
            {managed.map((g) => (
              <article key={g.id}>
                <h3>{g.name}</h3>
                <p>Administrator / Manage Server</p>
              </article>
            ))}
          </section>
        )}
      </section>
    </SiteShell>
  );
}
