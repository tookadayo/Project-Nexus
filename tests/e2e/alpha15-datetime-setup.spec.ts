import {test, expect} from "@playwright/test";
import {createRequire} from "node:module";
import {readFile, mkdir} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import type {SetupSettings} from "../../apps/web/app/setup/model";

const requireHere = createRequire(import.meta.url);
const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {build(input: Record<string, unknown>): Promise<{outputFiles: {path: string; text: string}[]}>};
const guild = "321111111111111111";
const settings: SetupSettings = {uiLanguage: "ja", timezone: "UTC", analysisScope: {mode: "include", channelIds: []}, helperChannelId: null, helperEnabled: false, managerRoleIds: [], newMemberGoals: []};
const initial = () => ({state: "SETUP_REQUIRED", guild: {id: guild, name: "Synthetic Community"}, settingsRevision: 0, setupVersion: 2, existing: false, timeZoneSource: "missing", missing: ["review"], settings: structuredClone(settings)});
let html = "";
test.beforeAll(async () => {
  const requireWeb = createRequire(resolve("apps/web/package.json"));
  const result = await esbuild.build({entryPoints: [resolve("tests/fixtures/alpha15-setup-ui.tsx")], bundle: true, platform: "browser", format: "iife", write: false, outfile: "setup.js", jsx: "automatic", alias: {react: dirname(requireWeb.resolve("react/package.json")), "react-dom": dirname(requireWeb.resolve("react-dom/package.json"))}});
  const script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? await readFile("apps/web/app/setup/setup.css", "utf8");
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-datetime-20261016/setup", {recursive: true});
});
test.beforeEach(async ({page}) => {
  await page.route("**/setup-fixture*", route => route.fulfill({contentType: "text/html", body: html}));
  await page.route("**/data/setup/status?*", route => route.fulfill({json: initial()}));
  await page.route("**/data/setup/candidates?*", route => route.fulfill({json: {channels: [], roles: []}}));
});

