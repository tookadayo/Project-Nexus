import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import {
  renderChartPng,
  chartSvg,
} from "../../packages/analytics/src/chart-renderer";
import { chartSummary } from "../../packages/analytics/src/chart-language";
import { alpha14ChartFixture } from "../fixtures/alpha14-charts";
import {
  validatePanel,
  type Panel,
} from "../../packages/discord-panels/src/primitives";
const out = resolve(".local/alpha14-evidence/charts");
await mkdir(out, { recursive: true });
const screenshots: string[] = [];
for (const locale of ["ja", "en"] as const) {
  for (const state of ["partial", "unknown", "long"] as const) {
    const spec = alpha14ChartFixture(state === "unknown");
    if (state === "long") {
      spec.metric = "event";
      spec.branding = {
        title:
          "合成サーバー / Synthetic community — a deliberately long community report name for layout verification",
        footer:
          "合成データのみ / Synthetic data only — this is a layout verification artifact, not an actual community report.",
        logoBase64: null,
      };
      spec.cacheKey += "-long";
    }
    const name = `png-${locale}-${state}`;
    await writeFile(
      resolve(out, `${name}.png`),
      await renderChartPng(spec, locale),
    );
    await writeFile(resolve(out, `${name}.svg`), chartSvg(spec, locale));
    await writeFile(resolve(out, `${name}.txt`), chartSummary(spec, locale));
    screenshots.push(`${name}.png`);
  }
}
const previews = JSON.parse(
  execFileSync(
    process.execPath,
    ["--import", "tsx", "tests/e2e/render-discord-panels.ts"],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NEXUS_PANEL_EXPORT_DIR: resolve(out, "payloads") },
    },
  ),
) as Record<string, { html: string; count: number; payload: Panel }>;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.route("**/*", (route) => route.abort());
  const selected = [
    "ja-current-completed",
    "en-current-completed",
    "ja-historical-completed-result",
    "en-zero-uses-home",
  ];
  for (const name of selected) {
    const preview = previews[name];
    if (!preview) throw Error(`Missing fixture ${name}`);
    validatePanel(preview.payload);
    expect(preview.count).toBeLessThanOrEqual(40);
    for (const width of [375, 700]) {
      await page.setViewportSize({ width, height: 950 });
      await page.setContent(
        `<html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:14px/1.5 system-ui,sans-serif;padding:20px}.note{font-size:12px;color:#b5bac1;margin:0 0 14px}.panel{max-width:620px;background:#2b2d31;border:1px solid #424449;border-left:4px solid #2758ca;border-radius:8px;padding:16px}.section{display:flex;align-items:center;gap:12px}.section-text{flex:1;min-width:0}.accessory{flex-shrink:0}.text{margin:8px 0;overflow-wrap:anywhere}h2{font-size:20px;line-height:1.3;margin:0}h3{font-size:16px;line-height:1.4;margin:0}small{font-size:12px;color:#b5bac1}hr{border:0;border-top:1px solid #424449;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{border:0;border-radius:4px;padding:8px 12px;color:white;background:#4e5058;font:500 13px system-ui;min-height:36px}.style-1{background:#2758ca}button:disabled{opacity:.45}.select{display:flex;width:100%;justify-content:space-between;background:#1e1f22;border:1px solid #424449;padding:10px;border-radius:4px}</style></head><body><p class="note">Synthetic fixture · Actual payload / HTML layout approximation · ${name}</p>${preview.html}</body></html>`,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const path = `${name}-${width}.png`;
      await page.screenshot({ path: resolve(out, path), fullPage: true });
      screenshots.push(path);
    }
  }
  await writeFile(
    resolve(out, "manifest.json"),
    JSON.stringify(
      {
        synthetic: true,
        liveDiscordAcceptance: "NOT RUN",
        payloadsValidated: Object.keys(previews).length,
        screenshots,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      png: 6,
      screenshots: screenshots.length,
      payloadsValidated: Object.keys(previews).length,
    }),
  );
} finally {
  await browser.close();
}
