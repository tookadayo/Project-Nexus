import { cookies, headers } from "next/headers";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { Navigation } from "./landing/navigation";
import { Brand } from "./landing/primitives";
import { ProductPreview } from "./landing/product-preview";
import "./landing/landing.css";
import "./landing/public-pages.css";
import "./landing/public-content.css";

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
  const groups = [
    {
      title: copy(locale, "NEXUSを知る", "Explore NEXUS"),
      links: [
        ["/product", copy(locale, "製品", "Product")],
        ["/#how-it-works", copy(locale, "使い方", "Getting started")],
        ["/product#demo", copy(locale, "操作デモ", "Interactive demo")],
        ["/pricing", copy(locale, "料金", "Pricing")],
      ],
    },
    {
      title: copy(locale, "ご案内", "Guidance"),
      links: [
        ["/news", copy(locale, "お知らせ", "Updates")],
        ["/support", copy(locale, "サポート", "Support")],
        [
          "/support#invitation-beta",
          copy(locale, "Closed Beta 1の参加案内", "Joining Closed Beta 1"),
        ],
        ["/auth/login", copy(locale, "ログイン", "Log in")],
      ],
    },
    {
      title: copy(locale, "規約とプライバシー", "Terms and privacy"),
      links: [
        ["/legal", copy(locale, "文書の公開状況", "Document availability")],
        ["/terms", copy(locale, "利用規約", "Terms of Service")],
        ["/privacy", copy(locale, "プライバシーポリシー", "Privacy Policy")],
        [
          "/legal/beta",
          copy(locale, "Closed Beta 1注意事項", "Closed Beta 1 Notice"),
        ],
        ["/legal/operator", copy(locale, "運営者情報", "Operator information")],
        ["/legal/history", copy(locale, "改定履歴", "Revision history")],
      ],
    },
  ];
  return (
    <footer className="site-footer nx-site-footer">
      <div className="nx-footer-brand">
        <a href="/" aria-label={copy(locale, "NEXUS ホーム", "NEXUS home")}>
          <Brand />
        </a>
        <p>
          {copy(
            locale,
            "Discordの活動と返信を確認し、運営の記録を振り返る。",
            "Review Discord activity, check replies and revisit your team's records.",
          )}
        </p>
      </div>
      <nav aria-label={copy(locale, "フッター", "Footer")}>
        {groups.map((group) => (
          <div className="nx-footer-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map(([href, label]) => (
                <li key={href}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
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
      <a className="nx-skip-link" href="#public-main">
        {copy(locale, "本文へスキップ", "Skip to content")}
      </a>
      <SiteHeader locale={locale} />
      <main id="public-main" tabIndex={-1}>
        {children}
      </main>
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
    <div className="cta-row">
      <a className="button button-primary" href="/support">
        {copy(locale, "Closed Beta 1の参加案内", "Joining Closed Beta 1")}
      </a>
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
