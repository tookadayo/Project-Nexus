import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect, type BrowserContext } from "./alpha17-verification-fixture";
import { buildOfficialStatic, contactUnavailable } from "../../packages/presentation/src/alpha16-publication";

const base = process.env.NEXUS_VERIFICATION_WEB_ORIGIN ?? "https://app.nexus.test:3150";
const official = "https://official.nexus.test";
const fixture = "http://127.0.0.1:" + (process.env.NEXUS_VERIFICATION_API_PORT ?? "3151");
const guild = "931111111111111111", unauthorized = "931111111111111115";
const syntheticCode = "alpha17-synthetic-code-911111111111111111";
const oauthCookies = ["nexus_oauth_state", "nexus_oauth_next", "nexus_checkout_login"];
type Choice = "allow" | "cancel" | "invalid-state";
type Metrics = { event: string; outcome: string };

// The isolated runner uses workers: 1 and retries: 0; independent cases must
// still run when a preceding case fails. Each creates its own browser context.
test.describe.configure({ mode: "default" });
test.skip(!process.env.NEXUS_ALPHA17_OAUTH_METRICS, "Requires the task-only exact-endpoint OAuth preload and HTTPS fixture.");

async function exchanges() {
  const file = process.env.NEXUS_ALPHA17_OAUTH_METRICS!;
  const value = await readFile(file, "utf8").catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  const rows = value.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Metrics);
  return { attempts: rows.length, accepted: rows.filter(row => row.event === "token-exchange" && row.outcome === "accepted").length };
}
async function sessionCookie(context: BrowserContext) {
  return (await context.cookies(base)).find(cookie => cookie.name === "nexus_session");
}
async function attemptCleared(context: BrowserContext) {
  const names = (await context.cookies(base)).map(cookie => cookie.name);
  expect(names.some(name => oauthCookies.includes(name))).toBe(false);
}
async function harness(context: BrowserContext, choice: Choice = "allow") {
  const generated = buildOfficialStatic({
    schemaVersion: 1, generation: 1, generatedAt: "2026-10-18T00:00:00.000Z",
    officialOrigin: official, appOrigin: base, announcements: [], status: null,
    legal: [], contact: contactUnavailable,
  }, Date.parse("2026-10-18T00:00:00.000Z"));
  let expectedState: string | undefined;
  let callbackLocation: string | undefined;
  let capturedLoginRedirect = false;
  const rejectedExternal: string[] = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === official && route.request().method() === "GET") {
      const path = url.pathname.slice(1) + (url.pathname.endsWith("/") ? "index.html" : "");
      const body = generated.files[path];
      if (body === undefined) return route.fulfill({ status: 404, body: "Fixture asset absent" });
      return route.fulfill({ status: 200, contentType: path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : "text/html", body });
    }
    if (url.origin === base && url.pathname === "/auth/login" && route.request().method() === "GET") {
      // Never follow the real provider redirect: Playwright routing does not
      // re-intercept subsequent requests in a redirect chain.
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers().location;
      const authorize = location ? new URL(location) : null;
      const state = authorize?.searchParams.get("state");
      const valid = response.status() === 307 && authorize?.origin === "https://discord.com" &&
        authorize.pathname === "/oauth2/authorize" && Boolean(state) &&
        authorize.searchParams.get("response_type") === "code" &&
        authorize.searchParams.get("client_id") === "941111111111111111" &&
        authorize.searchParams.get("scope") === "identify guilds" &&
        authorize.searchParams.get("redirect_uri") === base + "/auth/callback";
      if (!valid) return route.abort("blockedbyclient");
      capturedLoginRedirect = true;
      expectedState = state!;
      const target = new URL(base + "/auth/callback");
      target.searchParams.set("state", choice === "invalid-state" ? state + "invalid" : state!);
      target.searchParams.set(choice === "cancel" ? "error" : "code", choice === "cancel" ? "access_denied" : syntheticCode);
      callbackLocation = target.toString();
      // Preserve the actual login Set-Cookie response. The provider UI alone is
      // replaced; neither the DOM nor its fixed button contains state/code.
      return route.fulfill({ response, status: 200, contentType: "text/html", body: '<!doctype html><html lang="en"><title>Synthetic Discord consent</title><h1>Synthetic Discord consent</h1><button type="button">Return to NEXUS</button></html>' });
    }
    if (url.origin === base || url.origin === fixture) return route.continue();
    rejectedExternal.push(url.origin);
    return route.abort("blockedbyclient");
  });
  await context.addCookies([{ name: "nexus_locale", value: "en", url: base }]);
  return {
    validStateCookie: async () => {
      const cookie = (await context.cookies(base)).find(item => item.name === "nexus_oauth_state");
      return Boolean(capturedLoginRedirect && expectedState && cookie?.value === expectedState && cookie.httpOnly && cookie.secure && cookie.sameSite === "Lax");
    },
    returnToNexus: async (page: Page) => {
      if (!callbackLocation) throw new Error("SYNTHETIC_CONSENT_NOT_READY");
      await page.getByRole("button", { name: "Return to NEXUS", exact: true }).click();
      // An independent browser navigation reaches the unchanged real callback.
      await page.goto(callbackLocation);
    },
    rejectedExternal,
  };
}
async function consent(page: Page) {
  await page.goto(base + "/auth/login");
  await expect(page.getByRole("heading", { name: "Synthetic Discord consent", exact: true })).toBeVisible();
}
async function openAuthorizedDashboard(page: Page) {
  await page.getByRole("heading", { name: "Verified community", exact: true }).locator("..").locator("..").getByRole("link", { name: "Open Dashboard", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/auth/select\\?guild=" + guild + "$"));
  await page.getByRole("button", { name: /Open$/ }).click();
  await page.waitForURL(url => url.pathname === "/setup" || url.pathname === "/dashboard/" + guild);
  if (new URL(page.url()).pathname === "/setup") {
    // Respect the existing incomplete-setup gate; use the actual reviewed UI.
    await expect(page.getByRole("heading", { name: "Get ready to use NEXUS", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("Asia/Tokyo");
    await page.getByRole("checkbox", { name: "I confirm this region for shared schedules.", exact: true }).check();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status").last()).toContainText("Draft saved");
    await page.getByRole("button", { name: "4. Review & apply", exact: true }).click();
    await page.getByRole("checkbox", { name: "I reviewed this saved draft and want to apply it to the current settings.", exact: true }).check();
    await page.getByRole("button", { name: "Apply reviewed settings", exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/auth/select\\?guild=" + guild + "$"));
    await page.getByRole("button", { name: /Open$/ }).click();
  }
  await expect(page).toHaveURL(new RegExp("/dashboard/" + guild + "$"));
}

test("generated official site reaches real OAuth callback, durable session and authorized dashboard; logout revokes it", async ({ page, context, browser, request }) => {
  const routing = await harness(context);
  const before = await exchanges();
  const stored = async () => {
    const response = await request.get(fixture + "/fixture/data/" + unauthorized);
    expect(response.status()).toBe(200);
    return response.json() as Promise<unknown>;
  };
  const unauthorizedBefore = await stored();
  await page.goto(official + "/en/");
  const login = page.getByRole("link", { name: "Dashboard", exact: true });
  expect(await login.getAttribute("href")).toBe(base + "/auth/login");
  await login.click();
  await expect(page.getByRole("heading", { name: "Synthetic Discord consent", exact: true })).toBeVisible();
  expect(await routing.validStateCookie()).toBe(true);
  expect(await sessionCookie(context) === undefined).toBe(true);
  await routing.returnToNexus(page);
  await expect(page).toHaveURL(base + "/servers");
  await expect(page.getByRole("heading", { name: "Choose a server to manage", exact: true })).toBeVisible();
  await expect(page.getByText("Unauthorized community", { exact: true })).toHaveCount(0);
  const issued = await sessionCookie(context);
  expect(Boolean(issued && /^[A-Za-z0-9_-]{43}$/.test(issued.value) && issued.httpOnly && issued.secure && issued.sameSite === "Lax")).toBe(true);
  await attemptCleared(context);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose a server to manage", exact: true })).toBeVisible();
  await openAuthorizedDashboard(page);
  // A selected-guild hint cannot grant access to an unauthorized guild.
  await context.addCookies([{ name: "nexus_guild", value: unauthorized, url: base }]);
  await page.goto(base + "/dashboard/" + unauthorized);
  await expect(page).toHaveURL(base + "/servers");
  expect(await stored()).toEqual(unauthorizedBefore);
  await page.goto(base + "/auth/logout");
  // Keep the browser's own Fetch Metadata/Host generation. route.fetch uses
  // APIRequestContext and is not equivalent to this CSRF-checked form POST.
  const [response] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === base && url.pathname === "/auth/logout" && response.request().method() === "POST";
    }),
    page.getByRole("button", { name: /Sign out$/ }).click({ noWaitAfter: true }),
  ]);
  const requestHeaders = await response.request().allHeaders();
  const fields = new URLSearchParams(response.request().postData() ?? "");
  const supplied = fields.get("_nexus_csrf");
  const csrfCookie = requestHeaders.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("nexus_csrf="))?.slice("nexus_csrf=".length);
  const headers = response.headers();
  let location: URL | undefined;
  try { if (headers.location) location = new URL(headers.location); } catch { /* Record only the rejected classification. */ }
  const error = response.status() === 403 ? await response.json().catch(() => null) as { error?: unknown } | null : null;
  const contentLength = headers["content-length"];
  const encoding = headers["content-encoding"]?.toLowerCase();
  const metadata = {
    event: "logout-response", status: response.status(),
    locationExact: headers.location === base + "/auth/login", locationOriginAllowed: location?.origin === base,
    locationPathAllowed: location?.pathname === "/auth/login",
    requestOriginMatches: requestHeaders.origin === base, requestHostMatches: requestHeaders.host === new URL(base).host,
    secFetchSiteSameOrigin: requestHeaders["sec-fetch-site"] === "same-origin",
    csrfInputPresent: Boolean(supplied), csrfCookiePresent: Boolean(csrfCookie), csrfInputMatchesCookie: Boolean(supplied && csrfCookie && supplied === csrfCookie),
    csrfRejected: error?.error === "CSRF_REJECTED", handlerForbidden: error?.error === "FORBIDDEN",
    contentLength: contentLength && /^\d{1,9}$/.test(contentLength) ? Number(contentLength) : null,
    contentEncoding: !encoding ? "none" : ["gzip", "br", "deflate"].includes(encoding) ? encoding : "other",
    transferEncoding: !headers["transfer-encoding"] ? "none" : headers["transfer-encoding"].toLowerCase() === "chunked" ? "chunked" : "other",
  };
  // Synthetic metadata only. Keep token-exchange metrics unchanged: their
  // row count is itself an assertion, so logout observations stay separate.
  console.info("alpha17-oauth-safe " + JSON.stringify(metadata));
  await test.info().attach("logout-response-metadata", { body: JSON.stringify(metadata), contentType: "application/json" });
  expect(response.status()).toBe(303);
  expect(headers.location).toBe(base + "/auth/login");
  expect(await sessionCookie(context) === undefined).toBe(true);
  const copied = await browser.newContext({ baseURL: base, ignoreHTTPSErrors: true, serviceWorkers: "block" });
  try {
    await harness(copied);
    await copied.addCookies([issued!]);
    expect(Boolean((await sessionCookie(copied))?.value === issued!.value)).toBe(true);
    const rejected = await copied.request.get(base + "/servers", { maxRedirects: 0 });
    expect(rejected.status()).toBe(307);
    expect(new URL(rejected.headers().location ?? "", rejected.url()).href).toBe(base + "/auth/login");
  } finally { await copied.close(); }
  const after = await exchanges();
  expect(after.attempts - before.attempts).toBe(1);
  expect(after.accepted - before.accepted).toBe(1);
  expect(routing.rejectedExternal).toEqual([]);
  await test.info().attach("synthetic-oauth-seam-summary", { body: JSON.stringify({ officialArtifact: true, login: "real-next-307-captured-without-following", discordAuthorize: "synthetic-consent-html", tokenExchange: "exact-loopback-preload", session: "real-private-db", dashboard: "authorized-post", unauthorizedGuild: "denied-unchanged", logout: "copied-reference-rejected", acceptedExchanges: 1, realDiscordAuthentication: false }), contentType: "application/json" });
});

test("OAuth cancellation with matching state issues no session and performs no exchange", async ({ page, context }) => {
  const routing = await harness(context, "cancel");
  const before = await exchanges();
  await consent(page);
  expect(await routing.validStateCookie()).toBe(true);
  await routing.returnToNexus(page);
  await expect(page).toHaveURL(base + "/auth/problem?cancelled=1");
  await expect(page.getByRole("heading", { name: "Sign-in canceled", exact: true })).toBeVisible();
  expect(await sessionCookie(context) === undefined).toBe(true);
  await attemptCleared(context);
  expect(await exchanges()).toEqual(before);
  expect(routing.rejectedExternal).toEqual([]);
});

test("invalid state and expired state cookie stop before token exchange or session creation", async ({ browser }) => {
  const before = await exchanges();
  for (const kind of ["invalid-state", "expired-cookie"] as const) {
    const context = await browser.newContext({ baseURL: base, ignoreHTTPSErrors: true, serviceWorkers: "block" });
    try {
      const routing = await harness(context, kind === "invalid-state" ? kind : "allow");
      const page = await context.newPage();
      await consent(page);
      expect(await routing.validStateCookie()).toBe(true);
      if (kind === "expired-cookie") {
        const stateCookie = (await context.cookies(base)).find(cookie => cookie.name === "nexus_oauth_state");
        expect(Boolean(stateCookie)).toBe(true);
        await context.addCookies([{ ...stateCookie!, expires: Math.floor(Date.now() / 1000) - 60 }]);
        expect((await context.cookies(base)).some(cookie => cookie.name === "nexus_oauth_state")).toBe(false);
      }
      await routing.returnToNexus(page);
      await expect(page).toHaveURL(/\/auth\/problem\?category=AUTH_SESSION/);
      await expect(page.getByRole("heading", { name: "Sign-in canceled", exact: true })).toHaveCount(0);
      expect(await sessionCookie(context) === undefined).toBe(true);
      await attemptCleared(context);
      expect(await exchanges()).toEqual(before);
      expect(routing.rejectedExternal).toEqual([]);
    } finally { await context.close(); }
  }
});
