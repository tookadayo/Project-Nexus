import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "./alpha17-verification-fixture";
import type { APIResponse, Browser, Page } from "@playwright/test";

const base = process.env.NEXUS_VERIFICATION_WEB_ORIGIN ?? "https://app.nexus.test:3150";
const fixture = "http://127.0.0.1:" + (process.env.NEXUS_VERIFICATION_API_PORT ?? "3151");
const user = "911111111111111111";
const guilds = { en: "931111111111111111", ja: "931111111111111113" };
type Locale = keyof typeof guilds;
type Plan = "FREE" | "STARTER" | "GROWTH" | "SCALE";
type Event = { id: string; title: string; revision: number; state: string };
type Data = { access: { features: Record<string, boolean> }; events: Event[]; intake: { panels: { title: string; fields: unknown[] }[] } };

// Separate functional diagnostics. The original 30/60-second monolithic smoke
// results remain failures; these cases do not establish its latency requirement.
test.describe.configure({ mode: "default" });
async function safeStatus(response: APIResponse) {
  const body: unknown = response.ok() ? undefined : await response.json().catch(() => undefined);
  const code = body && typeof body === "object" && "error" in body ? body.error : undefined;
  return "status=" + response.status() + " error=" + (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "UNCLASSIFIED");
}
async function signIn(context: BrowserContext, locale: Locale) {
  const response = await context.request.post(fixture + "/fixture/session", { data: { userId: user } });
  expect(response.status()).toBe(200);
  const { reference } = await response.json() as { reference: string };
  expect(typeof reference === "string" && /^[A-Za-z0-9_-]{43}$/.test(reference)).toBe(true);
  await context.addCookies([
    { name: "nexus_session", value: reference, url: base, httpOnly: true, sameSite: "Lax" },
    { name: "nexus_locale", value: locale, url: base },
    { name: "nexus_guild", value: guilds[locale], url: base },
  ]);
}
async function csrf(context: BrowserContext, guildId: string) {
  const issued = await context.request.get(base + "/servers", { maxRedirects: 0 });
  expect(issued.status()).toBe(200);
  const token = (await context.cookies(base)).find(cookie => cookie.name === "nexus_csrf")?.value;
  expect(Boolean(token && /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token))).toBe(true);
  if (!token) throw new Error("TEST_SESSION_CSRF_NOT_ISSUED");
  return { origin: base, "sec-fetch-site": "same-origin", "X-Nexus-Guild": guildId, "X-Nexus-CSRF": token };
}
async function prepareConnection(browser: Browser, locale: Locale) {
  // Worker-owned context, never the test-scoped page/context/request fixture.
  const context = await browser.newContext();
  try {
    await signIn(context, locale);
    const guildId = guilds[locale], headers = await csrf(context, guildId);
    const existing = await context.request.get(base + "/operations/data?view=attention", { headers: { "X-Nexus-Guild": guildId }, maxRedirects: 0 });
    if (existing.status() === 200) return;
    expect(existing.status()).toBe(403);
    expect((await existing.json() as { error?: unknown }).error === "SERVER_VERIFICATION_REQUIRED").toBe(true);
    const issued = await context.request.post(fixture + "/fixture/code", { data: { guildId } });
    expect(issued.status()).toBe(200);
    const { code } = await issued.json() as { code: string };
    const redeemed = await context.request.post(base + "/link/redeem", { headers, data: { code }, maxRedirects: 0 });
    expect(redeemed.ok(), await safeStatus(redeemed)).toBe(true);
    const verified = await context.request.get(base + "/operations/data?view=attention", { headers: { "X-Nexus-Guild": guildId }, maxRedirects: 0 });
    expect(verified.status()).toBe(200);
  } finally { await context.close(); }
}
async function start(page: Page, context: BrowserContext, locale: Locale, plan: Plan) {
  await signIn(context, locale);
  await page.setViewportSize({ width: 360, height: 800 });
  const guildId = guilds[locale], headers = await csrf(context, guildId);
  const tier = async (next: Plan) => {
    const response = await context.request.post(fixture + "/fixture/operations-plan", { data: { guildId, plan: next } });
    expect(response.ok(), await safeStatus(response)).toBe(true);
  };
  await tier(plan);
  const get = (path: string) => context.request.get(base + path, { headers: { "X-Nexus-Guild": guildId }, maxRedirects: 0 });
  const data = async (view: string): Promise<Data> => {
    const response = await get("/operations/data?view=" + view);
    expect(response.status(), await safeStatus(response)).toBe(200);
    return response.json() as Promise<Data>;
  };
  return { headers, tier, get, data };
}

