import { SiteShell, siteLocale, copy } from "../../public-ui";
import { BillingConfirmation } from "./confirmation";
export const dynamic="force-dynamic";
export default async function BillingSuccess(){const locale=await siteLocale();return <SiteShell locale={locale}><section className="site-section"><h1>{copy(locale,"契約状態を確認中","Confirming subscription")}</h1><BillingConfirmation locale={locale}/><a className="button button-primary" href="/billing">{copy(locale,"現在のプランを確認","View current plan")}</a></section></SiteShell>;}
