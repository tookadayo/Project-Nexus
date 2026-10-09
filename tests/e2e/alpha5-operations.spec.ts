import { test, expect } from "@playwright/test";
import { renderWithCss } from "../fixtures/render-with-css";
test("alpha.5 archetypes, evidence states and operations views fit desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(180000);
  const rendered = await renderWithCss<{ html: string; state: string }>(
    new URL("./render-alpha5-operations.tsx", import.meta.url),
  );
  const { previews } = rendered;
  for (const fileName of [
    "style.css",
    "tokens.css",
    "product.css",
    "brand.css",
    "attention.css",
  ])
    expect(
      rendered.cssFiles.some((file) => file.endsWith("/" + fileName)),
    ).toBe(true);
  expect(rendered.css).toContain(".attention-view");
  const css = rendered.css;
  for (const [name, preview] of Object.entries(previews))
    for (const [size, width, height] of [
      ["desktop", 1200, 950],
      ["mobile", 375, 812],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.setContent(
        `<html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="product" style="display:block"><main class="content" style="max-width:1050px;margin:24px auto;padding:16px"><p>Synthetic fixture · ${name}</p>${preview.html}</main></div></body></html>`,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name,
      ).toBe(true);
      if (
        ["UNKNOWN", "INTENT_UNAVAILABLE", "DISCORD_UNAVAILABLE"].includes(
          preview.state,
        )
      )
        if (!name.startsWith("saved-attention"))
          await expect(page.locator(".metric-cards")).not.toContainText("0%");
      if (name.startsWith("saved-attention")) {
        await expect(page.locator(".attention-card")).toHaveCount(1);
        await expect(page.locator(".collection-warning")).toBeVisible();
        await expect(
          page.locator(".attention-card button").last(),
        ).toBeEnabled();
      }
      if (preview.state === "NO_DATA")
        await expect(page.locator(".metric-cards")).toContainText(
          "対象者がいません",
        );
      await page.screenshot({
        path: `test-results/alpha5-${name}-${size}.png`,
        fullPage: true,
      });
    }
});
