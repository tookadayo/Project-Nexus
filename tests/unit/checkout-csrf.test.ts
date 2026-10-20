import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";
import { proxy } from "../../apps/web/proxy";
import { checkoutSessionCsrfHeaders, type CheckoutCsrfContext } from "../e2e/checkout-csrf";
import { checkoutOrigin } from "../e2e/checkout-transport";

type Cookie = { name: string; value: string };
function syntheticContext(reference = "A".repeat(43)) {
  const jar = new Map<string, string>([["nexus_session", reference]]);
  const context = {
    request: { get: vi.fn(async (url: string) => {
      const response = await proxy(new NextRequest(url, { headers: { host: "checkout.nexus.test:3160", cookie: cookieHeader() } }));
      for (const value of response.cookies.getAll()) jar.set(value.name, value.value);
      return { status: () => response.status };
    }) },
    cookies: vi.fn(async () => [...jar].map(([name, value]) => ({ name, value }))),
  };
  function cookieHeader() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); }
  return { context: context as unknown as CheckoutCsrfContext, jar, get: context.request.get, cookies: context.cookies, cookieHeader };
}
async function mutation(path: string, cookie: string, headers: Record<string, string>) {
  return proxy(new NextRequest(checkoutOrigin + path, { method: "POST", headers: {
    host: "checkout.nexus.test:3160", cookie, "content-type": "application/json", ...headers,
  }, body: JSON.stringify({ guildId: "931111111111112112", confirm: true }) }));
}
async function rejected(response: Awaited<ReturnType<typeof proxy>>) {
  expect(response.status).toBe(403);
  const body: unknown = await response.json();
  expect(Boolean(body && typeof body === "object" && "error" in body && body.error === "CSRF_REJECTED")).toBe(true);
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
  vi.stubEnv("NEXUS_WEB_URL", checkoutOrigin); vi.stubEnv("NEXUS_SESSION_SECRET", "s".repeat(64));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("SYNTHETIC_NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("checkout requests use the current context's real proxy-issued CSRF proof", () => {
  it.each(["/checkout/connect", "/checkout/actions", "/checkout/abandon", "/billing/actions", "/billing/payments/actions"])(
    "passes the CSRF boundary for %s without changing its independent route authorization", async path => {
      const fixture = syntheticContext();
      const headers = await checkoutSessionCsrfHeaders(fixture.context);
      expect(fixture.get).toHaveBeenCalledWith(checkoutOrigin + "/billing/payments", { maxRedirects: 0, timeout: 10000 });
      expect(fixture.cookies).toHaveBeenCalledWith(checkoutOrigin);
      const response = await mutation(path, fixture.cookieHeader(), headers);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );
  it("reproduces the exact connect rejection when the supplied proof is absent", async () => {
    const fixture = syntheticContext(); await checkoutSessionCsrfHeaders(fixture.context);
    await rejected(await mutation("/checkout/connect", fixture.cookieHeader(), { Origin: checkoutOrigin, "Sec-Fetch-Site": "same-origin" }));
  });
  it("keeps a foreign Origin rejected even with the correct session proof", async () => {
    const fixture = syntheticContext(), headers = await checkoutSessionCsrfHeaders(fixture.context);
    await rejected(await mutation("/checkout/connect", fixture.cookieHeader(), { ...headers, Origin: "https://evil.example" }));
  });
  it("does not allow a matching forged cookie and header to replace the issued proof", async () => {
    const fixture = syntheticContext(), headers = await checkoutSessionCsrfHeaders(fixture.context);
    const actual = headers["X-Nexus-CSRF"], forged = actual.slice(0, -1) + (actual.endsWith("A") ? "B" : "A");
    fixture.jar.set("nexus_csrf", forged);
    await rejected(await mutation("/checkout/connect", fixture.cookieHeader(), { ...headers, "X-Nexus-CSRF": forged }));
  });
  it("requires the secondary Owner's own context proof", async () => {
    const first = syntheticContext(), second = syntheticContext("B".repeat(43));
    const firstHeaders = await checkoutSessionCsrfHeaders(first.context), secondHeaders = await checkoutSessionCsrfHeaders(second.context);
    expect(firstHeaders["X-Nexus-CSRF"] === secondHeaders["X-Nexus-CSRF"]).toBe(false);
    await rejected(await mutation("/checkout/connect", second.cookieHeader(), firstHeaders));
    expect((await mutation("/checkout/connect", second.cookieHeader(), secondHeaders)).headers.get("x-middleware-next")).toBe("1");
  });
  it("refreshes the proof after a session is replaced instead of replaying the old binding", async () => {
    const fixture = syntheticContext(), before = await checkoutSessionCsrfHeaders(fixture.context);
    fixture.jar.set("nexus_session", "C".repeat(43));
    const after = await checkoutSessionCsrfHeaders(fixture.context);
    expect(before["X-Nexus-CSRF"] === after["X-Nexus-CSRF"]).toBe(false);
    await rejected(await mutation("/checkout/connect", fixture.cookieHeader(), before));
    expect((await mutation("/checkout/connect", fixture.cookieHeader(), after)).headers.get("x-middleware-next")).toBe("1");
  });
  it("does not follow a redirect or use cookies after unsuccessful proof issuance", async () => {
    const cookies = vi.fn(async () => []), context = { request: { get: vi.fn(async () => ({ status: () => 307 })) }, cookies } as unknown as CheckoutCsrfContext;
    await expect(checkoutSessionCsrfHeaders(context)).rejects.toThrow("TEST_CHECKOUT_CSRF_ISSUE_FAILED");
    expect(cookies).not.toHaveBeenCalled();
  });
  it.each([{ cookies: [] }, { cookies: [{ name: "nexus_session", value: "short" }] }] as { cookies: Cookie[] }[])("requires an authenticated opaque session without exposing its value", async ({ cookies }) => {
    const context = { request: { get: vi.fn(async () => ({ status: () => 200 })) }, cookies: vi.fn(async () => cookies) } as unknown as CheckoutCsrfContext;
    await expect(checkoutSessionCsrfHeaders(context)).rejects.toThrow("TEST_CHECKOUT_SESSION_REQUIRED");
  });
  it.each([undefined, "SYNTHETIC_CSRF_CANARY"])("requires the issuer's cookie proof without minting a replacement", async proof => {
    const cookies = [{ name: "nexus_session", value: "D".repeat(43) }, ...(proof ? [{ name: "nexus_csrf", value: proof }] : [])];
    const context = { request: { get: vi.fn(async () => ({ status: () => 200 })) }, cookies: vi.fn(async () => cookies) } as unknown as CheckoutCsrfContext;
    await expect(checkoutSessionCsrfHeaders(context)).rejects.toThrow("TEST_CHECKOUT_CSRF_NOT_ISSUED");
  });
});
