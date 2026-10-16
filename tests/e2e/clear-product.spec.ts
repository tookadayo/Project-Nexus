import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const root = ".local/clear-product-phase-a/after";
test.beforeAll(() => mkdirSync(root, { recursive: true }));
const routes = [
  "/product",
  "/pricing",
  "/news",
  "/support",
  "/legal",
  "/terms",
  "/privacy",
  "/legal/beta",
  "/legal/operator",
  "/legal/history",
];
for (const locale of ["ja", "en"] as const) {
  test(`Clear Product public page reflow and assets (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1440, 1280, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator("main h1")).toHaveCount(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${route} ${width}`,
        ).toBe(true);
        const clipped = await page.locator("main").evaluate((element) =>
          Array.from(element.querySelectorAll("*"))
            .filter(
              (node) =>
                node.getBoundingClientRect().width > 0 &&
                node.scrollWidth > node.clientWidth + 2 &&
                getComputedStyle(node).overflowX === "visible",
            )
            .map((node) => node.className),
        );
        expect(clipped, `${route} clipped at ${width}`).toEqual([]);
        if (route === "/pricing") {
          await expect(page.locator("[data-pricing-plan]")).toHaveCount(5);
          await expect(page.locator('a[href^="/checkout"]')).toHaveCount(0);
        }
        if (route === "/product") {
          for (const image of await page
            .locator(".nx-feature-screen img")
            .all()) {
            await image.scrollIntoViewIfNeeded();
            await expect
              .poll(() =>
                image.evaluate(
                  (node) => (node as HTMLImageElement).naturalWidth,
                ),
              )
              .toBe(768);
          }
        }
        if ([1440, 390, 320].includes(width)) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `${root}/${locale}-${route.slice(1).replaceAll("/", "-")}-${width}.png`,
            fullPage: true,
          });
        }
      }
    }
    expect(errors).toEqual([]);
  });

  test(`Clear Product keyboard, motion, anchor and 200 percent scale (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(
      page.locator('.nx-navigation[data-enhanced="true"]'),
    ).toBeVisible();
    await page.mouse.move(1400, 880);
    await page.keyboard.press("Tab");
    await expect(page.locator(".nx-skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    for (const trigger of await page.locator(".nx-nav-disclosure").all()) {
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".nx-nav-panel:visible")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
    await page.locator(".nx-hero .nx-button-primary").click();
    await expect(page).toHaveURL(/\/#demo$/);
    expect(
      (await page.locator("#demo").boundingBox())!.y,
    ).toBeGreaterThanOrEqual(64);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".nx-clear-product")
        .evaluate((element) =>
          Array.from(element.querySelectorAll("*")).every(
            (node) =>
              getComputedStyle(node).animationName === "none" &&
              getComputedStyle(node).transitionDuration === "0s",
          ),
        ),
    ).toBe(true);
    // CSS magnification stress test; viewport matrix separately checks browser-zoom-equivalent reflow.
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
      window.scrollTo(0, 0);
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${root}/${locale}-200-percent.png` });
  });

  test(`Clear Product public reading without JavaScript (${locale})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 900 },
    });
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    const page = await context.newPage();
    const external: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(baseURL!)) external.push(request.url());
    });
    try {
      for (const route of ["/", ...routes]) {
        await page.goto(baseURL + route);
        await expect(page.locator("main h1")).toBeVisible();
        if (route === "/") {
          await expect(page.getByTestId("hero-preview")).toContainText(
            locale === "ja" ? "一部取得" : "Partial",
          );
          await expect(page.locator(".nx-preview-count strong")).toHaveText([
            "2",
            "1",
          ]);
          await page.locator(".nx-nav-fallback summary").click();
          await expect(
            page.locator('.nx-nav-fallback a[href="/pricing"]'),
          ).toBeVisible();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      expect(external).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("Clear Product comparable local resource measurements", async ({
  page,
  context,
  baseURL,
}) => {
  const measurements: unknown[] = [];
  for (const locale of ["ja", "en"] as const) {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/",
        "/product",
        "/pricing",
        "/news",
        "/support",
        "/legal",
      ]) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        measurements.push({
          locale,
          width,
          route,
          ...(await page.evaluate(() => ({
            htmlBytes: new TextEncoder().encode(
              document.documentElement.outerHTML,
            ).length,
            resources: performance.getEntriesByType("resource").length,
            transferBytes: performance
              .getEntriesByType("resource")
              .reduce(
                (n, e) => n + (e as PerformanceResourceTiming).transferSize,
                0,
              ),
            navigationMs: (
              performance.getEntriesByType(
                "navigation",
              )[0] as PerformanceNavigationTiming
            ).domContentLoadedEventEnd,
          }))),
        });
      }
    }
  }
  writeFileSync(
    `${root}/measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
});
