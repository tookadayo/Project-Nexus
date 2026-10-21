import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { demoChart } from "../../apps/web/app/landing/demo-data";
import { chartQuerySchema } from "../../packages/analytics/src/chart-spec";
import { exploreLocation } from "../../apps/web/app/explore/navigation";
import { renderWithCss } from "../fixtures/render-with-css";

const stage = process.env.NEXUS_PHASE_B_STAGE === "before" ? "before" : "after";
const root = `.local/clear-product-phase-b/${stage}`;
test.beforeAll(() => mkdirSync(root, { recursive: true }));
const guild = "321111111111111111";

for (const locale of ["ja", "en"] as const) {
  test(`Clear Product workspace layout and chart evidence (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
      { name: "nexus_guild", value: guild, url: baseURL! },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // The development-auth dashboard seed does not create a signed browser
    // session for this route. Match the existing alpha14 presentation fixture;
    // do not relax the application's authentication for visual capture.
    await page.route("**/data/attention**", async (route) => {
      expect(route.request().method()).toBe("GET");
      const channelId = "621111111111111111";
      await route.fulfill({
        json: {
          items: ["521111111111111901", "521111111111111902"].map(
            (messageId, index) => ({
              channelId,
              messageId,
              status: index === 0 ? "OPEN" : "IN_PROGRESS",
              version: 1,
              surface: "TEXT",
              purpose: "SUPPORT",
              postedAt: "2026-10-09T10:00:00Z",
              openedAt: "2026-10-09T10:20:00Z",
              snoozeUntil: null,
              response: null,
              waitingMinutes: 35,
              url: `https://discord.com/channels/${guild}/${channelId}/${messageId}`,
            }),
          ),
          total: 2,
          activeCount: 2,
          asOf: "2026-10-09T12:00:00Z",
          checkedAt: "2026-10-09T12:01:00Z",
          cursor: "synthetic-visual",
          firstCursor: "synthetic-visual",
          previousCursor: null,
          nextCursor: null,
          canOperate: true,
          channels: [channelId],
        },
      });
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const measurements: unknown[] = [];
    const widths =
      stage === "before" ? [1440, 390] : [1440, 1280, 1024, 768, 390, 375, 320];
    const surfaces = [
      ["home", 0],
      ["attention", 8],
      ["history", 3],
      ["analysis", 5],
      ["new-members", 1],
      ["improvements", 2],
      ["settings", 4],
      ["rules", 9],
      ["journeys", 10],
      ["community-model", 11],
      ["integration", 12],
      ["coverage", 13],
      ["collection", 14],
    ] as const;
    for (const [name, view] of surfaces) {
      await page.goto(`/dashboard?view=${view}`);
      await expect(page.locator(".content")).toBeVisible();
      await expect(
        page.locator("#home-overview-detail > p[role=status]"),
      ).toHaveCount(0);
      if (view === 0)
        await expect(page.locator(".home-attention-count")).toHaveText("2");
      if (view === 8)
        await expect(page.locator(".attention-card")).toHaveCount(2);
      if (stage === "after" && view === 3)
        await expect(page.locator("h1:visible")).toHaveCount(1);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 960 });
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${name} ${width}`,
        ).toBe(true);
        if ([1440, 390, 320].includes(width)) {
          await page.screenshot({
            path: `${root}/${locale}-${name}-${width}.png`,
            fullPage: true,
          });
        }
      }
    }

    // Browser-only synthetic fixture, matching the existing alpha14 chart contract.
    // No real Guild observations or writes are used for visual verification.
    await page.route("**/explore/data**", async (route) => {
      expect(route.request().method()).toBe("GET");
      const query = chartQuerySchema.parse(
        JSON.parse(
          new URL(route.request().url()).searchParams.get("q") ?? "{}",
        ),
      );
      const spec = demoChart(query.days === 30 ? 30 : 7);
      if (!query.compare)
        spec.series = spec.series.filter((series) => series.key === "CURRENT");
      await route.fulfill({
        json: {
          spec,
          views: [],
          segments: [],
          channels: [],
          capabilities: {
            advanced: true,
            compare: true,
            canSave: false,
            saveReason: "NEXUS_ROLE_REQUIRED",
            csv: false,
            historyDays: 90,
          },
        },
      });
    });
    await page.goto(
      exploreLocation(chartQuerySchema.parse({ compare: true }), guild),
    );
    await expect(page.locator(".observation-chart")).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const chart = page.locator(".observation-chart");
      await expect(chart.locator(".chart-current")).toBeVisible();
      await expect(chart.locator(".chart-previous")).toBeVisible();
      const points = chart.locator('.observation-plot g[role="button"]');
      await expect(points).toHaveCount(7);
      measurements.push({
        width,
        total: await chart.locator(".chart-total").innerText(),
        chartWidth: (await chart.boundingBox())!.width,
      });
      if ([1440, 390, 320].includes(width))
        await page.screenshot({
          path: `${root}/${locale}-explore-${width}.png`,
          fullPage: true,
        });
    }
    const points = page.locator('.observation-plot g[role="button"]');
    await points.nth(2).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(
      locale === "ja" ? "確認できません" : "Unavailable",
    );
    await page.keyboard.press("Escape");
    await expect(points.nth(2)).toBeFocused();
    await points.nth(3).press("Enter");
    await expect(page.getByRole("dialog")).toContainText("0");
    await page.keyboard.press("Escape");
    if (stage === "after") {
      await page.setViewportSize({ width: 640, height: 960 });
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${root}/${locale}-explore-200-percent.png`,
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
      await page.setViewportSize({ width: 390, height: 960 });
      await page.goto("/dashboard");
      await expect(page.locator(".home-attention-count")).toHaveText("2");
      await page.keyboard.press("Tab");
      await expect(page.locator(".workspace-skip")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#workspace-content")).toBeFocused();
      const menu = page.locator(".mobile-head").getByRole("button", {
        name: locale === "ja" ? "メニュー" : "Menu",
        exact: true,
      });
      await menu.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page.evaluate(() => getComputedStyle(document.body).overflow),
      ).toBe("hidden");
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(
        await page.evaluate(() => getComputedStyle(document.body).overflow),
      ).not.toBe("hidden");
      expect(
        await page
          .locator(".home-focus .primary")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe("0s");
    }
    expect(errors).toEqual([]);
    writeFileSync(
      `${root}/${locale}-measurements.json`,
      JSON.stringify(measurements, null, 2),
    );
  });
}

test("Clear Product saved-record layout keeps unavailable distinct from zero", async ({
  page,
}) => {
  test.skip(
    stage === "before",
    "Additional populated-state verification after implementation",
  );
  const { previews, css } = await renderWithCss<string>(
    new URL("./render-clear-workspace.tsx", import.meta.url),
  );
  await page.route("**/*", (route) => route.abort());
  for (const [name, html] of Object.entries(previews)) {
    await page.setContent(
      `<!doctype html><html lang="${name.endsWith("ja") ? "ja" : "en"}"><head><style>${css}</style></head><body>${html}</body></html>`,
    );
    const values = page.locator(".result-card .test-summary strong");
    await expect(values).toHaveText(["—", "0.0%"]);
    await expect(page.locator("h1:visible")).toHaveCount(1);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      // Crop the actual saved-record panel. This isolated SSR fixture does not
      // load the dashboard's remote-path brand images or hydrate its controls.
      await page.locator(".result-card").screenshot({
        path: `${root}/populated-${name}-${width}.png`,
      });
    }
  }
});
