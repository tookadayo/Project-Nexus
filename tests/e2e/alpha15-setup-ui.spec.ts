import {test, expect} from "@playwright/test";
import {createRequire} from "node:module";
import {readFile, mkdir} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import type {SetupSettings} from "../../apps/web/app/setup/model";

const requireHere = createRequire(import.meta.url);
const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {build(input: Record<string, unknown>): Promise<{outputFiles: {path: string; text: string}[]}>};
let html = "";
const guild = "321111111111111111";
const channel = "621111111111111111";
const role = "721111111111111111";
const applied: SetupSettings = {uiLanguage: "ja", timezone: "Asia/Tokyo", analysisScope: {mode: "exclude", channelIds: [channel]}, helperChannelId: null, helperEnabled: false, managerRoleIds: [role], newMemberGoals: ["reply", "playtest"], goalPreset: "early_access"};
const status = () => ({state: "SETUP_REQUIRED", guild: {id: guild, name: "Synthetic Community"}, settingsRevision: 7, setupVersion: 2, existing: true, missing: ["review"], settings: structuredClone(applied)});

test.beforeAll(async () => {
  const requireWeb = createRequire(resolve("apps/web/package.json"));
  const result = await esbuild.build({entryPoints: [resolve("tests/fixtures/alpha15-setup-ui.tsx")], bundle: true, platform: "browser", format: "iife", write: false, outfile: "setup.js", jsx: "automatic", alias: {react: dirname(requireWeb.resolve("react/package.json")), "react-dom": dirname(requireWeb.resolve("react-dom/package.json"))}});
  const script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? await readFile("apps/web/app/setup/setup.css", "utf8");
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-setup-ui", {recursive: true});
});

test.beforeEach(async ({page}) => {
  await page.route("**/setup-fixture*", route => route.fulfill({contentType: "text/html", body: html}));
  await page.route("**/data/setup/status?*", route => route.fulfill({json: status()}));
  await page.route("**/data/setup/candidates?*", route => route.fulfill({json: {channels: [{id: channel, name: "announcements", type: 0}], roles: [{id: role, name: "Community managers"}]}}));
});

