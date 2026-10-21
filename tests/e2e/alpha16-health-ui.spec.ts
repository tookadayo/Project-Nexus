import {test, expect} from "./alpha16-browser-fixture";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
import {healthFixture, healthPreviewFixture} from "../fixtures/alpha16-health";
const web = createRequire(resolve("apps/web/package.json"));
const esbuild = createRequire(createRequire(import.meta.url).resolve("tsx"))("esbuild") as {build(input: Record<string, unknown>): Promise<{outputFiles: {text: string}[]}>};
let html = "";
// Authored only for the parent checkpoint; no build or browser execution was performed during implementation.
test.beforeAll(async () => {
  const result = await esbuild.build({entryPoints: [resolve("tests/fixtures/alpha16-health-ui.tsx")], bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic", alias: {react: dirname(web.resolve("react/package.json")), "react-dom": dirname(web.resolve("react-dom/package.json"))}});
  html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${result.outputFiles[0]!.text.replaceAll("</script", "<\\/script")}</script>`;
});
for (const locale of ["ja", "en"] as const) {
  test(`${locale}: unobserved health stays unknown, plan difference and legacy preview remain read-only`, async ({page}) => {
    const value = healthFixture(); let reads = 0, mutations = 0;
    await page.clock.install({time: new Date(value.readAt)});
    await page.route("**/*", route => route.fulfill({status: 404, body: "SYNTHETIC_ONLY"}));
    await page.route("**/alpha16-health?*", route => route.fulfill({contentType: "text/html", body: html}));
    await page.route("**/api/health/**", route => {if (route.request().method() !== "GET") mutations++; reads++; return route.fulfill({json: route.request().url().includes("lifecycle-preview") ? healthPreviewFixture : value});});
    await page.goto(`/alpha16-health?locale=${locale}`);
    await expect(page.getByText(locale === "ja" ? "確認が必要な前提条件があります。" : "Some prerequisites need attention.", {exact: true})).toBeVisible();
    await page.getByRole("button", {name: locale === "ja" ? "計測の状態" : "Data health", exact: true}).click();
    await expect(page.getByText(locale === "ja" ? "保存済みのソース観測はありません。正常とも、成功履歴がないとも判断できません。" : "No source health observations are saved. This does not establish that sources are healthy or have never succeeded.", {exact: true})).toBeVisible();
    await page.getByRole("button", {name: locale === "ja" ? "権限の状態" : "Permission health", exact: true}).click();
    await expect(page.getByRole("row", {name: /manageRoles/})).toContainText(locale === "ja" ? "未確認・未観測" : "Unknown / not observed");
    await page.getByRole("button", {name: locale === "ja" ? "設定と実行の事前確認" : "Lifecycle preview", exact: true}).click();
    await page.getByRole("button", {name: locale === "ja" ? "設定の差分を確認" : "Compare saved configuration", exact: true}).dblclick();
    await expect(page.getByText(locale === "ja" ? "現在のプランでは利用対象外です。比較を閲覧しても有効にはなりません。" : "The current plan does not permit using this configuration. Reading the comparison does not enable it.", {exact: true})).toBeVisible();
    await expect(page.getByText(locale === "ja" ? "この保存済み応答では、設定の比較だけを利用できます。" : "Only configuration comparison is available for this saved response.", {exact: true})).toBeVisible();
    expect(reads).toBeGreaterThanOrEqual(2); expect(mutations).toBe(0);
    await expect(page.getByRole("link", {name: locale === "ja" ? "ダッシュボードへ戻る" : "Back to dashboard", exact: true})).toHaveAttribute("href", "/dashboard");
  });
  test(`${locale}: expiry removes current permission claims while keeping original observations`, async ({page}) => {
    const value = healthFixture(); value.plan.key = "GROWTH"; value.plan.features[1]!.allowed = true;
    value.permission = {...value.permission, observedAt: value.readAt, expiresAt: "2026-10-16T12:00:02.000Z", validity: "CURRENT", botPermissions: [{key: "manageGuild", observed: true, effective: true}, {key: "manageRoles", observed: false, effective: false}, {key: "sendMessages", observed: null, effective: null}]};
    value.data.sources = [{observationId: "fixture", revision: "1", sourceType: "source_health_observation_v1", targetType: "GUILD", targetId: value.guildId, liveVersion: "3", observedAt: "2026-10-16T10:00:00.000Z", expiresAt: "2026-10-16T11:00:00.000Z", validity: "EXPIRED", evidenceAvailable: false, quality: "UNKNOWN", state: "UNKNOWN", lastSuccessfulIngestAt: null, neverSucceeded: null, coverage: null}];
    await page.clock.install({time: new Date(value.readAt)});
    await page.route("**/*", route => route.fulfill({status: 404})); await page.route("**/alpha16-health?*", route => route.fulfill({contentType: "text/html", body: html})); await page.route("**/api/health/**", route => route.fulfill({json: value}));
    await page.goto(`/alpha16-health?locale=${locale}`);
    await page.getByRole("button", {name: locale === "ja" ? "権限の状態" : "Permission health", exact: true}).click();
    const row = page.getByRole("row", {name: /manageGuild/}); await expect(row).toContainText(locale === "ja" ? "許可あり" : "Allowed");
    await page.clock.fastForward(3000); await expect(row).toContainText(locale === "ja" ? "未確認・未観測" : "Unknown / not observed");
    await expect(row.getByRole("cell").first()).toHaveText(locale === "ja" ? "許可あり" : "Allowed");
    await page.getByRole("button", {name: locale === "ja" ? "計測の状態" : "Data health", exact: true}).click();
    await expect(page.getByText(/source_health_observation_v1/).first()).toBeVisible();
    await expect(page.getByText(locale === "ja" ? /観測の有効期限切れ/ : /Observation expired/).last()).toBeVisible();
  });
  test(`${locale}: permission failure, network failure, cancellation and repeated refresh do not appear healthy or empty`, async ({page}) => {
    let mode = "denied", active = 0, maximum = 0, release: (() => void) | undefined;
    await page.route("**/*", route => route.fulfill({status: 404})); await page.route("**/alpha16-health?*", route => route.fulfill({contentType: "text/html", body: html}));
    await page.route("**/api/health/**", async route => {
      active++; maximum = Math.max(maximum, active);
      try {
        if (mode === "denied") return await route.fulfill({status: 403, json: {error: "NEXUS_ROLE_REQUIRED"}});
        if (mode === "network") return await route.abort("failed");
        await new Promise<void>(resolve => {release = resolve;});
        await route.fulfill({json: healthFixture()}).catch(() => {});
      } finally {active--;}
    });
    await page.goto(`/alpha16-health?locale=${locale}`);
    await expect(page.getByRole("alert")).toContainText("NEXUS_ROLE_REQUIRED");
    await expect(page.getByRole("heading", {name: locale === "ja" ? "準備状況" : "Readiness", exact: true})).toHaveCount(0);
    mode = "network"; await page.getByRole("button", {name: locale === "ja" ? "保存済み状態を再取得" : "Refresh saved observations", exact: true}).click();
    await expect(page.getByRole("alert")).toBeVisible();
    mode = "pending"; await page.getByRole("button", {name: locale === "ja" ? "保存済み状態を再取得" : "Refresh saved observations", exact: true}).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(page.getByRole("button", {name: locale === "ja" ? "保存済み状態を再取得" : "Refresh saved observations", exact: true})).toBeDisabled();
    await page.getByRole("button", {name: locale === "ja" ? "取得を取り消す" : "Cancel reading", exact: true}).click(); release?.();
    await expect(page.getByText(locale === "ja" ? "取得を取り消しました。設定は変更されていません。" : "Reading canceled. No settings were changed.", {exact: true})).toBeVisible();
    expect(maximum).toBe(1); await expect(page.getByRole("heading", {name: locale === "ja" ? "準備状況" : "Readiness", exact: true})).toHaveCount(0);
  });
}