for (const locale of ["en", "ja"] as const) test.describe(locale, () => {
  test.beforeAll(async ({ browser }) => { await prepareConnection(browser, locale); });

  test(`alpha17 operations phase A FREE exports and intake (${locale})`, async ({ page, context }) => {
    const { headers, get, data } = await start(page, context, locale, "FREE");
    const title = "Free intake " + locale + " " + randomUUID();
    const free = await data("attention");
    expect(free.access.features.basic_attention).toBe(true);
    expect(free.access.features.discord_charts).toBe(true);
    expect(free.access.features.api).toBe(false);
    const chart = await get("/explore/data");
    expect(chart.status()).toBe(200);
    expect((await chart.json()).spec.evidence.value).toBeNull();
    const png = await get("/explore/data?format=png");
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    expect((await png.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect((await get("/explore/data?format=csv")).status()).toBe(403);
    const denied = await context.request.post(base + "/operations/data", { headers, data: { action: "credential", input: { name: "Unavailable API " + randomUUID(), scopes: ["guild:read"], kind: "PERSONAL" } } });
    expect(denied.status()).toBe(403);
    await page.goto(base + "/operations?view=intake");
    await page.getByLabel(locale === "ja" ? "タイトル" : "Panel title", { exact: true }).fill(title);
    await page.getByLabel(locale === "ja" ? "相談の分類" : "Request category", { exact: true }).fill("workflow");
    await page.getByRole("button", { name: locale === "ja" ? "下書き保存" : "Save draft", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: locale === "ja" ? "保存しました" : "Saved." })).toBeVisible();
    const retained = (await data("intake")).intake.panels.find(panel => panel.title === title);
    expect(Boolean(retained)).toBe(true);
    expect(retained?.fields).toHaveLength(2);
  });

  test(`alpha17 operations phase B STARTER saved view and CSV (${locale})`, async ({ page, context }) => {
    const { get } = await start(page, context, locale, "STARTER");
    const name = "Support " + locale + " " + randomUUID();
    await page.goto(base + "/explore");
    await expect(page.getByRole("heading", { name: locale === "ja" ? "保存ビューとレポートショートカット" : "Saved views and report shortcuts" })).toBeVisible();
    await page.getByLabel(locale === "ja" ? "名前" : "Name", { exact: true }).fill(name);
    await page.getByLabel(locale === "ja" ? "Discordショートカット" : "Discord shortcut", { exact: false }).selectOption("support-health");
    await page.getByRole("button", { name: locale === "ja" ? "ビューを保存" : "Save view", exact: true }).click();
    await expect(page.getByRole("button", { name: name + " · 7d", exact: true })).toBeVisible();
    const csv = await get("/explore/data?format=csv");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("coverage");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`alpha17-phases-${locale}-explore-360.png`), fullPage: true });
  });

  test(`alpha17 operations phase C STARTER events, ICS and plan pause (${locale})`, async ({ page, context }) => {
    const { tier, get, data } = await start(page, context, locale, "STARTER");
    const title = "Weekly review " + locale + " " + randomUUID(), renamed = "Reviewed event " + locale + " " + randomUUID();
    await page.goto(base + "/operations?view=events");
    await page.getByLabel(locale === "ja" ? "タイトル" : "Title", { exact: true }).fill(title);
    await page.getByLabel(locale === "ja" ? "現地時刻の開始日時" : "Local start", { exact: true }).fill("2026-11-02T10:00");
    await page.getByLabel(locale === "ja" ? "繰り返し" : "Recurrence", { exact: false }).selectOption("WEEKLY");
    await page.getByRole("button", { name: locale === "ja" ? "イベントを保存" : "Save event", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const event = (await data("events")).events.find(value => value.title === title);
    expect(Boolean(event)).toBe(true);
    if (!event) throw new Error("SYNTHETIC_EVENT_NOT_FOUND");
    const ics = await get("/operations/data?format=ics&id=" + event.id);
    expect(ics.status()).toBe(200);
    expect(await ics.text()).toContain("RRULE:FREQ=WEEKLY");
    await page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).getByRole("button").click();
    await expect(page.getByLabel(locale === "ja" ? "現地時刻の開始日時" : "Local start", { exact: true })).toHaveValue("2026-11-02T10:00");
    await page.getByLabel(locale === "ja" ? "タイトル" : "Title", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: locale === "ja" ? "イベントを保存" : "Save event", exact: true }).click();
    await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
    expect((await data("events")).events.find(value => value.id === event.id)?.revision).toBe(event.revision + 1);
    await tier("FREE");
    expect((await data("events")).events.find(value => value.id === event.id)?.state).toBe("PAUSED_PLAN_LIMIT");
    expect((await get("/operations/data?format=ics&id=" + event.id)).status()).toBe(403);
    await tier("STARTER");
  });

  test(`alpha17 operations phase D GROWTH and SCALE API boundaries (${locale})`, async ({ page, context }) => {
    const { headers, tier, data } = await start(page, context, locale, "GROWTH");
    const growth = await data("integrations");
    expect(growth.access.features.api).toBe(true);
    expect(growth.access.features.webhooks).toBe(true);
    expect(growth.access.features.scheduled_reports).toBe(true);
    expect(growth.access.features.multi_guild).toBe(false);
    const credential = await context.request.post(base + "/operations/data", { headers, data: { action: "credential", input: { name: "Read integration " + locale + " " + randomUUID(), scopes: ["guild:read", "metrics:read"], kind: "PERSONAL" } } });
    expect(credential.status()).toBe(200);
    const token = (await credential.json()).token;
    expect(typeof token === "string" && /^nxs_/.test(token)).toBe(true);
    expect(JSON.stringify(await data("integrations")).includes(token)).toBe(false);
    await tier("SCALE");
    const scale = await data("organization");
    expect(scale.access.features.multi_guild).toBe(true);
    expect(scale.access.features.automation_sandbox).toBe(true);
    expect(scale.access.features.rbac).toBe(true);
    const cross = await context.request.post(base + "/operations/data", { headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }, data: { action: "event", input: {} } });
    expect(cross.status()).toBe(403);
    const extra = await context.request.post(base + "/explore/data", { headers, data: { action: "saveView", view: { name: "Injected", metric: "reply", memberId: user } } });
    expect(extra.status()).toBe(400);
    const oversized = await context.request.post(base + "/operations/data", { headers, data: "x".repeat(180001) });
    expect(oversized.status()).toBe(413);
  });

  test(`alpha17 operations phase E SCALE eight views fit 360px (${locale})`, async ({ page, context }) => {
    await start(page, context, locale, "SCALE");
    for (const view of ["attention", "reports", "playbooks", "improvements", "intake", "events", "organization", "integrations"]) {
      await page.goto(base + "/operations?view=" + view);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".page-head")).toContainText("SCALE");
      expect((await page.getByRole("heading", { level: 1 }).boundingBox())!.height).toBeLessThan(120);
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`alpha17-phases-${locale}-${view}-360.png`), fullPage: true });
    }
  });
});