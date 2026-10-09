import { cookies, headers } from "next/headers";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { Navigation } from "./landing/navigation";
import { Brand } from "./landing/primitives";
import { ProductPreview } from "./landing/product-preview";
import "./landing/landing.css";
import "./landing/public-pages.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--nx-font-sans",
  display: "swap",
});

export type SiteLocale = "ja" | "en";
export async function siteLocale(): Promise<SiteLocale> {
  const saved = (await cookies()).get("nexus_locale")?.value;
  if (saved === "ja" || saved === "en") return saved;
  return (await headers())
    .get("accept-language")
    ?.toLowerCase()
    .startsWith("ja")
    ? "ja"
    : "en";
}
export const copy = <T,>(locale: SiteLocale, ja: T, en: T): T =>
  locale === "ja" ? ja : en;

export function SiteHeader({ locale }: { locale: SiteLocale }) {
  return (
    <div
      className={`nexus-site nx-public-header ${geist.variable}`}
      lang={locale}
    >
      <Navigation locale={locale} />
    </div>
  );
}
export function SiteFooter({ locale }: { locale: SiteLocale }) {
  return (
    <footer className="site-footer">
      <div>
        <a href="/" aria-label={copy(locale, "NEXUS ホーム", "NEXUS home")}>
          <Brand />
        </a>
        <p>
          {copy(
            locale,
            "新規メンバーの返信・交流・参加後の活動を確認。",
            "Track newcomer replies, connections and later activity.",
          )}
        </p>
      </div>
      <nav aria-label="Footer">
        <a href="/product">{copy(locale, "製品", "Product")}</a>
        <a href="/pricing">{copy(locale, "料金", "Pricing")}</a>
        <a href="/support">{copy(locale, "サポート", "Support")}</a>
        <a href="/privacy">{copy(locale, "プライバシー", "Privacy")}</a>
        <a href="/terms">{copy(locale, "利用条件", "Terms")}</a>
      </nav>
    </footer>
  );
}
export function SiteShell({
  locale,
  children,
}: {
  locale: SiteLocale;
  children: ReactNode;
}) {
  return (
    <div className={`site nexus-site ${geist.variable}`} lang={locale}>
      <SiteHeader locale={locale} />
      <main>{children}</main>
      <SiteFooter locale={locale} />
    </div>
  );
}
export function SiteCta({
  locale,
  secondary = true,
}: {
  locale: SiteLocale;
  secondary?: boolean;
}) {
  return (
    <div className="cta-row"><a className="button button-primary" href="/support">{copy(locale,"招待Betaの参加案内","Check invitation Beta access")}</a>
      {secondary && (
        <a className="button button-secondary" href="/product">
          {copy(locale, "製品を見る", "Explore the product")}
        </a>
      )}
    </div>
  );
}
export function Preview({ locale }: { locale: SiteLocale }) {
  return <ProductPreview locale={locale} />;
}
