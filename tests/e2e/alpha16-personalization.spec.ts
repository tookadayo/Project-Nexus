import { expect, test, type Page } from "./alpha16-browser-fixture";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
let html = "";
test.beforeAll(async () => {
  const local = createRequire(import.meta.url), web = createRequire(resolve("apps/web/package.json"));
  const esbuild = createRequire(local.resolve("tsx"))("esbuild") as {build(input: Record<string, unknown>): Promise<{outputFiles: {path: string; text: string}[]}>};
  const result = await esbuild.build({stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PersonalizationWorkspace} from ${JSON.stringify(resolve("apps/web/app/preferences/view.tsx"))};import ${JSON.stringify(resolve("apps/web/app/preferences/personalization.css"))};const p=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<PersonalizationWorkspace locale={p.get('locale')==='ja'?'ja':'en'} kind={p.get('kind')==='templates'?'templates':'preferences'} guildId="321111111111111111"/>);`,
    resolveDir: resolve("."), sourcefile: "alpha16-personalization-fixture.tsx", loader: "tsx",
  }, bundle: true, platform: "browser", format: "iife", write: false, outfile: "personalization.js", jsx: "automatic", alias: {react: dirname(web.resolve("react/package.json")), "react-dom": dirname(web.resolve("react-dom/package.json"))}});
  const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text, css = result.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test.beforeEach(async ({page}) => {
  await page.route("**/alpha16-personalization-fixture*", (route) => route.fulfill({contentType: "text/html", body: html}));
  await page.addInitScript(() => {document.cookie = "nexus_csrf=personalization-synthetic-only; path=/; SameSite=Strict";});
});
async function mock(page: Page, options: {enabled?: boolean; status?: number; conflict?: boolean; unknown?: boolean; existingTemplate?: boolean} = {}) {
  const actual: {body: Record<string, unknown>; headers: Record<string, string>}[] = [];
  let version = 1, settings = {suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"};
  const templateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const items = options.existingTemplate ? [{templateId, name: "Synthetic template", version: 1, updatedAt: "2026-10-16T12:00:00Z", expiresAt: "2026-10-16T13:00:00Z"}] : [];
  await page.route(/\/(?:templates|preferences)\/data(?:\?.*)?$/, async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (data: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify({ok: true, data})});
    if (options.status) return route.fulfill({status: options.status, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: options.status === 403 ? "PERMISSION_REVOKED" : "UNAVAILABLE"}})});
    if (url.searchParams.get("op") === "request-key") return reply({key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expiresAt: "2026-10-16T12:05:00Z"}, 201);
    if (url.searchParams.get("op") === "request") return reply({state: "UNKNOWN", result: null});
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>; actual.push({body, headers: request.headers()});
      if (options.unknown) return route.abort("failed");
      if (options.conflict) return route.fulfill({status: 412, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: "VERSION_MISMATCH"}})});
      if (body.operation === "PREFERENCE_SAVE") {settings = body.settings as typeof settings; ++version; return reply({version, state: "ACTIVE"});}
      if (body.operation === "PREFERENCE_RESET") {settings = {suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"}; ++version; return reply({version, state: "RESET"});}
      if (body.operation === "TEMPLATE_DRAFT") return reply({flowId: "template-synthetic-request", draftRevision: 1, state: "DRAFT", activated: false});
      return reply({templateId, version: 1, state: "ACTIVE"});
    }
    const readiness = {enabled: options.enabled ?? false, reasonCode: options.enabled ? null : "PERSONALIZATION_RETENTION_UNCONFIGURED", missingClasses: options.enabled ? [] : ["TEMPLATE_DEFINITION", "PERSONAL_PREFERENCE", "PERSONALIZATION_REQUEST"]};
    if (url.searchParams.get("op") === "sources") return reply({items: [{id: "source-flow", name: "Source flow", draftRevision: 4}]});
    if (url.pathname.startsWith("/templates")) return reply({items, ...(url.searchParams.has("id") ? {definition: {id: "source-flow", name: "Source", body: [{kind: "end"}]}} : {}), readiness, permissions: ["READ", "CONFIGURE"], status: items.length ? "AVAILABLE" : "EMPTY", observedAt: "2026-10-16T12:00:00Z"});
    return reply({version, settings, source: "SAVED", updatedAt: "2026-10-16T12:00:00Z", expiresAt: "2026-10-16T13:00:00Z", readiness, permissions: ["READ"], observedAt: "2026-10-16T12:00:00Z"});
  });
  return actual;
}

for (const locale of ["ja", "en"] as const) for (const kind of ["templates", "preferences"] as const) {
  test(`independent lifetime gate at 320px ${kind}/${locale}`, async ({page}) => {
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({width: 320, height: 900}); await mock(page);
    await page.goto(`/alpha16-personalization-fixture?locale=${locale}&kind=${kind}`);
    await expect(page.getByText(locale === "ja" ? "保存は未有効化です" : "Saving is not active", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: kind === "templates" ? locale === "ja" ? "保存済みフローから作る" : "Create from a saved flow" : locale === "ja" ? "自分の設定を保存" : "Save my preferences", exact: true})).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(errors).toEqual([]);
  });
}
test("personal preferences use one prepared request, current version and no caller identity", async ({page}) => {
  const requests = await mock(page, {enabled: true}); await page.goto("/alpha16-personalization-fixture");
  await page.getByRole("combobox", {name: "Recommended responses in my list", exact: true}).selectOption("HIDE");
  await page.getByRole("button", {name: "Save my preferences", exact: true}).dblclick();
  await expect(page.getByText("Your changes were saved.", {exact: true})).toBeVisible();
  expect(requests).toHaveLength(1); expect(requests[0]!.body).toEqual({operation: "PREFERENCE_SAVE", expectedVersion: 1, settings: {suggestionDisplay: "HIDE", personalNotifications: "UNCHANGED"}});
  expect(requests[0]!.headers["if-match"]).toBe('"1"'); expect(requests[0]!.headers["idempotency-key"]).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  expect(requests[0]!.headers["x-nexus-guild"]).toBe("321111111111111111"); expect(requests[0]!.headers["x-nexus-csrf"]).toBe("personalization-synthetic-only");
});
test("template cancel sends no mutation and applying a template creates a draft only", async ({page}) => {
  const requests = await mock(page, {enabled: true, existingTemplate: true}); await page.goto("/alpha16-personalization-fixture?kind=templates");
  await page.getByRole("button", {name: "Duplicate", exact: true}).click();
  await page.getByRole("textbox", {name: "Template name", exact: true}).fill("Cancelled copy");
  await page.getByRole("button", {name: "Cancel", exact: true}).click(); expect(requests).toHaveLength(0);
  await page.getByRole("button", {name: "Create a new draft", exact: true}).click();
  await page.getByRole("textbox", {name: "New draft name", exact: true}).fill("Draft only");
  await page.getByRole("button", {name: "Create draft only", exact: true}).click();
  await expect(page.getByRole("link", {name: "Open the new draft", exact: true})).toHaveAttribute("href", "/automation?flow=template-synthetic-request");
  expect(requests).toHaveLength(1); expect(requests[0]!.body).toMatchObject({operation: "TEMPLATE_DRAFT", expectedVersion: 1, draftName: "Draft only"});
  expect(requests[0]!.body).not.toHaveProperty("activate");
});
for (const status of [403, 503]) test(`read failure ${status} remains distinct from an empty template list`, async ({page}) => {
  await mock(page, {status}); await page.goto("/alpha16-personalization-fixture?kind=templates");
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("heading", {name: "No saved templates", exact: true})).toHaveCount(0);
});
test("version conflict is visible without silently overwriting a preference", async ({page}) => {
  await mock(page, {enabled: true, conflict: true}); await page.goto("/alpha16-personalization-fixture");
  await page.getByRole("button", {name: "Save my preferences", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("changed or expired");
});
test("unknown writes retain the prepared identity for read-only result checks", async ({page}) => {
  const requests = await mock(page, {enabled: true, unknown: true}); await page.goto("/alpha16-personalization-fixture");
  await page.getByRole("button", {name: "Save my preferences", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("result is unconfirmed");
  await expect(page.getByRole("button", {name: "Save my preferences", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "Check this request's result", exact: true}).click();
  expect(requests).toHaveLength(1);
});
