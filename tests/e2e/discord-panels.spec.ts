import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
test("Discord Components V2 layout approximations fit and remain within Discord limits", async ({
  page,
}) => {
  const previews = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tests/e2e/render-discord-panels.ts"],
      { encoding: "utf8" },
    ),
  ) as Record<string, { html: string; count: number }>;
  for (const [name, preview] of Object.entries(previews)) {
    expect(preview.count, `${name} component count`).toBeLessThanOrEqual(40);
    await page.setViewportSize({ width: 700, height: 1000 });
    await page.setContent(
      `<html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:14px/1.4 system-ui,sans-serif;padding:24px}.note{font-size:11px;color:#b5bac1;margin:0 0 12px}.panel{max-width:600px;background:#2b2d31;border:1px solid #424449;border-left:4px solid #5865f2;border-radius:8px;padding:16px}.section{display:flex;align-items:center;gap:12px}.section-text{flex:1;min-width:0}.accessory{flex-shrink:0}.text{margin:8px 0;overflow-wrap:anywhere}h2{font-size:20px;line-height:1.25;margin:0}h3{font-size:16px;line-height:1.3;margin:0}strong{font-weight:600}small{font-size:11px;color:#b5bac1}hr{border:0;border-top:1px solid #424449;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{border:0;border-radius:4px;padding:8px 12px;color:white;background:#4e5058;font:500 13px system-ui;min-height:32px;cursor:pointer}.style-1{background:#5865f2}button:disabled{opacity:.45}.select{display:flex;width:100%;justify-content:space-between;background:#1e1f22;border:1px solid #424449;padding:10px;border-radius:4px}</style></head><body><p class="note">Discord layout approximation · Fixture data · ${name}</p>${preview.html}</body></html>`,
    );
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-discord-${name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-discord-${name}-mobile.png`,
      fullPage: true,
    });
  }
});
