import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { comparisonRows } from "../../apps/web/app/pricing/comparison";
import { planRegistry, plans } from "../../packages/settings/src/plan-registry";
const out = ".local/pricing-comparison-ui";
await mkdir(out, { recursive: true });
const probe = createServer();
await new Promise<void>((yes) => probe.listen(0, "127.0.0.1", yes));
const address = probe.address();
if (!address || typeof address === "string") throw new Error("NO_LOCAL_PORT");
const port = address.port;
await new Promise<void>((yes) => probe.close(() => yes()));
const origin = "http://127.0.0.1:" + port;
const server = spawn(
  process.execPath,
  [
    resolve("apps/web/node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: resolve("apps/web"),
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXUS_HOSTED_BETA: "on",
      NEXUS_WEB_AUTH_MODE: "oauth",
      NEXUS_WEB_URL: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout?.on("data", (chunk) => {
  logs += String(chunk);
});
server.stderr?.on("data", (chunk) => {
  logs += String(chunk);
});
const browser = await chromium.launch({ headless: true });
const errors: string[] = [],
  external: string[] = [],
  layouts: { locale: string; width: number }[] = [];
const design: unknown[] = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("LOCAL_NEXT_EXITED");
    try {
      if ((await fetch(origin + "/pricing")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await new Promise((yes) => setTimeout(yes, 200));
  }
  if (!ready) throw new Error("LOCAL_NEXT_NOT_READY");
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    external.push(url.origin + url.pathname);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const locale of ["ja", "en"] as const) {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: origin },
    ]);
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + "/pricing");
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll("body *")]
          .map((node) => ({
            tag: node.tagName,
            class: node.className,
            right: node.getBoundingClientRect().right,
            left: node.getBoundingClientRect().left,
            width: node.getBoundingClientRect().width,
          }))
          .filter((x) => x.right > innerWidth + 1 || x.left < -1)
          .slice(0, 40),
      }));
      if (overflow.scrollWidth > width + 1) {
        await writeFile(
          out + "/overflow.json",
          JSON.stringify({ locale, ...overflow }, null, 2),
        );
        await page.screenshot({ path: out + "/overflow.png", fullPage: true });
      }
      expect(overflow.scrollWidth).toBeLessThanOrEqual(width + 1);
      const table = page.locator(".comparison-scroll");
      await expect(table.locator("[data-feature-id]")).toHaveCount(44);
      for (const row of comparisonRows) {
        const cells = table.locator('[data-feature-id="' + row.id + '"] td');
        expect(
          await cells.evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-included") === "true"),
          ),
        ).toEqual(row.values);
      }
      expect(
        await table
          .locator("[data-feature-group]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-feature-group")),
          ),
      ).toEqual(["FREE", "STARTER", "GROWTH", "SCALE"]);
      const available = table.locator(".comparison-mark-included").first(),
        excluded = table.locator(".comparison-mark-excluded").first();
      expect(
        await available.evaluate((node) => getComputedStyle(node).color),
      ).toBe("rgb(39, 88, 202)");
      expect(
        await excluded.evaluate((node) => getComputedStyle(node).color),
      ).toBe("rgb(107, 114, 128)");
      await expect(excluded.locator("[aria-hidden]")).toHaveText("−");
      const anchorCell = table.locator('th[scope="row"]').first();
      const before = (await anchorCell.boundingBox())!.x;
      await table.focus();
      if (
        await table.evaluate((node) => node.scrollWidth > node.clientWidth + 1)
      ) {
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => table.evaluate((node) => node.scrollLeft))
          .toBeGreaterThan(0);
        expect(
          Math.abs((await anchorCell.boundingBox())!.x - before),
        ).toBeLessThan(2);
      }
      await table.evaluate((node) => {
        node.scrollLeft = 0;
      });
      const count = page.locator('[data-limit-id="monthlyObservedMembers"] td');
      expect(await count.allTextContents()).toEqual(
        plans.map((plan) =>
          String(
            planRegistry[plan].limits.monthlyObservedMembers ??
              (locale === "ja" ? "個別契約" : "Custom contract"),
          ),
        ),
      );
      const faq = page.locator(".faq");
      for (const summary of await faq.locator("summary").all()) {
        await summary.focus();
        await page.keyboard.press("Enter");
      }
      expect(await faq.innerText()).not.toMatch(
        /UNKNOWN|PARTIAL|Sandbox|Voice同席|測定根拠|プライバシー保持設定/,
      );
      await expect(faq.locator('a[href="/privacy"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/checkout"]')).toHaveCount(0);
      await expect(page.locator("#invitation-beta")).toContainText(
        locale === "ja" ? "開始を準備しています" : "preparing to launch",
      );
      await table.screenshot({
        path: out + "/comparison-" + locale + "-" + width + ".png",
        style:
          ".nx-public-header, .nx-skip-link { visibility: hidden !important; }",
      });
      await faq.screenshot({
        path: out + "/faq-" + locale + "-" + width + ".png",
        style:
          ".nx-public-header, .nx-skip-link { visibility: hidden !important; }",
      });
      layouts.push({ locale, width });
    }
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + "/");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: out + "/landing-" + locale + "-" + width + "-full.png",
        fullPage: true,
      });
      if (locale === "ja" && width === 1440) {
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        for (let index = 0; index < 4; index++) {
          const y = Math.floor((height * index) / 4),
            end = Math.floor((height * (index + 1)) / 4);
          await page.screenshot({
            path: out + "/landing-ja-1440-part-" + (index + 1) + ".png",
            fullPage: true,
            clip: { x: 0, y, width, height: end - y },
          });
        }
      }
      if (width === 1440)
        design.push(
          await page.evaluate(
            (locale) => ({
              locale,
              sections: [...document.querySelectorAll("main section")]
                .filter((node) => !node.parentElement?.closest("section"))
                .map((node) => ({
                  id: node.id,
                  className: node.className,
                  headings: [...node.querySelectorAll("h1,h2,h3")].map(
                    (h) => h.textContent,
                  ),
                  links: [...node.querySelectorAll("a[href]")].map((a) => ({
                    text: a.textContent,
                    href: a.getAttribute("href"),
                  })),
                })),
              headerLinks: [...document.querySelectorAll("header a[href]")].map(
                (a) => ({ text: a.textContent, href: a.getAttribute("href") }),
              ),
              footerLinks: [...document.querySelectorAll("footer a[href]")].map(
                (a) => ({ text: a.textContent, href: a.getAttribute("href") }),
              ),
            }),
            locale,
          ),
        );
    }
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await writeFile(
    out + "/result.json",
    JSON.stringify(
      {
        passed: true,
        layouts,
        featureCells: 220,
        numericDefinitionsUnchanged: 60,
        errors,
        externalRequests: external,
        note: "Scoped local UI checks and requested design captures only; combined final smoke deferred until remaining home design is agreed. No payment/provider/send actions.",
      },
      null,
      2,
    ),
  );
  await writeFile(
    out + "/design-inventory.json",
    JSON.stringify(design, null, 2),
  );
  console.log(
    "PASS pricing comparison: 8 layouts, 220 preserved cells, keyboard and colors; current LP design captures saved",
  );
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>((yes) => server.once("exit", () => yes()));
  }
  await writeFile(out + "/server.log", logs);
}
