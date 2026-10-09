import { expect, type Page } from "@playwright/test";
import { demoChart } from "../../apps/web/app/landing/demo-data";
import { chartQuerySchema } from "../../packages/analytics/src/chart-spec";
import { exploreLocation } from "../../apps/web/app/explore/navigation";
const guild = "111111111111111111";
export async function rnChecks(page: Page, origin: string) {
  let canSave = true,
    reason: string | null = null,
    permissions = ["READ", "ANALYZE", "OPERATE"],
    workAllowed = true,
    compareAllowed = true;
  const mutations: string[] = [];
  const access = () => ({
    plan: "FREE",
    basePlan: "FREE",
    features: ["surface_breakdowns", "comparable_periods"],
    historyDays: 30,
    monthlyRuns: 20,
    concurrency: 1,
    benefits: [{ kind: "BETA", endsAt: "2026-11-01T00:00:00Z" }],
    beta: {
      state: workAllowed ? "ACTIVE" : "PAUSED",
      endsAt: "2026-11-01T00:00:00Z",
      limits: { daily: 3, monthly: 20, guildPending: 2, globalPending: 10 },
    },
    workAllowed,
    usage: canSave ? { remaining: 17, reserved: 1, consumed: 2 } : null,
    asOf: "2026-10-09T00:00:00Z",
    nextMonthlyGrantAt: "2026-11-01T00:00:00Z",
  });
  await page.route("**/explore/data?*", (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      mutations.push(request.method());
      return route.fulfill({
        json: { error: "NEXUS_ROLE_REQUIRED" },
        status: 403,
      });
    }
    const q = JSON.parse(new URL(request.url()).searchParams.get("q") ?? "{}");
    if (q.compare && (q.days === 30 || !compareAllowed))
      return route.fulfill({
        status: 403,
        json: { error: q.days === 30 ? "HISTORY_PLAN_LIMIT" : "PLAN_REQUIRED" },
      });
    const spec = demoChart(q.days === 30 ? 30 : 7);
    spec.heatmap = Array.from({ length: 168 }, (_, i) => ({
      weekday: Math.floor(i / 24),
      hour: i % 24,
      value: i === 1 ? null : i % 6,
    }));
    spec.breakdowns = [
      {
        channelId: "333333333333333333",
        evidence: spec.evidence,
        points: spec.series[0]!.points,
      },
    ];
    if (!q.compare)
      spec.series = spec.series.filter((s) => s.key === "CURRENT");
    return route.fulfill({
      json: {
        spec,
        views: [],
        segments: [],
        channels: [],
        capabilities: {
          advanced: true,
          compare: compareAllowed,
          canSave,
          saveReason: reason,
          csv: false,
          historyDays: 30,
          access: access(),
        },
      },
    });
  });
  await page.route("**/operations/data?*", (route) =>
    route.fulfill({
      json: {
        view: "improvements",
        guildId: guild,
        access: {
          plan: "FREE",
          basePlan: "FREE",
          role: "VIEWER",
          permissions,
          features: { improvement_tracking: true },
          limits: {},
          current: access(),
        },
        destinations: [],
        teams: [],
        improvements: [],
      },
    }),
  );
  for (const locale of ["ja", "en"] as const) {
    const ja = locale === "ja";
    await page.setViewportSize({ width: 390, height: 900 });
    const bad =
      exploreLocation(
        chartQuerySchema.parse({ days: 30, compare: true }),
        guild,
      ) + `&locale=${locale}`;
    await page.goto(origin + bad);
    await expect(page.getByRole("alert")).toContainText(
      ja ? "履歴の範囲外" : "outside your available history",
    );
    const check = page.getByRole("checkbox", {
      name: ja ? "前の同期間と比較" : "Compare previous period",
    });
    await expect(check).toBeEnabled();
    await check.uncheck();
    await expect(page.locator(".observation-chart")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.goBack();
    await expect(check).toBeChecked();
    await expect(check).toBeEnabled();
    await expect(page.getByRole("alert")).toBeVisible();
    await page
      .getByRole("button", { name: ja ? "比較を解除" : "Turn off comparison" })
      .click();
    await expect(page.locator(".observation-chart")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    // Refresh loses the fixture locale query during navigation; explicitly restore it for subsequent localized checks.
    await page.goto(
      origin +
        exploreLocation(chartQuerySchema.parse({ compare: true }), guild) +
        `&locale=${locale}`,
    );
    await expect(page.locator(".observation-chart")).toBeVisible();
    const plot = page.locator(".observation-plot"),
      points = plot.locator('g[role="button"]');
    await expect(points).toHaveCount(7);
    await expect(points.first()).toHaveAttribute("aria-label", /2026/);
    await points.nth(2).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(ja ? "確認できません" : "Unavailable");
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(points.nth(2)).toBeFocused();
    const table = page.locator(".chart-values");
    await table.locator("summary").click();
    await expect(table.locator("tbody tr")).toHaveCount(7);
    await expect(table.locator("thead th")).toHaveCount(5);
    await table.getByRole("button").first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button").click();
    await expect(table.getByRole("button").first()).toBeFocused();
    await expect(page.locator(".heatmap thead th")).toHaveCount(25);
    await expect(page.locator(".heatmap tbody tr")).toHaveCount(7);
    const cells = page.locator(".heatmap tbody button");
    await expect(cells.nth(0)).toHaveText("0");
    await expect(cells.nth(1)).toHaveText("?");
    await cells.nth(1).click();
    await expect(dialog).toContainText(ja ? "確認できません" : "Unavailable");
    await dialog.getByRole("button").click();
    await expect(cells.nth(1)).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator(".current-access summary").click();
    await expect(page.locator(".current-access")).toContainText("FREE");
    await expect(page.locator(".current-access")).toContainText("17");
    await page.screenshot({
      path: `.local/alpha13-rn/explore-${locale}-390.png`,
      fullPage: true,
    });
  }
  for (const role of ["ADMIN", "ANALYST", "OPERATOR", "VIEWER"]) {
    canSave = ["ADMIN", "ANALYST"].includes(role);
    reason = canSave ? null : "NEXUS_ROLE_REQUIRED";
    permissions = canSave ? ["READ", "ANALYZE"] : ["READ"];
    await page.goto(origin + "/explore");
    await page
      .getByRole("textbox", { name: "名前", exact: true })
      .fill("Synthetic view");
    const save = page.getByRole("button", {
      name: "ビューを保存",
      exact: true,
    });
    if (canSave) await expect(save).toBeEnabled();
    else {
      await expect(save).toBeDisabled();
      await expect(
        page.getByText("この操作を行う権限がありません。", { exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("textbox", { name: "名前", exact: true }).fill("");
  }
  permissions = ["READ"];
  await page.goto(origin + "/operations?view=improvements");
  await expect(
    page.getByText("この操作を行う権限がありません。", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.locator('.inline-note a[href="/billing/manage"]'),
  ).toHaveCount(0);
  compareAllowed = false;
  await page.goto(
    origin + exploreLocation(chartQuerySchema.parse({ compare: true }), guild),
  );
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeEnabled();
  await page.getByRole("checkbox").uncheck();
  await expect(page.locator(".observation-chart")).toBeVisible();
  workAllowed = false;
  await page.reload();
  await page.locator(".current-access summary").click();
  await expect(page.locator(".current-access")).toContainText(
    "現在の状態を確認できません",
  );
  await expect(page.locator(".current-access")).toContainText("停止中");
  expect(mutations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator(".observation-chart")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".observation-chart")
    .screenshot({ path: ".local/alpha13-rn/graph-320.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: ".local/alpha13-rn/explore-paused-1440.png",
    fullPage: true,
  });
}
