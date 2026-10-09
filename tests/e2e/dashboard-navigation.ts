import { expect, type Page } from "@playwright/test";

type DashboardView = 0 | 1 | 2 | 3 | 4 | 5 | 8 | 9;

const entries: Record<
  DashboardView,
  { label: [string, string]; group?: [string, string] }
> = {
  0: { label: ["Home", "ホーム"] },
  1: {
    label: ["New Members", "新しいメンバー"],
    group: ["Analysis details", "分析の詳細"],
  },
  2: {
    label: ["Improvements", "改善案"],
    group: ["Responses & reports", "対応とレポート"],
  },
  3: { label: ["History", "履歴"] },
  4: { label: ["Settings", "設定"], group: ["Settings", "設定"] },
  5: { label: ["Analysis", "分析"] },
  8: { label: ["Needs attention", "要確認"] },
  9: {
    label: ["Goals & Rules", "目標と判定ルール"],
    group: ["Settings", "設定"],
  },
};

/** Follow the same visible navigation on desktop and mobile, including submenus. */
export async function navigateDashboard(
  page: Page,
  locale: "en" | "ja",
  view: DashboardView,
) {
  const sidebar = page.locator(".sidebar");
  const mobile = !(await sidebar.isVisible());
  const navigation = mobile ? page.locator(".mobile-head dialog") : sidebar;
  if (mobile) {
    await page
      .locator(".mobile-head")
      .getByRole("button", {
        name: locale === "ja" ? "メニュー" : "Menu",
        exact: true,
      })
      .click();
    await expect(navigation).toBeVisible();
  }
  const entry = entries[view];
  const language = locale === "ja" ? 1 : 0;
  if (entry.group) {
    const summary = navigation
      .locator(".nav-group > summary")
      .filter({ hasText: new RegExp(`^${entry.group[language]}$`) });
    if (
      !(await summary.evaluate((element) =>
        element.parentElement?.hasAttribute("open"),
      ))
    )
      await summary.click();
  }
  const button = navigation.getByRole("button", {
    name: entry.label[language],
    exact: true,
    includeHidden: true,
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("view") ?? "0")
    .toBe(String(view));
  if (mobile) await expect(navigation).not.toBeVisible();
}
