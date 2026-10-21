import {test, expect} from "@playwright/test";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
import {mkdir} from "node:fs/promises";

const guild = "321111111111111111", flow = "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", unknownRun = "8aa23f75-a30d-4bea-9b8c-b9f0223c2ef0", approvalRun = "8aa23f75-a30d-4bea-9b8c-b9f0223c2ef1";
const summary = () => ({flows: [{id: flow, name: "Synthetic community announcement with a long title / 長い名前のお知らせ", state: "ACTIVE", revision: 2}], runs: [{id: unknownRun, flowId: flow, state: "UNKNOWN", startedAt: "2026-10-15T09:00:00Z"}, {id: approvalRun, flowId: flow, state: "WAITING_APPROVAL", startedAt: "2026-10-15T09:00:00Z"}], nextOccurrences: [{id: "occurrence", at: "2026-10-16T09:00:00Z", timezone: "Asia/Tokyo"}], usage: {limit: 100, reserved: 2, consumed: 8, compensated: 1, remaining: 91, updatedAt: "2026-10-15T10:00:00Z"}, status: "AVAILABLE"});
let html = "";
test.beforeAll(async () => {
  const requireHere = createRequire(import.meta.url), requireWeb = createRequire(resolve("apps/web/package.json"));
  const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {build(input: Record<string, unknown>): Promise<{outputFiles: {path: string; text: string}[]}>};
  const result = await esbuild.build({entryPoints: [resolve("tests/fixtures/alpha15-dashboard-ui.tsx")], bundle: true, platform: "browser", format: "iife", write: false, outfile: "dashboard.js", jsx: "automatic", alias: {react: dirname(requireWeb.resolve("react/package.json")), "react-dom": dirname(requireWeb.resolve("react-dom/package.json"))}});
  const script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--nx-font-sans:system-ui}body{margin:0;font-family:system-ui}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-dashboard-ui", {recursive: true});
});
test.beforeEach(async ({page}) => {
  await page.route("**/dashboard-fixture*", route => route.fulfill({contentType: "text/html", body: html}));
  await page.route("**/api/automation/overview", route => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers()["x-nexus-guild"]).toBe(guild);
    return route.fulfill({json: summary()});
  });
});

for (const locale of ["ja", "en"] as const) {
  test(`dashboard presents UNKNOWN, approval, usage and explicit timezone at 320px (${locale})`, async ({page}) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/dashboard-fixture?locale=${locale}`);
    await page.setViewportSize({width: 320, height: 900});
    await expect(page.locator(".alpha15-status")).toContainText("91 / 100");
    await expect(page.locator(".alpha15-status")).toContainText(locale === "ja" ? "結果不明・再送停止" : "Result unknown · sending stopped");
    await expect(page.locator(".alpha15-status")).toContainText(locale === "ja" ? "承認待ち" : "Awaiting approval");
    await expect(page.locator(".alpha15-status")).toContainText(locale === "ja" ? "補填 1" : "Compensated 1");
    await expect(page.locator(".alpha15-flows")).toContainText(locale === "ja" ? "有効" : "Enabled");
    await expect(page.locator(".alpha15-recent section").nth(1)).toContainText("Asia/Tokyo");
    await expect(page.locator(".alpha15-recent section").nth(1).locator("time")).toHaveText(new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo"}).format(new Date("2026-10-16T09:00:00Z")));
    const target = new URL(await page.locator(".alpha15-status a").first().getAttribute("href") ?? "", "https://example.invalid");
    expect(target.searchParams.get("flow")).toBe(flow); expect(target.searchParams.get("run")).toBe(unknownRun);
    await expect(page.getByRole("link", {name: locale === "ja" ? "Web設定を開く" : "Open web settings"})).toHaveAttribute("href", `/setup?guild=${guild}&edit=1`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `.local/alpha15-dashboard-ui/${locale}-320.png`, fullPage: true});
    expect(errors).toEqual([]);
  });

  test(`console home keeps Phase B overview and navigation alongside alpha15 (${locale})`, async ({page}) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/dashboard-fixture?locale=${locale}&surface=console`);
    await page.setViewportSize({width: 320, height: 900});
    await expect(page.locator(".alpha15-home")).toBeVisible();
    await expect(page.locator(".home-summary")).toBeVisible();
    await expect(page.locator(".alpha15-status")).toContainText("91 / 100");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `.local/alpha15-dashboard-ui/${locale}-console-320.png`, fullPage: true});
    const menu = page.getByRole("button", {name: locale === "ja" ? "メニュー" : "Menu", exact: true});
    if (await menu.count()) await menu.click();
    await expect(page.locator('a[href="/automation"]').first()).toHaveAttribute("href", "/automation");
    await expect(page.getByRole("link", {name: locale === "ja" ? "設定" : "Settings", exact: true}))
      .toHaveAttribute("href", "/setup?guild=321111111111111111&edit=1");
    expect(errors).toEqual([]);
  });
}

test("empty results are explicit while capacity remains separate", async ({page}) => {
  await page.route("**/api/automation/overview", route => route.fulfill({json: {...summary(), flows: [], runs: [], nextOccurrences: [], status: "CAPACITY_UNMEASURED"}}));
  await page.goto("/dashboard-fixture?locale=en");
  await expect(page.getByText("No automations yet.", {exact: true})).toBeVisible();
  await expect(page.getByText("No run records yet.", {exact: true})).toBeVisible();
  await expect(page.getByText("No upcoming occurrences are currently available.", {exact: true})).toBeVisible();
  await expect(page.getByText("New production starts are stopped until host capacity is verified.", {exact: false})).toBeVisible();
});

test("failed retrieval remains unverified and a manual retry can recover", async ({page}) => {
  let failed = true;
  await page.route("**/api/automation/overview", route => failed ? route.fulfill({status: 503, json: {error: "UNAVAILABLE"}}) : route.fulfill({json: summary()}));
  await page.goto("/dashboard-fixture?locale=en");
  await expect(page.getByRole("alert")).toContainText("Counts and results are unverified");
  await expect(page.locator(".alpha15-flows")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", {name: "Check again", exact: true}).click();
  await expect(page.locator(".alpha15-status")).toContainText("91 / 100");
});

test("invalid rows and usage show unavailable without rendering exceptions", async ({page}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const payload of [{...summary(), runs: [null]}, {...summary(), usage: {...summary().usage, remaining: -1}}, {...summary(), nextOccurrences: [null]}]) {
    await page.route("**/api/automation/overview", route => route.fulfill({json: payload}));
    await page.goto("/dashboard-fixture?locale=en");
    await expect(page.getByRole("alert")).toContainText("unverified");
  }
  expect(errors).toEqual([]);
});

test("invalid occurrence time and timezone remain unconfirmed rows", async ({page}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/automation/overview", route => route.fulfill({json: {...summary(), nextOccurrences: [{id: "bad-zone", at: "2026-10-16T09:00:00Z", timezone: "Moon/Sea"}, {id: "bad-at", at: "not-a-date", timezone: "Asia/Tokyo"}]}}));
  await page.goto("/dashboard-fixture?locale=en");
  await expect(page.getByText("Review the scheduled time. This occurrence is unconfirmed.", {exact: true})).toHaveCount(2);
  await expect(page.locator(".alpha15-recent section").nth(1).locator("time")).toHaveCount(0);
  expect(errors).toEqual([]);
});
