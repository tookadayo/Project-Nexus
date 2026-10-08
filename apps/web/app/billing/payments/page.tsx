import { redirect } from "next/navigation";
import { SiteHeader, copy, siteLocale } from "../../public-ui";
import { FailureNotice } from "../../failure-ui";
import { userFailure } from "../../../../../packages/shared/src/errors";
import { sql } from "../../../../../packages/db/src/index";
import { personalBillingIdentity } from "./context";
import { PersonalPaymentControls } from "./controls";
export const dynamic = "force-dynamic";
export default async function PersonalPayments() {
  const locale = await siteLocale();
  let payments;
  try {
    const context = await personalBillingIdentity();
    const accounts = await context.authorization.financialAccounts(
      context.identity,
    );
    payments = await Promise.all(
      accounts.map(async (account) => {
        const subscriptions = (
          await sql<{
            plan_key: string;
            status: string;
            current_period_end: Date | null;
          }>`SELECT plan_key,status,current_period_end FROM billing_subscriptions WHERE account_id=${account.accountId}::uuid AND provider='STRIPE' ORDER BY created_at DESC`.execute(
            context.services.db,
          )
        ).rows;
        return {
          accountId: account.accountId,
          provisional: account.provisional,
          canPortal: account.canPortal,
          subscriptions,
        };
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_EXPIRED")
      redirect("/auth/login?next=%2Fbilling%2Fpayments");
    return (
      <div className="servers-page">
        <SiteHeader locale={locale} />
        <main className="servers-content">
          <FailureNotice
            locale={locale}
            failure={userFailure(error, "NOT_STARTED", {
              action: "billing",
              stage: "personal-payments",
            })}
          />
        </main>
      </div>
    );
  }
  return (
    <div className="servers-page">
      <SiteHeader locale={locale} />
      <main className="servers-content">
        <h1>{copy(locale, "自分が管理している支払い", "My payments")}</h1>
        <p>
          {copy(
            locale,
            "サーバーから脱退した後も、ご自身の請求確認と解約ができます。",
            "You can review and cancel your own billing after leaving a server.",
          )}
        </p>
        {!payments.length && (
          <p>
            {copy(
              locale,
              "このDiscordアカウントが管理する支払いはありません。別のアカウントで購入した場合は、そのアカウントでログインしてください。",
              "This Discord account has no managed payments. If you purchased with another account, sign in with that account.",
            )}
          </p>
        )}
        {payments.map((payment, index) => (
          <section key={payment.accountId} className="billing-card">
            <h2>
              {copy(locale, `支払い ${index + 1}`, `Payment ${index + 1}`)}
            </h2>
            {payment.provisional && (
              <p>
                {copy(
                  locale,
                  "購入の確定を確認中です。",
                  "Purchase confirmation is pending.",
                )}
              </p>
            )}
            {payment.subscriptions.map((subscription, i) => (
              <p key={i}>
                {subscription.plan_key[0]}
                {subscription.plan_key.slice(1).toLowerCase()}
                {subscription.current_period_end &&
                  ` · ${copy(locale, "現在の請求期間の終了", "Current billing period ends")}: ${subscription.current_period_end.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", { timeZone: "UTC" })} UTC`}
              </p>
            ))}
            <PersonalPaymentControls
              accountId={payment.accountId}
              locale={locale}
              canPortal={payment.canPortal}
            />
          </section>
        ))}
        <a href="/servers">
          {copy(locale, "サーバーを選ぶ", "Choose a server")}
        </a>
      </main>
    </div>
  );
}
