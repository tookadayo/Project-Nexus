export function OperationsNavigation({
  locale = "en",
  active,
}: {
  locale?: "en" | "ja";
  active?: string;
}) {
  const items = [
    ["/dashboard", "Home", "ホーム"],
    ["/operations?view=attention", "Attention", "対応"],
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
      {items.map(([href, en, ja]) => (
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
    </nav>
  );
}
