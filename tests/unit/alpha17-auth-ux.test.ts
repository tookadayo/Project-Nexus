import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";
import { ServerCards } from "../../apps/web/app/servers/cards";
import AuthProblem from "../../apps/web/app/auth/problem/page";
import { GET as callback } from "../../apps/web/app/auth/callback/route";
import { GET as confirmGuild, POST as selectGuild } from "../../apps/web/app/auth/select/route";
import { openSession, sealSession } from "../../apps/web/app/auth/session";
import { SettingsService, settingsSchema } from "../../packages/settings/src/index";
import { memoryPublicSessions } from "../fixtures/public-sessions";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { createElement } = requireWeb("react") as typeof import("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({ locale: "en" as "ja" | "en", connection: vi.fn() }));
vi.mock("../../apps/web/app/public-ui", () => ({
  siteLocale: async () => mocks.locale,
  copy: <T>(locale: "ja" | "en", ja: T, en: T) => locale === "ja" ? ja : en,
  SiteShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children),
}));
vi.mock("../../apps/web/app/auth/public-session-store", async () => {
  const { memoryPublicSessions } = await import("../fixtures/public-sessions");
  return { publicSessions: () => memoryPublicSessions };
});
vi.mock("../../apps/web/app/auth/server-access", () => ({ manageableConnection: mocks.connection, serverServices: () => ({ db: {} }) }));

const origin = "https://app.nexus.example", guild = "821111111111111111", user = "811111111111111111";
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth"); vi.stubEnv("NEXUS_WEB_URL", origin);
  vi.stubEnv("NEXUS_SESSION_SECRET", "synthetic-session-fixture-secret-64-characters-for-testing-only");
  vi.stubEnv("API_KEY", "synthetic-local-api-fixture-key-only");
  vi.stubEnv("DISCORD_APPLICATION_ID", "831111111111111111"); vi.stubEnv("DISCORD_CLIENT_SECRET", "synthetic-provider-fixture-secret");
  fetcher.mockReset(); mocks.connection.mockReset(); mocks.locale = "en";
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); memoryPublicSessions.reset(); });
function cardHref(state: "VERIFIED" | "INSTALLED_NOT_VERIFIED" = "VERIFIED") {
  const html = renderToStaticMarkup(createElement(ServerCards, { locale: "en", guilds: [{ id: guild, name: "Synthetic community", installed: true, installUrl: null, state }] }));
  return /<a class="button button-primary" href="([^"]+)"/.exec(html)![1]!;
}
function callbackRequest(query: string, expectedState?: string) {
  return new NextRequest(`${origin}/auth/callback?${query}`, { headers: { host: "app.nexus.example", ...(expectedState ? { cookie: `nexus_oauth_state=${expectedState}; nexus_oauth_next=/dashboard/${guild}; nexus_checkout_login=synthetic-unused-intent` } : {}) } });
}

describe("alpha17 existing authentication navigation", () => {
  it.each([false, true])("verified cards use current server selection before routing (configure=%s)", async canConfigure => {
    const href = cardHref();
    expect(href).toBe(`/auth/select?guild=${guild}`);
    const session = await sealSession({ userId: user, accessToken: "synthetic-identity-fixture", expiresAt: Date.now() + 60000 });
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ id: user }) });
    mocks.connection.mockResolvedValue({ state: "VERIFIED", operationsCanConfigure: canConfigure });
    vi.spyOn(SettingsService.prototype, "get").mockResolvedValue({ ...settingsSchema.parse({ setupVersion: 3 }), revision: 1 });
    const get = await confirmGuild(new NextRequest(new URL(href, origin), { headers: { host: "app.nexus.example", cookie: `nexus_session=${session}` } }));
    expect(get.cookies.get("nexus_guild")).toBeUndefined();
    expect(mocks.connection).not.toHaveBeenCalled();
    const result = await selectGuild(new NextRequest(`${origin}/auth/select`, { method: "POST", headers: { host: "app.nexus.example", origin, "sec-fetch-site": "same-origin", cookie: `nexus_session=${session}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ guild }) }));
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(origin + (canConfigure ? `/dashboard/${guild}` : "/operations?view=attention"));
    expect(mocks.connection).toHaveBeenCalledExactlyOnceWith(guild, user);
    expect(result.cookies.get("nexus_guild")?.httpOnly).toBe(true);
  });
  it("keeps unverified cards on the existing setup path", () => {
    expect(cardHref("INSTALLED_NOT_VERIFIED")).toBe(`/setup?guild=${guild}`);
  });
  it("reports a provider cancellation only after matching state, clears the attempt and never exchanges tokens", async () => {
    const currentSession = await sealSession({ userId: user, accessToken: "synthetic-existing-session", expiresAt: Date.now() + 60000 });
    const response = await callback(callbackRequest("error=access_denied&state=matching", "matching"));
    expect(new URL(response.headers.get("location")!).searchParams.get("cancelled")).toBe("1");
    for (const name of ["nexus_oauth_state", "nexus_oauth_next", "nexus_checkout_login"]) expect(response.cookies.get(name)?.value).toBe("");
    expect(response.cookies.get("nexus_session")).toBeUndefined();
    expect((await openSession(currentSession))?.userId).toBe(user);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([undefined, "different"])("does not mislabel missing/invalid state as a cancellation (%s)", async expected => {
    const response = await callback(callbackRequest("error=access_denied&state=matching", expected));
    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toBe("/auth/problem"); expect(target.searchParams.get("cancelled")).toBeNull();
    expect(target.searchParams.get("category")).toBe("AUTH_SESSION");
    expect(response.cookies.get("nexus_session")).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps a valid-state callback with no code or provider cancellation on the session-error path", async () => {
    const response = await callback(callbackRequest("state=matching", "matching"));
    const target = new URL(response.headers.get("location")!);
    expect(target.searchParams.get("category")).toBe("AUTH_SESSION");
    expect(target.searchParams.has("cancelled")).toBe(false);
    expect(response.cookies.get("nexus_session")).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["ja", "en"] as const)("shows cancellation separately from an expired session (%s)", async locale => {
    mocks.locale = locale;
    const cancelled = renderToStaticMarkup(await AuthProblem({ searchParams: Promise.resolve({ cancelled: "1" }) }));
    expect(cancelled).toContain(locale === "ja" ? "ログインをキャンセルしました" : "Sign-in canceled");
    expect(cancelled).not.toContain(locale === "ja" ? "ログインの有効期限" : "The session expired");
    expect(cancelled).toContain('href="/auth/login"');
    const expired = renderToStaticMarkup(await AuthProblem({ searchParams: Promise.resolve({ category: "AUTH_SESSION" }) }));
    expect(expired).toContain(locale === "ja" ? "ログインの有効期限" : "The session expired");
    expect(expired).not.toContain(locale === "ja" ? "ログインをキャンセルしました" : "Sign-in canceled");
  });
  it("keeps the successful state-bound callback on the existing session path", async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer", expires_in: 3600, scope: "identify guilds" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: user }) });
    const response = await callback(callbackRequest("state=matching&code=synthetic-grant", "matching"));
    expect(response.headers.get("location")).toBe(`${origin}/dashboard/${guild}`);
    expect((await openSession(response.cookies.get("nexus_session")?.value))?.userId).toBe(user);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(response.cookies.get("nexus_oauth_state")?.value).toBe("");
  });
});
