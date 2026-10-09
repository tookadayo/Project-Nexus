import { chromium, expect } from "@playwright/test";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const baseline = process.env.NEXUS_UI_BASELINE === "1",
  out = ".local/alpha13-rn";
await mkdir(out, { recursive: true });
const probe = createServer();
await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
const address = probe.address();
if (!address || typeof address === "string") throw Error("PORT");
const port = address.port;
await new Promise<void>((r) => probe.close(() => r()));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
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
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXUS_HOSTED_BETA: "on",
      NEXUS_WEB_AUTH_MODE: "oauth",
      NEXUS_WEB_URL: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (output += c));
const browser = await chromium.launch({ headless: true });
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Only the isolated Next startup is retried. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error("NEXT_NOT_READY");
  const results: unknown[] = [];
  for (const width of baseline ? [390, 1440] : [320, 390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      { name: "nexus_locale", value: "ja", url: origin },
    ]);
    const page = await context.newPage(),
      errors: string[] = [],
      api: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    page.on("request", (r) => {
      if (
        /\/(api|explore\/data|operations\/data|auth)\b/.test(
          new URL(r.url()).pathname,
        )
      )
        api.push(new URL(r.url()).pathname);
    });
    await page.addInitScript(() => {
      (window as unknown as { shifts: number[] }).shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (
            !(entry as PerformanceEntry & { hadRecentInput: boolean })
              .hadRecentInput
          )
            (window as unknown as { shifts: number[] }).shifts.push(
              (entry as PerformanceEntry & { value: number }).value,
            );
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(origin);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const resources = await page.evaluate(() => ({
      jsBytes: performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes(".js"))
        .reduce(
          (n, e) => n + (e as PerformanceResourceTiming).decodedBodySize,
          0,
        ),
      cls: (window as unknown as { shifts: number[] }).shifts.reduce(
        (a, b) => a + b,
        0,
      ),
    }));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (!baseline) {
      await page.screenshot({
        path: `${out}/home-${width}.png`,
        fullPage: true,
      });
      const demo = page.locator(".nx-interactive-preview").first();
      await demo.scrollIntoViewIfNeeded();
      const period = demo.getByRole("combobox");
      await expect(period).toHaveValue("7");
      await period.selectOption("30");
      await expect(
        demo.locator(".observation-plot g[role=button]"),
      ).toHaveCount(30);
      await demo.locator(".observation-plot g[role=button]").first().click();
      await expect(demo.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(demo.getByRole("dialog")).not.toBeVisible();
      await expect(
        demo.locator(".observation-plot g[role=button]").first(),
      ).toBeFocused();
      await demo.getByRole("button", { name: /リセット|Reset/ }).click();
      await expect(period).toHaveValue("7");
      await expect(
        demo.locator(".observation-plot g[role=button]"),
      ).toHaveCount(7);
      const tabs = demo.getByRole("tab");
      await tabs.first().focus();
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(1)).toBeFocused();
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(demo.locator(".nx-demo-card")).toHaveCSS(
        "animation-name",
        "none",
      );
      await page.keyboard.press("Home");
      await expect(
        demo
          .getByText(/実際のサーバー|Synthetic|サンプル/, { exact: false })
          .first(),
      ).toBeVisible();
      await demo.screenshot({ path: `${out}/demo-${width}.png` });
      await expect(demo.locator(".chart-bar").first()).toHaveCSS(
        "animation-name",
        "none",
      );
      for (const path of ["/product", "/pricing", "/support"]) {
        await page.goto(origin + path);
        await expect(page.locator(".nx-beta-notice")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (path === "/pricing") {
          await expect(page.locator(".pricing-limits tbody tr")).toHaveCount(6);
          await expect(
            page.locator(".pricing-limits th").filter({ hasText: "BETA" }),
          ).toHaveCount(0);
        }
        await page.screenshot({
          path: `${out}/${path.slice(1)}-${width}.png`,
          fullPage: true,
        });
      }
    }
    if (!baseline) {
      await context.addCookies([
        { name: "nexus_locale", value: "en", url: origin },
      ]);
      await page.goto(origin);
      const demo = page.locator(".nx-interactive-preview").first();
      await demo.getByRole("combobox").selectOption("30");
      await demo.getByRole("button", { name: "Reset demo" }).click();
      await expect(demo.getByRole("combobox")).toHaveValue("7");
      await demo.getByRole("tab", { name: "Evidence", exact: true }).click();
      await expect(demo.getByRole("tabpanel")).toContainText("sample");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 1440) {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await demo.getByRole("tab", { name: "Overview", exact: true }).click();
        await expect(demo.locator(".chart-bar").first()).toHaveCSS(
          "animation-duration",
          "0.18s",
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(demo.locator(".chart-bar").first()).toHaveCSS(
          "animation-name",
          "none",
        );
      }
      await page.goto(origin + "/pricing");
      await expect(page.locator(".nx-beta-notice")).toContainText(
        "not a sixth subscription plan",
      );
      expect(
        await page.locator(".pricing-limits").getAttribute("tabindex"),
      ).toBe("0");
    }
    expect(errors).toEqual([]);
    expect(api).toEqual([]);
    results.push({ width, ...resources, errors, api });
    await context.close();
  }
  await writeFile(
    `${out}/public-${baseline ? "baseline" : "final"}.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(
    `PASS ${baseline ? "baseline measurement" : "built public pages and interactive demo"}: local synthetic browser, external traffic blocked, ${baseline ? "390/1440" : "320/390/1440"} widths`,
  );
} finally {
  await browser.close();
  child.kill("SIGTERM");
  if (child.exitCode === null)
    await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(
    `${out}/public-${baseline ? "baseline" : "final"}-server.log`,
    output,
  );
}
