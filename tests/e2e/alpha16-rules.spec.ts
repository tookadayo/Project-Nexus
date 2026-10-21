import { test, expect, type Page } from "./alpha16-browser-fixture";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { RulesCatalog, RuleSuggestion } from "../../apps/web/app/rules/view";

let html = "";
test.beforeAll(async () => {
  const requireHere = createRequire(import.meta.url), requireWeb = createRequire(resolve("apps/web/package.json"));
  const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
    build(input: Record<string, unknown>): Promise<{outputFiles: {path: string; text: string}[]}>;
  };
  const result = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RulesWorkspace} from ${JSON.stringify(resolve("apps/web/app/rules/view.tsx"))}; import ${JSON.stringify(resolve("apps/web/app/rules/rules.css"))}; const locale = new URLSearchParams(location.search).get('locale') === 'ja' ? 'ja' : 'en'; document.documentElement.lang=locale; createRoot(document.getElementById('root')).render(<main className="rules-page"><RulesWorkspace locale={locale} guildId="321111111111111111" guildName="Synthetic fixture community" /></main>);`,
      resolveDir: resolve("."), sourcefile: "alpha16-rules-ui-fixture.tsx", loader: "tsx",
    },
    bundle: true, platform: "browser", format: "iife", write: false, outfile: "rules-fixture.js", jsx: "automatic",
    alias: {react: dirname(requireWeb.resolve("react/package.json")), "react-dom": dirname(requireWeb.resolve("react-dom/package.json"))},
  });
  const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test.beforeEach(async ({page}) => {
  await page.route("**/alpha16-rules-fixture*", (route) => route.fulfill({contentType: "text/html", body: html}));
  await page.addInitScript(() => {document.cookie = "nexus_csrf=synthetic-csrf-only; path=/; SameSite=Strict";});
});

const ruleIds = ["ONB-001", "HELP-001", "RET-001", "ENG-001", "EVENT-001", "REPORT-001", "AUTO-001", "AUTO-002", "PERM-001", "EXP-001", "PLAY-001", "DATA-001", "COMM-001"];
const catalog = (enabled = false): RulesCatalog => ({
  readiness: {enabled, reasonCodes: enabled ? [] : ["RETENTION_NOT_APPROVED", "OPERATIONAL_CONFIG_NOT_ACTIVATED"], permissions: ["READ", "ANALYZE", "OPERATE", "CONFIGURE", "GOVERN"], environmentStatus: "ALPHA17_PENDING"},
  rules: ruleIds.map((ruleId) => ({ruleId, domain: "SYNTHETIC"})),
  cases: Array.from({length: 20}, (_, index) => ({id: `CASE${String(index + 1).padStart(2, "0")}`, revision: "fixture-v1", sourceMappings: [{id: `source-${index + 1}`, confirmed: false, codeRefs: []}], actions: [{id: `review-${index + 1}`, mode: "REVIEW_ONLY", ownerRole: "ADMIN"}], audience: index >= 12 && index <= 16 ? "RESTRICTED_STAFF" : "GUILD_AUTHORIZED"})),
});
const suggestion = (): RuleSuggestion => ({
  suggestionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", suggestionVersion: 3, ruleId: "HELP-001", issueCode: "HELP_REVIEW",
  target: {targetType: "HELP_INTAKE_POLICY", targetId: "queue-1", liveVersion: "v5"},
  sharedState: "ACTIVE", action: {actionId: "REVIEW_ONLY_HELP", mode: "REVIEW_ONLY"},
  explanation: {
    observation: "A structured help item awaits a response.", branchReason: "The available observation selects a coverage review.",
    action: "Ask the authorized support lead to review coverage.", ownerRole: "SUPPORT_LEAD", caution: "No message body was collected.", reviewCondition: "Review after an explicit outcome update.",
    translations: {ja: {observation: "構造化された相談が返信を待っています。", branchReason: "確認できる観測から対応範囲の確認を選びます。", action: "権限を持つ相談担当者が対応範囲を確認する案です。", caution: "メッセージ本文は収集していません。", reviewCondition: "結果が明示更新された後に見直します。"}},
  },
  evaluationAsOf: "2026-10-15T12:00:00Z", createdAt: "2026-10-15T12:00:00Z", lastObservedAt: "2026-10-15T11:59:00Z", actionableUntil: "2026-10-15T18:00:00Z", historyExpiresAt: "2026-10-16T12:00:00Z",
  canView: true, canRecordView: true, canSave: true, canDismiss: true, canReject: true, canCreateDraft: false, canApply: false,
  perUserState: {viewedAt: null, savedAt: null, dismissedAt: null}, evidence: [{kind: "FACT", referenceHash: "reference-only", expiresAt: "2026-10-15T18:00:00Z"}],
});
const envelope = (data: unknown) => ({ok: true, data});
async function mock(page: Page, options: {enabled?: boolean; item?: RuleSuggestion; status?: number; detailStatus?: number; post?: "OK" | "UNKNOWN" | "CONFLICT"; delay?: Promise<void>} = {}) {
  const posts: {path: string; headers: Record<string, string>; body: string | null}[] = [];
  await page.route("**/api/rules/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (options.delay) await options.delay;
    if (options.status) return route.fulfill({status: options.status, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: options.status === 403 ? "PERMISSION_REVOKED" : "SERVICE_UNAVAILABLE"}})});
    if (options.detailStatus && /\/suggestions\/[^/]+$/.test(url.pathname) && request.method() === "GET") return route.fulfill({status: options.detailStatus, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: "SUGGESTION_VERSION_MISMATCH"}})});
    if (request.method() === "POST") {
      if (url.pathname.endsWith("/mutation-request-key")) return route.fulfill({contentType: "application/json", body: JSON.stringify(envelope({key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expiresAt: "2026-10-15T18:00:00Z", purpose: "RULE_MUTATION"}))});
      posts.push({path: url.pathname, headers: request.headers(), body: request.postData()});
      if (options.post === "UNKNOWN") return route.abort("failed");
      if (options.post === "CONFLICT") return route.fulfill({status: 409, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: "STATE_CONFLICT"}})});
      return route.fulfill({contentType: "application/json", body: JSON.stringify(envelope({updated: "save"}))});
    }
    const data = url.pathname.endsWith("/catalog") ? catalog(options.enabled)
      : url.pathname.endsWith("/history") ? {items: [{sequence: "1", eventType: "CREATED", occurredAt: "2026-10-15T12:00:00Z"}]}
      : /\/suggestions\/[^/]+$/.test(url.pathname) ? options.item
      : {items: options.item ? [options.item] : [], page: {nextCursor: null, snapshotAt: "2026-10-15T12:00:00Z"}, status: options.item ? "AVAILABLE" : "EMPTY"};
    return route.fulfill({contentType: "application/json", body: JSON.stringify(envelope(data))});
  });
  return posts;
}

for (const locale of ["en", "ja"] as const) {
  test(`disabled catalog and empty state remain clear at 320px (${locale})`, async ({page}) => {
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({width: 320, height: 900});
    await mock(page); await page.goto(`/alpha16-rules-fixture?locale=${locale}`);
    await expect(page.getByRole("heading", {name: locale === "ja" ? "推奨される対応" : "Recommended responses", exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: locale === "ja" ? "保存されている対応案はありません" : "No retained responses", exact: true})).toBeVisible();
    await expect(page.getByText(locale === "ja" ? "新しい対応案を生成・保存するための保存・削除設定が未確定です。" : "Storage and deletion settings for newly generated responses are not configured.", {exact: true})).toBeVisible();
    await page.getByRole("button", {name: locale === "ja" ? "ルールと入力情報を確認" : "Inspect rules and input readiness", exact: true}).click();
    await expect(page.locator(".rules-rule")).toHaveCount(13);
    await expect(page.locator(".rules-case")).toHaveCount(20);
    await expect(page.getByRole("button", {name: locale === "ja" ? "評価する" : "Evaluate", exact: true})).toBeDisabled();
    await page.locator(".rules-case").nth(12).locator("summary").click();
    await expect(page.locator(".rules-case").nth(12)).toContainText(locale === "ja" ? "認可された担当者に限定" : "Restricted to authorized staff");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`suggestion detail, cancel and back preserve the original state (${locale})`, async ({page}) => {
    const posts = await mock(page, {enabled: true, item: suggestion()});
    await page.goto(`/alpha16-rules-fixture?locale=${locale}`);
    await page.getByRole("button", {name: locale === "ja" ? "推奨される対応を見る" : "See recommended response", exact: true}).click();
    await expect(page.getByText(locale === "ja" ? "構造化された相談が返信を待っています。" : "A structured help item awaits a response.", {exact: true})).toBeVisible();
    await expect(page.getByText(locale === "ja" ? "権限を持つ相談担当者が対応範囲を確認する案です。" : "Ask the authorized support lead to review coverage.", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: locale === "ja" ? "下書きを作る" : "Create a draft", exact: true})).toBeDisabled();
    await page.getByRole("button", {name: locale === "ja" ? "自分用に保存" : "Save for me", exact: true}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", {name: locale === "ja" ? "取り消す" : "Cancel", exact: true}).click();
    expect(posts).toHaveLength(0);
    await page.getByRole("button", {name: locale === "ja" ? "対応案の一覧へ戻る" : "Back to responses", exact: true}).click();
    await expect(page.getByRole("button", {name: locale === "ja" ? "推奨される対応を見る" : "See recommended response", exact: true})).toBeVisible();
  });
}

test("double-click confirmation sends one scoped CSRF-protected personal-state request", async ({page}) => {
  const posts = await mock(page, {enabled: true, item: suggestion()});
  await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await page.getByRole("button", {name: "Save for me", exact: true}).click();
  await page.getByRole("button", {name: "Confirm choice", exact: true}).dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]!.path).toMatch(/\/save$/);
  expect(posts[0]!.headers["x-nexus-guild"]).toBe("321111111111111111");
  expect(posts[0]!.headers["x-nexus-csrf"]).toBe("synthetic-csrf-only");
  expect(posts[0]!.headers["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/);
  expect(posts[0]!.body).toBe("{}");
});

test("shared rejection includes its expected version and explicit reason", async ({page}) => {
  const posts = await mock(page, {enabled: true, item: suggestion()});
  await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await page.getByRole("button", {name: "Reject for this server", exact: true}).click();
  await page.getByRole("combobox", {name: "Reason", exact: true}).selectOption("OUTDATED");
  await page.getByRole("button", {name: "Confirm choice", exact: true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]!.headers["if-match"]).toBe('"3"');
  expect(JSON.parse(posts[0]!.body!)).toEqual({reasonCode: "OUTDATED"});
});

test("unknown mutation results do not trigger an automatic resend", async ({page}) => {
  const posts = await mock(page, {enabled: true, item: suggestion(), post: "UNKNOWN"});
  await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await page.getByRole("button", {name: "Save for me", exact: true}).click();
  await page.getByRole("button", {name: "Confirm choice", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("Do not resend");
  await expect(page.getByRole("button", {name: "Save for me", exact: true})).toBeDisabled();
  expect(posts).toHaveLength(1);
});

for (const status of [403, 503]) {
  test(`failed request ${status} is not shown as an empty successful list`, async ({page}) => {
    await mock(page, {status}); await page.goto("/alpha16-rules-fixture");
    await expect(page.getByRole("alert")).toContainText(status === 403 ? "Current access could not be confirmed" : "latest information could not be loaded");
    await expect(page.getByRole("heading", {name: "No retained responses", exact: true})).toHaveCount(0);
    await expect(page.getByRole("link", {name: "Select server", exact: true})).toBeVisible();
  });
}

test("cancelled read stops loading without sending a mutation", async ({page}) => {
  let release!: () => void; const delay = new Promise<void>((resolveDelay) => {release = resolveDelay;});
  const posts = await mock(page, {delay}); await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "Cancel loading", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("Loading was cancelled");
  release(); expect(posts).toHaveLength(0);
});

test("conflicts are explicit and server-disabled actions remain unavailable", async ({page}) => {
  const item = suggestion(); item.canSave = false;
  await mock(page, {enabled: true, item, post: "CONFLICT"}); await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await expect(page.getByRole("button", {name: "Save for me", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "Hide for me", exact: true}).click();
  await page.getByRole("button", {name: "Confirm choice", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("current state does not allow");
});

test("a stale detail never becomes a current actionable suggestion", async ({page}) => {
  const posts = await mock(page, {enabled: true, item: suggestion(), detailStatus: 412});
  await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("changed or expired");
  await expect(page.getByRole("button", {name: "Save for me", exact: true})).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test("a historical suggestion cannot bypass disabled retention or runtime readiness", async ({page}) => {
  const item = suggestion(); item.canRecordView = false; item.canSave = false; item.canDismiss = false; item.canReject = false;
  const posts = await mock(page, {enabled: false, item});
  await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await expect(page.getByText("Ask the authorized support lead to review coverage.", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: /approve|approval|承認/i})).toHaveCount(0);
  for (const name of ["Mark viewed", "Save for me", "Hide for me", "Reject for this server", "Create a draft", "Apply selected draft"])
    await expect(page.getByRole("button", {name, exact: true})).toBeDisabled();
  expect(posts).toHaveLength(0);
});

test("current readable responses and per-class personal state do not wait for evaluation activation", async ({page}) => {
  await mock(page, {enabled: false, item: suggestion()});
  await page.goto("/alpha16-rules-fixture");
  await page.getByRole("button", {name: "See recommended response", exact: true}).click();
  await expect(page.getByRole("button", {name: "Save for me", exact: true})).toBeEnabled();
  await expect(page.getByRole("button", {name: /approve|approval|承認/i})).toHaveCount(0);
});
