import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
test("alpha.5 archetypes, evidence states and operations views fit desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(180000);
  const previews = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tests/e2e/render-alpha5-operations.tsx"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  ) as Record<string, { html: string; state: string }>;
  const css = readFileSync("apps/web/app/style.css", "utf8");
  for (const [name, preview] of Object.entries(previews))
    for (const [size, width, height] of [
      ["desktop", 1200, 950],
      ["mobile", 375, 812],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.setContent(
        `<html><head><meta charset="utf-8"><style>${css}</style></head><body><main style="max-width:1050px;margin:24px auto;padding:16px"><p>Synthetic fixture · ${name}</p>${preview.html}</main></body></html>`,
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
