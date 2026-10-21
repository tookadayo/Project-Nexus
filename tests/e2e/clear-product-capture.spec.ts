import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderWithCss } from "../fixtures/render-with-css";

test("capture actual display components with synthetic data", async ({
  page,
}) => {
  test.skip(
    process.env.NEXUS_CAPTURE_PRODUCT_SCREENS !== "1",
    "Opt-in asset capture",
  );
  mkdirSync(".local/clear-product-phase-b", { recursive: true });
  const { previews, css } = await renderWithCss<string>(
    new URL("./render-clear-product.tsx", import.meta.url),
  );
  const dimensions: Record<string, { width: number; height: number }> = {};
  await page.setViewportSize({ width: 800, height: 1100 });
  // All CSS is local. No external requests, API, authentication or mutations.
  await page.route("**/*", (route) => route.abort());
  for (const [name, html] of Object.entries(previews)) {
    await page.setContent(
      `<html lang="${name.endsWith("ja") ? "ja" : "en"}"><head><style>${css}</style></head><body><div class="product nx-workspace" style="display:block;padding:16px"><div>${html}</div></div></body></html>`,
    );
    const region = page.locator(
      name.startsWith("history")
        ? ".home-recent"
        : name.startsWith("analysis")
          ? ".observation-chart"
          : ".attention-view",
    );
    await expect(region).toBeVisible();
    const box = (await region.boundingBox())!;
    dimensions[name] = {
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    };
    await region.screenshot({
      path: `apps/web/public/nexus/screens/feature-${name}.png`,
    });
  }
  writeFileSync(
    ".local/clear-product-phase-b/screen-dimensions.json",
    JSON.stringify(dimensions, null, 2),
  );
});

// Explicit local capture only. Uses the existing isolated E2E synthetic server.
test("capture Clear Product baseline and actual product screens", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(process.env.NEXUS_CAPTURE_PHASE_A !== "1", "Opt-in asset capture");
  test.setTimeout(120000);
  const root = ".local/clear-product-phase-a/before";
  mkdirSync(root, { recursive: true });
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
        await page.screenshot({
          path: `${root}/${locale}-${route.slice(1) || "home"}-${width}.png`,
          fullPage: true,
        });
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
    await page.setViewportSize({ width: 1100, height: 1000 });
    for (const [name, route] of [
      ["analysis", "/dashboard?view=5"],
      ["history", "/dashboard?view=3"],
      ["attention", "/dashboard?view=8"],
    ]) {
      await page.goto(route!);
      await expect(page.locator(".content")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${root}/source-${name}-${locale}.png`,
        fullPage: true,
      });
    }
  }
  writeFileSync(
    `${root}/measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
});
