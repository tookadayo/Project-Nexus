import type { SiteLocale } from "../public-ui";
import { copy } from "../public-ui";
import "../../../../packages/presentation/src/publication-document.css";

// Deliberately has no content-service, candidate-file, or operator-settings import.
// A review revision cannot become public through a locale or route fallback.
export const legalDocuments = [
  { key: "terms", href: "/terms", ja: "利用規約", en: "Terms of Service" },
  {
    key: "privacy",
    href: "/privacy",
    ja: "プライバシーポリシー",
    en: "Privacy Policy",
  },
  {
    key: "beta",
    href: "/legal/beta",
    ja: "Closed Beta 1注意事項",
    en: "Closed Beta 1 Notice",
  },
  {
    key: "operator",
    href: "/legal/operator",
    ja: "運営者情報",
    en: "Operator information",
  },
  {
    key: "history",
    href: "/legal/history",
    ja: "改定履歴",
    en: "Revision history",
  },
] as const;
export type LegalDocumentKey = (typeof legalDocuments)[number]["key"];

export function LegalStatusView({
  locale,
  document,
}: {
  locale: SiteLocale;
  document?: LegalDocumentKey;
}) {
  const selected = legalDocuments.find((item) => item.key === document);
  return (
    <div className="publication-document publication-status-page">
      <header className="publication-header">
        <h1>
          {selected
            ? copy(locale, selected.ja, selected.en)
            : copy(locale, "規約とプライバシー", "Terms and privacy")}
        </h1>
        <p className="publication-lead">
          {copy(
            locale,
            "文書の公開状況と、お問い合わせの案内を確認できます。",
            "Check document availability and find contact guidance.",
          )}
        </p>
      </header>
      <section
        className="publication-status"
        aria-labelledby="document-status-title"
      >
        <h2 id="document-status-title" tabIndex={-1}>
          {copy(
            locale,
            "公開文書はまだありません",
            "No published document is available",
          )}
        </h2>
        <p>
          {copy(
            locale,
            "このページには、適用される規約やポリシーの本文は掲載されていません。利用への同意を受け付ける画面ではありません。",
            "This page does not contain applicable terms or policy text. It does not accept agreement to use the service.",
          )}
        </p>
      </section>
      <nav
        className="publication-related"
        aria-labelledby="related-documents-title"
      >
        <h2 id="related-documents-title">
          {copy(locale, "関連文書", "Related documents")}
        </h2>
        <ul>
          {legalDocuments.map((item) => (
            <li key={item.key}>
              <a
                href={item.href}
                aria-current={item.key === document ? "page" : undefined}
              >
                {copy(locale, item.ja, item.en)}
              </a>
              <span>{copy(locale, "未公開", "Not published")}</span>
            </li>
          ))}
        </ul>
      </nav>
      <section
        className="publication-contact"
        aria-labelledby="legal-contact-title"
      >
        <h2 id="legal-contact-title">
          {copy(locale, "お問い合わせ", "Contact guidance")}
        </h2>
        <p>
          {copy(
            locale,
            "一般のお問い合わせと、個人情報の開示・削除等に関するご案内を分けています。権利請求の案内は、ログインやサーバー管理者権限がなくても確認できます。",
            "General support and personal information requests have separate guidance. You can view rights-request guidance without signing in or having server administrator access.",
          )}
        </p>
        <p>
          <a href="/support#general-support">
            {copy(locale, "一般サポート", "General support")}
          </a>{" "}
          ·{" "}
          <a href="/support#rights-requests">
            {copy(
              locale,
              "開示・削除等のご案内",
              "Access, deletion and other rights",
            )}
          </a>
        </p>
      </section>
    </div>
  );
}
