export function OperationsNavigation({
  locale = "en",
  active,
}: {
  locale?: "en" | "ja";
  active?: string;
}) {
  const items: [string, string, string][] = [
    ["/dashboard", "Home", "ホーム"],
    ["/operations?view=attention", "Needs attention", "要確認"],
    ["/explore", "Explore", "分析"],
    ["/operations?view=reports", "Reports", "レポート"],
    ["/operations?view=playbooks", "Playbooks", "Playbook"],
    ["/operations?view=improvements", "Improvements", "改善"],
    ["/operations?view=intake", "Intake", "相談"],
    ["/operations?view=events", "Events", "イベント"],
    ["/operations?view=organization", "Organization", "組織"],
    ["/operations?view=integrations", "Integrations", "連携"],
    ["/dashboard?view=4", "Settings", "設定"],
    ["/billing/manage", "Billing", "請求"],
  ];
  return (
    <nav
      aria-label={locale === "ja" ? "コミュニティ運営" : "Community operations"}
      className="operations-nav"
    >
      <a href="/dashboard">{locale === "ja" ? "ホーム" : "Home"}</a>
      <a href="/explore">{locale === "ja" ? "分析" : "Analysis"}</a>
      <a
        href="/operations?view=attention"
        aria-current={active === "attention" ? "page" : undefined}
      >
        {locale === "ja" ? "要確認" : "Needs attention"}
      </a>
      <a href="/dashboard?view=3">{locale === "ja" ? "履歴" : "History"}</a>
      <details>
        <summary>
          {locale === "ja" ? "運営・設定" : "Operations & settings"}
        </summary>
        <div className="operations-secondary">
          {items
            .filter(
              ([href]) =>
                ![
                  "/dashboard",
                  "/explore",
                  "/operations?view=attention",
                ].includes(href),
            )
            .map(([href, en, ja]) => (
              <a
                key={href}
                href={href}
                aria-current={
                  href === "/operations?view=" + active ? "page" : undefined
                }
              >
                {locale === "ja" ? ja : en}
              </a>
            ))}
          <a href="/servers">
            {locale === "ja" ? "サーバー一覧" : "Server list"}
          </a>
          <a href="/support">{locale === "ja" ? "ヘルプ" : "Help"}</a>
          <a href="/privacy">{locale === "ja" ? "プライバシー" : "Privacy"}</a>
          <a href="/terms">{locale === "ja" ? "利用条件" : "Terms"}</a>
          <a href="/auth/logout">
            {locale === "ja" ? "ログアウト" : "Sign out"}
          </a>
          <form method="post" action="/locale">
            <input
              type="hidden"
              name="locale"
              value={locale === "ja" ? "en" : "ja"}
            />
            <button>{locale === "ja" ? "English" : "日本語"}</button>
          </form>
        </div>
      </details>
    </nav>
  );
}