for (const locale of ["ja", "en"] as const) {
  test(`four setup sections preserve settings and fit 320px (${locale})`, async ({page}) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/setup-fixture?locale=${locale}`);
    await expect(page.getByRole("combobox", {name: locale === "ja" ? "タイムゾーン" : "Time zone", exact: true})).toHaveValue("Asia/Tokyo");
    await page.setViewportSize({width: 320, height: 880});
    for (let index = 0; index < 4; index++) {
      await page.locator(".setup-steps button").nth(index).click();
      await expect(page.locator("#setup-section-heading")).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({path: `.local/alpha15-setup-ui/${locale}-section-${index + 1}-320.png`, fullPage: true});
    }
    await expect(page.locator(".setup-review")).toContainText("Community managers");
    await expect(page.getByRole("button", {name: locale === "ja" ? "確認した設定を適用" : "Apply reviewed settings", exact: true})).toBeDisabled();
    expect(errors).toEqual([]);
    await page.setViewportSize({width: 640, height: 960});
    await page.locator(".setup-page").evaluate(element => { (element as HTMLElement).style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `.local/alpha15-setup-ui/${locale}-review-200-percent.png`, fullPage: true});
  });
}

test("draft save is separate, a field can be reverted, and rapid clicks issue one write", async ({page}) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/data/setup/draft?*", async route => {
    const body = route.request().postDataJSON() as {patch: Partial<SetupSettings>};
    requests.push(body);
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({json: {id: "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", version: requests.length, settingsRevision: 7, settings: {...applied, ...body.patch}, appliedRevision: null}});
  });
  await page.goto("/setup-fixture?locale=en");
  const timezone = page.getByRole("combobox", {name: "Time zone", exact: true});
  await timezone.fill("UTC");
  const save = page.getByRole("button", {name: "Save draft", exact: true});
  await save.dblclick();
  await expect(page.getByRole("status").last()).toContainText("Draft saved");
  expect(requests.length).toBe(1);
  await timezone.fill("Asia/Tokyo");
  await save.click();
  await expect(page.getByRole("status").last()).toContainText("Draft saved");
  expect(requests[1]?.patch).toEqual({timezone: "Asia/Tokyo"});
  await page.locator(".setup-steps button").nth(3).click();
  await expect(page.getByRole("checkbox", {name: "I reviewed this saved draft and want to apply it to the current settings."})).toBeVisible();
});

test("a lost save response is reconciled by ID, survives reload and never resubmits", async ({page}) => {
  let writes = 0;
  await page.route("**/data/setup/draft?*", route => { writes++; return route.abort("failed"); });
  await page.route("**/data/setup/requests/*", route => route.fulfill({json: {state: "NOT_FOUND"}}));
  await page.goto("/setup-fixture?locale=en");
  await page.getByRole("button", {name: "Save draft", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Check the request result"})).toBeVisible();
  await page.getByRole("button", {name: "Check result", exact: true}).click();
  await expect(page.getByRole("button", {name: "Save draft", exact: true})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", {name: "Check the request result"})).toBeVisible();
  expect(writes).toBe(1);
});

test("version conflict preserves input and offers an explicit reload", async ({page}) => {
  await page.route("**/data/setup/draft?*", route => route.fulfill({status: 409, json: {error: "REVISION_CONFLICT"}}));
  await page.goto("/setup-fixture?locale=en");
  await page.getByRole("combobox", {name: "Time zone", exact: true}).fill("UTC");
  await page.getByRole("button", {name: "Save draft", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Time zone", exact: true})).toHaveValue("UTC");
  await page.getByRole("button", {name: "Discard unsaved edits and reload", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Time zone", exact: true})).toHaveValue("Asia/Tokyo");
});

test("unavailable candidates, current permission denial and verification failure have distinct states", async ({page}) => {
  await page.route("**/data/setup/candidates?*", route => route.fulfill({status: 503, json: {error: "AUTHORIZATION_UNAVAILABLE"}}));
  await page.goto("/setup-fixture?locale=en");
  await page.locator(".setup-steps button").nth(1).click();
  await expect(page.getByRole("alert")).toContainText("saved scope is preserved");
  await page.route("**/data/setup/status?*", route => route.fulfill({status: 403, json: {error: "ADMIN_REQUIRED"}}));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("do not have permission");
  await page.route("**/data/setup/status?*", route => route.fulfill({status: 503, json: {error: "AUTHORIZATION_UNAVAILABLE"}}));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("could not be verified");
});

test("installation request, live installation confirmation and link verification advance automatically", async ({page, context}) => {
  let installed = false, linked = false, verifies = 0, introductions = 0;
  await context.route("https://discord.com/oauth2/authorize*", route => route.fulfill({contentType: "text/html", body: "Synthetic Discord installation"}));
  await page.route("**/data/setup/status?*", route => route.fulfill({json: !installed ? {state: "BOT_REQUIRED", guild: {id: guild, name: "Synthetic Community"}, missing: ["bot"], installUrl: "https://discord.com/oauth2/authorize?client_id=321111111111111119"} : {...status(), state: linked ? "SETUP_REQUIRED" : "LINK_REQUIRED"}}));
  await page.route("**/data/setup/requests?*", route => { introductions++; installed = true; return route.fulfill({json: {requestId: route.request().postDataJSON().requestId, state: "AWAITING_INSTALLATION", installUrl: "https://discord.com/oauth2/authorize?client_id=321111111111111119"}}); });
  await page.route("**/data/setup/verify?*", route => { verifies++; linked = true; return route.fulfill({json: {state: "VERIFIED", guildId: guild}}); });
  await page.goto("/setup-fixture?locale=en");
  await page.getByRole("button", {name: "Add NEXUS in Discord (new tab)"}).click();
  await expect(page.getByRole("combobox", {name: "Time zone", exact: true})).toHaveValue("Asia/Tokyo");
  expect(introductions).toBe(1);
  expect(verifies).toBe(1);
});

test("optional blank fields can be saved and applied only after review", async ({page}) => {
  const optional = {...applied, managerRoleIds: [], newMemberGoals: []};
  let applies = 0;
  await page.route("**/data/setup/status?*", route => route.fulfill({json: {...status(), settings: optional}}));
  await page.route("**/data/setup/draft?*", route => route.fulfill({json: {id: "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", version: 1, settingsRevision: 7, settings: optional, appliedRevision: null}}));
  await page.route("**/data/setup/apply?*", route => { applies++; expect(route.request().postDataJSON().expectedSettingsRevision).toBe(7); return route.fulfill({json: {settingsRevision: 8, complete: true}}); });
  await page.route("**/auth/select?*", route => route.fulfill({contentType: "text/html", body: "Synthetic dashboard"}));
  await page.goto("/setup-fixture?locale=en");
  await page.getByRole("button", {name: "Save draft", exact: true}).click();
  await expect(page.getByRole("status").last()).toContainText("Draft saved");
  await page.locator(".setup-steps button").nth(3).click();
  const apply = page.getByRole("button", {name: "Apply reviewed settings", exact: true});
  await expect(apply).toBeDisabled();
  await page.getByRole("checkbox", {name: "I reviewed this saved draft and want to apply it to the current settings."}).check();
  await apply.click();
  await page.waitForURL(`**/auth/select?guild=${guild}`);
  expect(applies).toBe(1);
});

test("back and cancel preserve edits; Escape returns focus and explicit discard leaves once", async ({page}) => {
  await page.route("**/servers", route => route.fulfill({contentType: "text/html", body: "Synthetic server selection"}));
  await page.goto("/setup-fixture?locale=en");
  await page.getByRole("combobox", {name: "Time zone", exact: true}).fill("UTC");
  await page.getByRole("button", {name: "Next", exact: true}).click();
  await page.getByRole("button", {name: "Back", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Time zone", exact: true})).toHaveValue("UTC");
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", {name: "Cancel", exact: true})).toBeFocused();
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
  await page.getByRole("button", {name: "Discard and return", exact: true}).click();
  await page.waitForURL("**/servers");
});

test("completed setup returns home while explicit edit keeps the applied values", async ({page}) => {
  await page.route("**/data/setup/status?*", route => route.fulfill({json: {...status(), state: "COMPLETE", setupVersion: 3}}));
  await page.route("**/auth/select?*", route => route.fulfill({contentType: "text/html", body: "Synthetic dashboard"}));
  await page.goto("/setup-fixture?locale=en&edit=1");
  await expect(page.getByRole("combobox", {name: "Time zone", exact: true})).toHaveValue("Asia/Tokyo");
  await page.goto("/setup-fixture?locale=en");
  await page.waitForURL(`**/auth/select?guild=${guild}`);
});

test("an unknown Discord setup notice is visible without offering resend", async ({page}) => {
  await page.route("**/data/setup/status?*", route => route.fulfill({json: {...status(), installNotice: {state: "UNKNOWN", reason: "RESULT_UNKNOWN", nextAction: "CONTINUE_WEB_SETUP"}}}));
  await page.goto("/setup-fixture?locale=en");
  await expect(page.getByText("Send result unknown. Not sent again.", {exact: false})).toBeVisible();
  await expect(page.getByRole("button", {name: /resend/i})).toHaveCount(0);
});

for (const locale of ["ja", "en"] as const) for (const noticeState of ["WEB_ONLY", "FAILED", "UNKNOWN"] as const) {
  test(`unavailable Discord notice keeps a visible Web continuation (${locale}, ${noticeState})`, async ({page}) => {
    await page.route("**/data/setup/status?*", route => route.fulfill({json: {...status(), installNotice: {state: noticeState, reason: noticeState === "UNKNOWN" ? "RESULT_UNKNOWN" : "DELIVERY_UNAVAILABLE", nextAction: "CONTINUE_WEB_SETUP"}}}));
    await page.setViewportSize({width: 320, height: 880});
    await page.goto(`/setup-fixture?locale=${locale}`);
    await expect(page.getByText(locale === "ja" ? "Discordの案内が届かない場合も、この画面から設定を続けられます。" : "You can continue setup here even if the Discord guide is unavailable.", {exact: false})).toBeVisible();
    await expect(page.getByRole("button", {name: /resend|再送/i})).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (noticeState === "WEB_ONLY") await page.screenshot({path: `.local/alpha15-setup-ui/${locale}-notice-web-continuation-320.png`, fullPage: true});
  });
}

test("installation polling pauses in a hidden tab and reaches a manual retry boundary", async ({page}) => {
  let reads = 0;
  await page.clock.install();
  await page.route("**/data/setup/status?*", route => { reads++; return route.fulfill({json: {state: "BOT_REQUIRED", guild: {id: guild, name: "Synthetic Community"}, missing: ["bot"], installUrl: "https://discord.com/oauth2/authorize?client_id=321111111111111119"}}); });
  await page.goto("/setup-fixture?locale=en");
  await expect(page.getByRole("button", {name: "Check installation", exact: true})).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "hidden"}); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(10000);
  expect(reads).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "visible"}); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(65000);
  await expect(page.getByText("Automatic checks have paused.", {exact: false})).toBeVisible();
});

