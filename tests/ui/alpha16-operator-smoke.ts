/** Controlled browser fixture only. Does not connect to DB/Discord, provision
 * credentials, delete data or change a running Operator. */
import { chromium, expect, type Browser } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
const assets: Record<string, string> = {
  "/operator/alpha16": "alpha16.html", "/operator/alpha16.js": "alpha16.js", "/operator/alpha16.css": "alpha16.css",
};
const server = createServer(async (req, res) => {
  const file = assets[req.url ?? ""];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", file.endsWith("html") ? "text/html" : file.endsWith("js") ? "text/javascript" : "text/css");
  res.setHeader("Cache-Control", "no-store");
  res.end(await readFile(new URL("../../apps/operator/public/" + file, import.meta.url)));
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("FIXTURE_PORT_REQUIRED");
let browser:Browser|undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 },serviceWorkers:"block" });
  const origin=`http://127.0.0.1:${address.port}`;
  await page.route("**/*",route=>{const request=route.request(),url=new URL(request.url());return url.origin===origin&&request.method()==="GET"&&Object.hasOwn(assets,url.pathname)?route.continue():route.fulfill({status:503,body:"UNMOCKED_SYNTHETIC_REQUEST"});});
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let permissionDenied = false, networkFailed = false;
  await page.route("**/operator/session", route => route.fulfill({ json: { authenticated: true, csrf: "fixture-csrf" } }));
  await page.route("**/operator/v1/**", async route => {
    const path = new URL(route.request().url()).pathname; requests.push(path);
    if (networkFailed) { await route.abort("failed"); return; }
    if (path.endsWith("capabilities")) { await route.fulfill({ json: { permissions: ["OPERATOR_PRIVACY_DELETE_GUILD", "OPERATOR_STATUS_READ"], guildIds: ["123456789012345678"], global: false, privacyBlockingReasons: [], mutationBlockingReasons: [] } }); return; }
    if (permissionDenied) { await route.fulfill({ status: 403, json: { error: "PERMISSION_DENIED" } }); return; }
    if (path.endsWith("/status")) { await route.fulfill({ json: { components: ["PC_PROCESS", "DB", "QUEUE", "WORKER", "DISCORD_OUTBOUND", "TUNNEL_REACHABILITY"].map(component => ({ component, state: "UNKNOWN", lastObservedAt: null, errorCode: "OBSERVATION_UNAVAILABLE" })) } }); return; }
    if (path.endsWith("/privacy/deletions/preview")) {
      await route.fulfill({ json: { previewId: "11111111-1111-4111-8111-111111111111", previewHash: "a".repeat(64), targetDiscordId: "987654321098765432", scopeKind: "GUILD", guildId: "123456789012345678", includedDataClasses: ["PRIMARY", "SESSION", "CACHE", "QUEUE"], excludedDataClasses: ["DISCORD_MESSAGES_NOT_OWNED_BY_NEXUS"], irreversibleBoundary: "TOMBSTONE_COMMIT", deletionPlanRevision: "fixture-only", expiresAt: new Date(Date.now() + 60000).toISOString() } }); return;
    }
    if (path.endsWith("/recovery/readiness")) { await route.fulfill({ json: { state: "NOT_READY", blockers: ["LATEST_TOMBSTONES_REQUIRED", "LATEST_TARGET_SAFETY_REQUIRED", "BACKUP_UNKNOWN"] } }); return; }
    await route.fulfill({ json: { items: [], events: [], blockingReasons: ["UNAPPROVED_FIXTURE_POLICY"] } });
  });
  await page.goto(`http://127.0.0.1:${address.port}/operator/alpha16`);
  await expect(page.locator(".health")).toHaveCount(6);
  await expect(page.locator(".health .state").first()).toHaveText("未確認");
  await page.locator("#language").selectOption("en");
  await expect(page.locator("h1")).toHaveText("Operations and safe controls");
  await page.locator('[data-tab="admissions"]').click();
  await expect(page.locator("#panel")).toContainText("No records.");
  await page.locator('[data-tab="privacy"]').click();
  await page.locator('#panel input[name="discordId"]').fill("987654321098765432");
  await page.locator('#panel input[name="guild"]').fill("123456789012345678");
  await page.locator('#panel button').click();
  await expect(page.locator("#review")).toBeVisible();
  await expect(page.locator("#review-details")).toContainText("987654321098765432");
  await expect(page.locator("#review-details")).toContainText("a".repeat(64));
  await page.locator("#cancel-review").click();
  await expect(page.locator("#review")).not.toBeVisible();
  expect(requests.filter(path => path.endsWith("/confirm"))).toHaveLength(0);
  await page.locator('[data-tab="recovery/readiness"]').click();
  await expect(page.locator("#panel")).toContainText("Not ready");
  permissionDenied = true;
  await page.locator('[data-tab="audit"]').click();
  await expect(page.locator("#panel")).toContainText("Permission for this scope could not be confirmed.");
  permissionDenied = false; networkFailed = true;
  await page.locator("#reload").click();
  await expect(page.locator("#panel")).toContainText("Could not load.");
  networkFailed = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tab="status"]').click();
  await expect(page.locator(".health")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir(".local", { recursive: true });
  await page.screenshot({ path: ".local/alpha16-operator-en-mobile.png", fullPage: true });
  await page.locator("#language").selectOption("ja");
  await expect(page.locator("h1")).toHaveText("運営の状態と安全な操作");
  await page.screenshot({ path: ".local/alpha16-operator-ja-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  process.stdout.write("PASS controlled Operator UI fixture: six health sources, JA/EN, empty, permission/network failures, deletion preview/cancel, NOT_READY and mobile. Real authentication/deletion/restore remain separate checks.\n");
} finally {
  await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
