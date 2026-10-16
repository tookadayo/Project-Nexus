import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { webAuthMode } from "../../packages/config/src/web-auth";
import { webOrigin } from "../../packages/config/src/web-origin";
import { publicSessionPolicy } from "../../packages/security/src/public-sessions";
import { browserMutation, canonicalWebHost, webRouteBoundary } from "./app/auth/public-boundary";
import { browserCookieName, createCsrfToken, csrfCookieName, matchesCsrfToken, suppliedCsrfToken, validCsrfToken } from "./app/auth/csrf";
import { sameOrigin } from "./app/auth/origin";

const denied = (code: string, status: number) => NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function proxy(req: NextRequest) {
  let origin: string;
  try { origin = webOrigin(req); } catch { return denied("WEB_CONNECTION_UNAVAILABLE", 503); }
  if (!canonicalWebHost(req, origin)) return denied("HOST_REJECTED", 421);
  const path = req.nextUrl.pathname, route = webRouteBoundary(path);
  if (!route) return denied("NOT_FOUND", 404);
  if (!route.methods.includes(req.method)) {
    const response = denied("METHOD_NOT_ALLOWED", 405);
    response.headers.set("Allow", route.methods.join(", "));
    return response;
  }
  // Provider signatures/OAuth state are mandatory inside their exact handlers.
  // A public callback never accepts a browser session as provider proof.
  if (route.kind === "MACHINE_CALLBACK" || route.kind === "OAUTH_CALLBACK" || route.kind === "ASSET") return NextResponse.next();
  let mode: ReturnType<typeof webAuthMode>;
  try { mode = webAuthMode(); } catch { return denied("WEB_CONNECTION_UNAVAILABLE", 503); }
  const session = req.cookies.get("nexus_session")?.value, anonymous = req.cookies.get(browserCookieName)?.value, binding = session || anonymous;
  const secret = process.env.NEXUS_SESSION_SECRET || (mode === "development" ? process.env.NEXUS_WEB_PASSWORD : undefined);
  if (browserMutation(req.method) && (!sameOrigin(req) || !matchesCsrfToken(req.cookies.get(csrfCookieName)?.value, await suppliedCsrfToken(req), binding, secret))) return denied("CSRF_REJECTED", 403);
  if (route.kind === "BROWSER" && !path.startsWith("/checkout") && path !== "/locale") {
    if (mode !== "development" && !session) {
      if (browserMutation(req.method)) return denied("SESSION_REQUIRED", 401);
      const login = new URL("/auth/login", origin);
      if (path === "/link" || /^\/dashboard\/\d{17,20}$/.test(path)) login.searchParams.set("next", path);
      return NextResponse.redirect(login);
    }
    if (mode === "development") {
      const password = process.env.NEXUS_WEB_PASSWORD, actual = Buffer.from(req.headers.get("authorization") ?? ""), expected = Buffer.from(`Basic ${Buffer.from(`nexus:${password ?? ""}`).toString("base64")}`);
      if (!password || password.length < 16 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="NEXUS"', "Cache-Control": "no-store" } });
    }
  }
  let browser: string | undefined, csrf: string | undefined;
  const requestHeaders = new Headers(req.headers);
  if (secret && secret.length >= 16 && !browserMutation(req.method)) {
    browser = binding || randomBytes(32).toString("base64url");
    csrf = validCsrfToken(req.cookies.get(csrfCookieName)?.value, browser, secret) ? req.cookies.get(csrfCookieName)!.value : createCsrfToken(browser, secret);
    // Standalone confirmation Route Handlers also need their hidden field on
    // the first response; forward only these server-created cookie values.
    const existing = requestHeaders.get("cookie")?.split(";").filter(part => !part.trim().startsWith(`${csrfCookieName}=`)).join(";");
    const cookie = [existing, !binding ? `${browserCookieName}=${browser}` : "", `${csrfCookieName}=${csrf}`].filter(Boolean).join("; ");
    requestHeaders.set("cookie", cookie);
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  if (path.startsWith("/legal") || path === "/terms" || path === "/privacy") response.headers.set("X-Robots-Tag", "noindex, noarchive");
  if (browser && csrf) {
    const options = { secure: origin.startsWith("https:"), sameSite: "lax" as const, path: "/", maxAge: publicSessionPolicy().absoluteSeconds };
    if (!binding) response.cookies.set(browserCookieName, browser, { ...options, httpOnly: true });
    if (csrf !== req.cookies.get(csrfCookieName)?.value) response.cookies.set(csrfCookieName, csrf, { ...options, httpOnly: false });
  }
  return response;
}
// Apply Host/default-deny checks to assets as well as application handlers.
export const config = { matcher: ["/:path*"] };