for (const locale of ["ja", "en"] as const) {
  const zoneLabel = locale === "ja" ? "タイムゾーン" : "Time zone";
  const confirmLabel = locale === "ja" ? "この地域を共有予定に使うことを確認しました。" : "I confirm this region for shared schedules.";
  const saveLabel = locale === "ja" ? "下書きを保存" : "Save draft";
  test(`DT10 browser region requires confirmation, saves and reloads without language inference (${locale})`, async ({page}) => {
    let saved: {id: string; version: number; settingsRevision: number; appliedRevision: null; settings: SetupSettings} | undefined;
    const writes: {patch: Partial<SetupSettings>}[] = [];
    await page.route("**/data/setup/status?*", route => route.fulfill({json: {...initial(), ...(saved ? {draft: saved} : {})}}));
    await page.route("**/data/setup/draft?*", route => {
      const body = route.request().postDataJSON() as {patch: Partial<SetupSettings>}; writes.push(body);
      saved = {id: "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", version: 1, settingsRevision: 0, appliedRevision: null, settings: {...settings, ...body.patch}};
      return route.fulfill({json: saved});
    });
    await page.goto(`/setup-fixture?locale=${locale}`);
    await expect(page.getByRole("combobox", {name: zoneLabel, exact: true})).toHaveValue("America/New_York");
    await expect(page.getByRole("checkbox", {name: confirmLabel})).not.toBeChecked();
    await expect(page.getByRole("button", {name: saveLabel, exact: true})).toBeDisabled();
    await page.getByRole("checkbox", {name: confirmLabel}).focus(); await page.keyboard.press("Space");
    await page.getByRole("button", {name: saveLabel, exact: true}).dblclick();
    await expect.poll(() => writes.length).toBe(1); expect(writes[0]!.patch.timezone).toBe("America/New_York");
    await page.reload();
    await expect(page.getByRole("combobox", {name: zoneLabel, exact: true})).toHaveValue("America/New_York");
    await expect(page.getByRole("checkbox", {name: confirmLabel})).toBeChecked();
    await page.setViewportSize({width: 320, height: 880});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `.local/alpha15-datetime-20261016/setup/${locale}-browser-confirmed.png`, fullPage: true});
  });
  test(`DT10 saved guild and draft regions outrank the device and display language (${locale})`, async ({page}) => {
    const applied = {...initial(), existing: true, settingsRevision: 7, timeZoneSource: "saved", settings: {...settings, timezone: "Asia/Tokyo"}};
    await page.route("**/data/setup/status?*", route => route.fulfill({json: applied}));
    await page.goto(`/setup-fixture?locale=${locale}`);
    await expect(page.getByRole("combobox", {name: zoneLabel, exact: true})).toHaveValue("Asia/Tokyo");
    await expect(page.getByRole("checkbox", {name: confirmLabel})).toBeChecked();
    await page.getByRole("combobox", {name: locale === "ja" ? "表示言語" : "Display language", exact: true}).selectOption("en");
    await expect(page.getByRole("combobox", {name: zoneLabel, exact: true})).toHaveValue("Asia/Tokyo");
    await page.route("**/data/setup/status?*", route => route.fulfill({json: {...applied, draft: {id: "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", version: 1, settingsRevision: 7, appliedRevision: null, settings: {...settings, timezone: "Europe/Paris"}}}}));
    await page.reload();
    await expect(page.getByRole("combobox", {name: zoneLabel, exact: true})).toHaveValue("Europe/Paris");
    await expect(page.getByRole("checkbox", {name: confirmLabel})).toBeChecked();
  });
  test(`DT10 unavailable browser region requires an explicit selection and never assumes UTC (${locale})`, async ({page}) => {
    await page.addInitScript(() => { const original = Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions = function () { const result = original.call(this); return {...result, timeZone: ""}; }; });
    let patch: Partial<SetupSettings> | undefined;
    await page.route("**/data/setup/draft?*", route => { patch = route.request().postDataJSON().patch; return route.fulfill({json: {id: "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", version: 1, settingsRevision: 0, appliedRevision: null, settings: {...settings, ...patch}}}); });
    await page.goto(`/setup-fixture?locale=${locale}`);
    const zone = page.getByRole("combobox", {name: zoneLabel, exact: true});
    await expect(zone).toHaveValue(""); await expect(page.getByRole("button", {name: saveLabel, exact: true})).toBeDisabled();
    await zone.fill("Moon/Unknown"); await expect(page.getByRole("checkbox", {name: confirmLabel})).toBeDisabled();
    await zone.fill("Asia/Tokyo"); await expect(page.getByRole("button", {name: saveLabel, exact: true})).toBeDisabled();
    await page.getByRole("checkbox", {name: confirmLabel}).check(); await page.getByRole("button", {name: saveLabel, exact: true}).click();
    await expect.poll(() => patch?.timezone).toBe("Asia/Tokyo");
  });
  test(`DT10 unchanged UTC is sent explicitly after confirmation (${locale})`, async ({page}) => {
    await page.addInitScript(() => { const original = Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions = function () { return {...original.call(this), timeZone: "UTC"}; }; });
    let patch: Partial<SetupSettings> | undefined;
    await page.route("**/data/setup/draft?*", route => { patch = route.request().postDataJSON().patch; return route.fulfill({json: {id: "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef", version: 1, settingsRevision: 0, appliedRevision: null, settings: {...settings, ...patch}}}); });
    await page.goto(`/setup-fixture?locale=${locale}`);
    await expect(page.getByRole("combobox", {name: zoneLabel, exact: true})).toHaveValue("UTC");
    await expect(page.getByRole("button", {name: saveLabel, exact: true})).toBeDisabled();
    await page.getByRole("checkbox", {name: confirmLabel}).check(); await page.getByRole("button", {name: saveLabel, exact: true}).click();
    await expect.poll(() => patch?.timezone).toBe("UTC");
  });
  test(`DT13 editing a saved region needs renewed confirmation and survives Back and Cancel (${locale})`, async ({page}) => {
    await page.route("**/data/setup/status?*", route => route.fulfill({json: {...initial(), existing: true, settingsRevision: 7, timeZoneSource: "saved", settings: {...settings, timezone: "Asia/Tokyo"}}}));
    await page.goto(`/setup-fixture?locale=${locale}`);
    const zone = page.getByRole("combobox", {name: zoneLabel, exact: true});
    await zone.fill("Europe/Paris"); await expect(page.getByRole("checkbox", {name: confirmLabel})).not.toBeChecked();
    await expect(page.getByRole("button", {name: locale === "ja" ? "次へ" : "Next", exact: true})).toBeDisabled();
    await page.getByRole("checkbox", {name: confirmLabel}).check();
    await page.getByRole("button", {name: locale === "ja" ? "次へ" : "Next", exact: true}).click();
    await page.getByRole("button", {name: locale === "ja" ? "戻る" : "Back", exact: true}).click();
    await expect(zone).toHaveValue("Europe/Paris");
    await page.getByRole("button", {name: locale === "ja" ? "取消" : "Cancel", exact: true}).click();
    await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
    await expect(zone).toHaveValue("Europe/Paris"); await expect(page.getByRole("checkbox", {name: confirmLabel})).toBeChecked();
  });
}
