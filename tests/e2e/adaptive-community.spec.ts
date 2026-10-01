import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
test("seven community profiles adapt six Web and Discord views without irrelevant KPIs", async ({
  page,
}) => {
  test.setTimeout(180000);
  const previews = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tests/e2e/render-adaptive-community.tsx"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  ) as Record<string, { html: string; discord: unknown; expected: string[] }>;
  const css = readFileSync("apps/web/app/style.css", "utf8");
  for (const [name, preview] of Object.entries(previews)) {
    await page.setViewportSize({ width: 1200, height: 950 });
    await page.setContent(
      `<html><head><meta charset="utf-8"><style>${css}</style></head><body><main style="max-width:1050px;margin:24px auto;padding:16px"><p>Fixture sample · ${name}</p>${preview.html}</main></body></html>`,
    );
    if (!name.endsWith("-4") && !name.endsWith("-8")) {
      await expect(page.locator("[data-metric]")).toHaveCount(
        preview.expected.length,
      );
      await expect(page.locator("main")).toContainText(
        name.includes("-ja-") ? "集計期間" : "Observation window",
      );
      for (const forbidden of [
        "stageAudience",
        "pollParticipants",
        "resolvedPosts",
        "voiceCopresence",
      ])
        if (!preview.expected.includes(forbidden))
          await expect(
            page.locator(`[data-metric="${forbidden}"]`),
          ).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/alpha4-web-${name}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (name.endsWith("-0") || name.endsWith("-4"))
      await page.screenshot({
        path: `test-results/alpha4-web-${name}-mobile.png`,
        fullPage: true,
      });
    const serialized = JSON.stringify(preview.discord);
    expect(serialized).not.toContain('"type":21');
    expect(serialized).not.toContain('"type":22');
    expect(serialized).not.toContain('"type":23');
    const displays: string[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      if ("content" in node) displays.push(String(node.content));
      for (const value of Object.values(node))
        if (Array.isArray(value)) for (const item of value) walk(item);
    }
    walk(preview.discord);
    expect(displays.join("\n").length).toBeLessThanOrEqual(4000);
    if(name.includes('-ja-')){
      const escaped=displays.map(text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')).join('<hr/>');
      await page.setViewportSize({width:700,height:1000});
      await page.setContent(`<html><head><meta charset="utf-8"><style>body{background:#313338;color:#dbdee1;font:14px/1.5 system-ui;padding:24px}article{background:#2b2d31;border-left:4px solid #5865f2;border-radius:8px;padding:18px;white-space:pre-wrap;overflow-wrap:anywhere}hr{border:0;border-top:1px solid #424449}</style></head><body><p>Discord Components V2 approximation · ${name}</p><article>${escaped}</article></body></html>`);
      await page.screenshot({path:`test-results/alpha4-discord-${name}.png`,fullPage:true});
    }
  }
});
test("community settings save multiple purposes with the current revision and queue manual discovery", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const form = page.getByTestId("community-model-settings");
  await form.getByRole("checkbox", { name: /Social conversation/ }).check();
  await form.getByRole("checkbox", { name: /Support \/ Q&A/ }).check();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/control") &&
      r.request().postDataJSON()?.action === "community_model",
  );
  await form
    .getByRole("button", { name: "Save purposes and mappings" })
    .click();
  expect((await saved).ok()).toBe(true);
  await expect(form.getByRole("status")).toContainText(
    "Community purposes saved",
  );
  const refresh = page.waitForResponse(
    (r) =>
      r.url().endsWith("/control") &&
      r.request().postDataJSON()?.action === "capability_refresh",
  );
  await form.getByRole("button", { name: "Rediscover capabilities" }).click();
  expect((await refresh).ok()).toBe(true);
  await expect(form.getByRole("status")).toContainText("Rediscovery queued");
});
